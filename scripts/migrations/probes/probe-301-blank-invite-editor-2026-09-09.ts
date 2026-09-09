// mvox-app#301 — does the BLANK createInvite() path require `_owner` on the
// database entity, or does `_editor` succeed? Polyphony only, synthetic,
// team-lead's explicit "I authorize this run" (2026-09-09), same shape as
// the #294 admin-invite-cascade probe.
//
// WHY THIS DOESN'T TRANSFER FROM #294: that probe tested `mintSelfLinkInvite`
// — an UPDATE on an EXISTING person's entity, gated by `checkEntityAccess`
// reading the TARGET's own `private._editor`/`_owner`. `createInvite` is a
// CREATE (no entityId yet) — the relevant gate is the PARENT-expander check
// (entu-api utils/entity.js:239-261, "User not in parent _owner, _editor nor
// _expander property"), a DIFFERENT check than the one #294 hit. #301's own
// body names this unverified, not assumed, precisely because create-time
// auto-grant (confirmed twice already) might make it succeed for an editor
// where the update-path mint did not.
//
// RIG: throwaway synthetic Caller B + entu_api_key, granted `_editor` on the
// polyphony DATABASE ENTITY ONLY (nothing else, nothing on any person) —
// then Caller B calls the REAL createInvite(cfg, {dbEntityId}), the exact
// library function #301's blank-invite button already calls.
//
// PARTIAL-FAILURE HANDLING: createInvite's sequence is person-create ->
// self-`_editor` grant -> member-create (inviteData.ts:379-451). A failure
// after person-create sets `InviteCreateError.personId` — this script names
// and attempts to clean up whatever exists, and reports explicitly (not a
// bare "cleaned up") if any piece could not be removed, per team-lead's
// instruction: an orphan on polyphony is harmless but must be on the record,
// not silently absorbed into a "tidy teardown" claim.
//
// Read-only against crede — crede is never touched by this script.

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { createInvite, InviteCreateError } from '$lib/invite/inviteData';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

interface LedgerEntry {
	step: string;
	outcome: string;
	[key: string]: unknown;
}

async function getEntityRaw(db: string, token: string, entityId: string): Promise<{ status: number; body: unknown }> {
	const res = await fetch(`https://api.entu.app/${db}/entity/${entityId}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const body = await res.json().catch(() => null);
	return { status: res.status, body };
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerEntry[] = [];
	const orphans: string[] = [];

	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable');
	console.log(`db-root entity: ${dbEntityId}`);

	if (DRY_RUN) {
		console.log('\n=== DRY RUN — would-do, nothing executed ===');
		console.log('1. Would create Caller B (throwaway synthetic) + mint an entu_api_key on it.');
		console.log('2. Would grant Caller B `_editor` on the DATABASE ENTITY only.');
		console.log('3. Would call the REAL createInvite(callerBCfg, {dbEntityId}) as Caller B.');
		console.log('4. Would report status: full success (person+member+self-editor) or the exact partial-failure phase.');
		console.log('5. Would clean up everything created, explicitly naming anything that could not be removed.');
		console.log('6. Would revert the db-entity grant and delete Caller B.');
		ledger.push({ step: 'dry-run', outcome: 'dry-run-would-run' });
	} else {
		// ─── 1. Caller B fixture ──────────────────────────────────────────────
		console.log('\n=== 1. Create Caller B ===');
		const personTypeRes = await entuFetch(cfg.db, 'entity?_type.string=entity&name.string=person&props=_id&limit=1', cfg.token);
		const personTypeBody = (await personTypeRes.json()) as { entities?: Array<{ _id?: string }> };
		const personTypeId = personTypeBody.entities?.[0]?._id;
		if (!personTypeId) throw new Error('could not resolve person type-def id');

		const createRes = await entuFetch(cfg.db, 'entity', cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: '_type', reference: personTypeId },
				{ type: '_parent', reference: dbEntityId }
			])
		});
		if (!createRes.ok) throw new Error(`Caller B create failed: HTTP ${createRes.status}`);
		const createBody = (await createRes.json()) as { _id?: string };
		if (!createBody._id) throw new Error('Caller B create returned 2xx without _id');
		const callerBId = createBody._id;
		console.log(`  Caller B: ${callerBId}`);
		ledger.push({ step: 'create-caller-b', outcome: 'created', callerBId });

		const keyRes = await entuFetch(cfg.db, `entity/${callerBId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'entu_api_key', string: '' }])
		});
		if (!keyRes.ok) throw new Error(`Caller B api-key mint failed: HTTP ${keyRes.status}`);
		const keyBody = (await keyRes.json()) as { properties?: Array<{ type?: string; string?: string }> };
		const callerBRawKey = (keyBody.properties ?? []).find((p) => p.type === 'entu_api_key')?.string;
		if (!callerBRawKey) throw new Error('Caller B api-key mint: no raw key returned');
		console.log('  Caller B entu_api_key minted (never logged/persisted)');
		ledger.push({ step: 'mint-caller-b-key', outcome: 'minted', callerBId });

		// ─── 2. `_editor` on the db entity, nothing else ────────────────────────
		console.log('\n=== 2. Grant Caller B `_editor` on the database entity (nothing else) ===');
		const grantRes = await entuFetch(cfg.db, `entity/${dbEntityId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_editor', reference: callerBId }])
		});
		if (!grantRes.ok) throw new Error(`db-entity _editor grant failed: HTTP ${grantRes.status}`);
		const grantBody = (await grantRes.json()) as { properties?: Array<{ type?: string; _id?: string }> };
		const dbGrantPropId = (grantBody.properties ?? []).find((p) => p.type === '_editor')?._id;
		if (!dbGrantPropId) throw new Error('db-entity _editor grant returned 2xx without a matching property _id');
		console.log(`  granted _editor on db entity ${dbEntityId} (property ${dbGrantPropId})`);
		ledger.push({ step: 'grant-caller-b-db-editor', outcome: 'granted', dbEntityId, propId: dbGrantPropId });

		// ─── 3. THE TEST — createInvite AS Caller B (_editor only) ─────────────
		console.log('\n=== 3. createInvite(callerBCfg, {dbEntityId}) — THE TEST ===');
		const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, {
			headers: { Authorization: `Bearer ${callerBRawKey}`, Accept: 'application/json' }
		});
		const authBody = (await authRes.json()) as { token?: string };
		if (!authBody.token) throw new Error('Caller B auth exchange failed or returned no token');
		const callerBCfg: EntuCfg = { db: cfg.db, token: authBody.token };

		let outcome: 'full-success' | 'partial-failure' | 'clean-refusal';
		let detail: string;
		let createdPersonId: string | undefined;
		let createdMemberId: string | undefined;

		try {
			const result = await createInvite(callerBCfg, { dbEntityId });
			outcome = 'full-success';
			createdPersonId = result.personId;
			createdMemberId = result.memberId;
			detail = `createInvite SUCCEEDED end-to-end as an _editor-only caller: person ${result.personId}, member ${result.memberId}, invite token returned (never logged). An _editor admin CAN blank-invite.`;
		} catch (e) {
			if (e instanceof InviteCreateError) {
				createdPersonId = e.personId;
				outcome = e.personId ? 'partial-failure' : 'clean-refusal';
				detail = `createInvite FAILED at phase '${e.phase}' (reason: ${e.reason}): ${e.message}${e.personId ? ` — PERSON ${e.personId} WAS CREATED before this failure (partial, needs cleanup)` : ' — nothing was created before this failure'}.`;
			} else {
				outcome = 'clean-refusal';
				detail = e instanceof Error ? e.message : String(e);
			}
		}
		console.log(`  >> ${outcome.toUpperCase()}: ${detail}`);
		ledger.push({ step: 'blank-invite-editor-test', outcome, detail, callerBId, createdPersonId, createdMemberId });

		// ─── 4. CLEANUP — explicit about anything that doesn't come back clean ──
		console.log('\n=== 4. CLEANUP ===');

		if (createdMemberId) {
			const delMember = await entuFetch(cfg.db, `entity/${createdMemberId}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE member ${createdMemberId}: ${delMember.ok ? 'OK' : 'FAILED'} (${delMember.status})`);
			ledger.push({ step: 'cleanup-delete-member', outcome: delMember.ok ? 'deleted' : 'delete-failed', memberId: createdMemberId, status: delMember.status });
			if (!delMember.ok) orphans.push(`member ${createdMemberId} (status ${delMember.status})`);
		}

		if (createdPersonId) {
			const delPerson = await entuFetch(cfg.db, `entity/${createdPersonId}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE person ${createdPersonId}: ${delPerson.ok ? 'OK' : 'FAILED'} (${delPerson.status})`);
			ledger.push({ step: 'cleanup-delete-person', outcome: delPerson.ok ? 'deleted' : 'delete-failed', personId: createdPersonId, status: delPerson.status });
			if (!delPerson.ok) orphans.push(`person ${createdPersonId} (status ${delPerson.status})`);

			const verify = await getEntityRaw(cfg.db, cfg.token, createdPersonId);
			console.log(`  independent re-verify GET person: HTTP ${verify.status} (expect 404)`);
			ledger.push({ step: 'verify-person-gone', outcome: String(verify.status), expected: 404 });
			if (verify.status !== 404) orphans.push(`person ${createdPersonId} still readable after DELETE (HTTP ${verify.status})`);
		}

		const delGrant = await entuFetch(cfg.db, `property/${dbGrantPropId}`, cfg.token, { method: 'DELETE' });
		console.log(`  DELETE Caller B's db-entity _editor grant ${dbGrantPropId}: ${delGrant.ok ? 'OK' : 'FAILED'} (${delGrant.status})`);
		ledger.push({ step: 'cleanup-delete-db-grant', outcome: delGrant.ok ? 'deleted' : 'delete-failed', propId: dbGrantPropId, status: delGrant.status });
		if (!delGrant.ok) orphans.push(`db-entity _editor grant ${dbGrantPropId} (status ${delGrant.status})`);

		const delCallerB = await entuFetch(cfg.db, `entity/${callerBId}`, cfg.token, { method: 'DELETE' });
		console.log(`  DELETE Caller B ${callerBId}: ${delCallerB.ok ? 'OK' : 'FAILED'} (${delCallerB.status})`);
		ledger.push({ step: 'cleanup-delete-caller-b', outcome: delCallerB.ok ? 'deleted' : 'delete-failed', callerBId, status: delCallerB.status });
		if (!delCallerB.ok) orphans.push(`Caller B ${callerBId} (status ${delCallerB.status})`);

		console.log(`\n${orphans.length === 0 ? '>> Full teardown, nothing orphaned, all independently re-verified.' : `>> ORPHANED, on the record: ${orphans.join('; ')}`}`);
		ledger.push({ step: 'orphan-summary', outcome: orphans.length === 0 ? 'clean' : 'orphans-present', orphans });
	}

	const failures = ledger.filter((e) => e.outcome === 'delete-failed' || e.outcome === 'orphans-present');
	console.log(`\n${ledger.length} ledger steps, ${failures.length} failure-flagged`);

	const artifactPath = writeLedger({
		scriptName: 'probe-301-blank-invite-editor',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#301 — does the blank createInvite() path require _owner on the database entity, or does _editor succeed? Team-lead authorized 2026-09-09, same shape as the #294 admin-invite-cascade probe. Polyphony only.',
			orphans,
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('probe-301-blank-invite-editor ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
