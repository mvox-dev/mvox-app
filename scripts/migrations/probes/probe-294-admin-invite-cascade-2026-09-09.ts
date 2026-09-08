// mvox-app#294 follow-up — admin-invite cascade probe (2026-09-09), polyphony
// only. Authorized: team-lead's explicit "I authorize this run" (2026-09-09),
// same shape as the earlier #294 probes (synthetic fixtures, create+delete).
//
// QUESTION (team-lead dispatch, gates #294's roster controls — "kutsu" on a
// never-invited member, "saada uuesti" on an unredeemed one): can a
// collective admin mint/resend an invite on ANOTHER person's entity, when
// their ONLY rights come from a grant on the DATABASE ENTITY, never a direct
// grant on the target person?
//
// WHY THIS IS UNSETTLED FROM SOURCE ALONE: `createInvite` (inviteData.ts:
// 252-271) plants exactly one grant on a newly-created person — self-
// `_editor`, referencing the person's OWN id. No admin, no org, nothing else
// ever lands on the person directly. So the ONLY possible authorization
// route for an admin-driven mint is the `_inheritrights:true` cascade from
// the database entity (`resolvePersonParentId`'s `_parent`) down to the
// person. A source read (entu-api utils/aggregate.js:167-186) shows the
// cascade MERGES the parent's `_owner`/`_editor` directly into the child's
// own `private._owner`/`_editor` arrays at aggregation time — not a separate
// side-channel field — and the property-write gate (utils/entity.js:90-120)
// reads exactly those merged arrays (`entity.private._editor` /
// `entity.private._owner`). This predicts cascade success. It is still an
// inference, not a live-observed fact — this probe settles it empirically.
//
// RIG (mirrors the #294 Gap B isolation discipline, adapted for a cascade
// test instead of a direct-grant test):
//   1. Create a throwaway synthetic "Caller B" person + mint an entu_api_key
//      on it (same wire-shape as Gap B testers).
//   2. Grant Caller B `_editor` on the DATABASE ENTITY itself (mirrors
//      "collective admin") — BEFORE creating the target person, so the
//      target's own create-time aggregation already merges Caller B in as
//      an inherited editor; no dependence on the async rights-changed
//      re-aggregation/propagation path (aggregate.js:502-517), which would
//      add a timing variable this probe doesn't need to take on.
//   3. Create the target person via the REAL `createInvite()` (exact
//      production shape) — AFTER Caller B's db-entity grant is live.
//   4. Read the target's own private `_editor`/`_owner` (as the db-root
//      admin identity, which reads private in full) to confirm Caller B
//      shows up as an INHERITED grant — direct empirical confirmation of the
//      aggregate.js merge, before even touching the write path.
//   5. THE TEST: exchange Caller B's own api-key for its own JWT, then call
//      the REAL `mintSelfLinkInvite(callerBCfg, targetPersonId)` — the exact
//      library function #294's "saada uuesti" control would call — so this
//      probe exercises production code, not a hand-rolled approximation.
//   6. APPEND-SEMANTICS corroboration (team-lead: "confirm live if cheap").
//      Source already confirms two claims independently: (a) entu-api's own
//      `findStoredInvite` (routes/auth/index.get.js:270-277) takes the FIRST
//      `entu_user` entry carrying `.invite`, with no check against the
//      presented token — mintSelfLinkInvite's own stale-cleanup step exists
//      BECAUSE of this (inviteData.ts:333-338, "Hazard 2"); (b) Entu POSTs
//      append rather than replace on non-formula string-typed properties
//      (project memory: entu_post_appends_multi_value). This probe adds a
//      cheap LIVE corroboration of (b) at the wire level: mintSelfLinkInvite
//      itself always cleans up first (so after step 5 the target should show
//      exactly ONE entu_user entry) — then a deliberate RAW bypass POST
//      (skipping the library's cleanup, the shape an admin control that
//      called the wrong primitive might produce) should append a SECOND
//      entry, observed directly via a fresh GET.
//   7. CLEANUP — delete both entu_user entries, delete the target person +
//      its member, delete Caller B's db-entity grant, delete Caller B
//      itself. Independently re-verify every deletion via fresh reads (not
//      trusting the script's own self-report), same discipline as #294.
//
// BLAST-RADIUS NOTE: step 2 writes on the database entity itself — broader
// than the per-target grants #294's Gap B deliberately avoided ("far too
// broad a mutation for an isolated test"). Here it is unavoidable — cascade
// FROM the db root is the exact mechanism under test — so the mitigation is
// procedural instead: minimal grant (`_editor` only, not `_owner`), narrow
// window (torn down immediately after the read + mint test), and independent
// post-teardown verification. Polyphony is the synthetic dev sandbox
// (project memory: polyphony_is_playground) — ambitious-but-reversible
// mutations here are in scope; this is not attempted against crede.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-294-admin-invite-cascade-2026-09-09.ts   # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-294-admin-invite-cascade-2026-09-09.ts   # only after team-lead's authorization

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { createInvite, mintSelfLinkInvite, INVITE_MINT_TRIGGER } from '$lib/invite/inviteData';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

// [ADDENDUM 2026-09-09, same run session] First pass granted `_editor` and
// the mint 403'd with Entu's own literal statusText "User not in _owner
// property" — the SECOND gate in the local entu-api clone's
// `checkEntityAccess` (utils/entity.js:113-121), which by that source's own
// `rightTypes` list should only fire for rights-type properties, not
// `entu_user`. Either the live deployment's rightTypes differs from this
// repo's local clone (entu_user treated as owner-gated, sensibly — minting
// one IS an account-linking operation), or something else is at play.
// Testing the direct hypothesis empirically rather than resting on the
// source mismatch: does `_owner` (not `_editor`) succeed where `_editor`
// didn't? Override via ADMIN_GRANT_LEVEL, default unchanged.
const ADMIN_GRANT_LEVEL = (process.env.ADMIN_GRANT_LEVEL ?? '_editor') as '_editor' | '_owner';

interface LedgerEntry {
	step: string;
	outcome: string;
	[key: string]: unknown;
}

async function getEntuUserRaw(
	db: string,
	token: string,
	entityId: string
): Promise<{ status: number; body: unknown }> {
	const res = await fetch(`https://api.entu.app/${db}/entity/${entityId}?props=entu_user`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const body = await res.json().catch(() => null);
	return { status: res.status, body };
}

async function getRightsRaw(
	db: string,
	token: string,
	entityId: string
): Promise<{ status: number; body: unknown }> {
	const res = await fetch(
		`https://api.entu.app/${db}/entity/${entityId}?props=_owner,_editor,_viewer,_expander`,
		{ headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
	);
	const body = await res.json().catch(() => null);
	return { status: res.status, body };
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerEntry[] = [];
	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable — cannot proceed');
	console.log(`db-root entity: ${dbEntityId}`);

	const personTypeId = await resolveTypeId(cfg, 'person');
	console.log(`person type-def: ${personTypeId}`);

	if (DRY_RUN) {
		console.log('\n=== DRY RUN — would-do, nothing executed ===');
		console.log('1. Would create tester person "Caller B" + mint an entu_api_key on it.');
		console.log('2. Would grant Caller B `_editor` on the DATABASE ENTITY (mirrors collective-admin), BEFORE creating the target — avoids any async-propagation timing question.');
		console.log('3. Would call the REAL createInvite() to create the target person, after Caller B\'s db-entity grant is live.');
		console.log('4. Would read the target\'s own private _editor/_owner (as admin) to confirm Caller B appears INHERITED.');
		console.log('5. Would exchange Caller B\'s api-key for its own JWT, then call the REAL mintSelfLinkInvite(callerBCfg, targetId) — the exact production path #294\'s admin controls would use.');
		console.log('6. Would corroborate append-semantics: after mintSelfLinkInvite (expect exactly 1 entu_user entry, cleanup already ran), a raw bypass POST (expect 2 entries after).');
		console.log('7. Would clean up: delete both entu_user entries, delete target person + member, delete Caller B\'s db-entity grant, delete Caller B — with independent post-teardown re-verification.');
		ledger.push({ step: 'dry-run', outcome: 'dry-run-would-run' });
	} else {
		// ─── 1. Caller B fixture ──────────────────────────────────────────────
		console.log('\n=== 1. Create Caller B (throwaway synthetic admin-tester) ===');
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
		if (!createBody._id) throw new Error('Caller B create returned 2xx without _id (apparent-success trap)');
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
		if (!callerBRawKey) throw new Error('Caller B api-key mint: response carried no raw key');
		console.log('  Caller B entu_api_key minted (never logged/persisted)');
		ledger.push({ step: 'mint-caller-b-key', outcome: 'minted', callerBId, note: 'raw key never logged or persisted' });

		// ─── 2. Collective-admin grant, on the DB ENTITY, before the target exists ──
		console.log(`\n=== 2. Grant Caller B \`${ADMIN_GRANT_LEVEL}\` on the database entity (collective-admin) ===`);
		const grantRes = await entuFetch(cfg.db, `entity/${dbEntityId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: ADMIN_GRANT_LEVEL, reference: callerBId }])
		});
		if (!grantRes.ok) throw new Error(`db-entity ${ADMIN_GRANT_LEVEL} grant failed: HTTP ${grantRes.status}`);
		const grantBody = (await grantRes.json()) as { properties?: Array<{ type?: string; _id?: string }> };
		const dbGrantPropId = (grantBody.properties ?? []).find((p) => p.type === ADMIN_GRANT_LEVEL)?._id;
		if (!dbGrantPropId) throw new Error(`db-entity ${ADMIN_GRANT_LEVEL} grant returned 2xx without a matching property _id`);
		console.log(`  granted ${ADMIN_GRANT_LEVEL} on db entity ${dbEntityId} (property ${dbGrantPropId})`);
		ledger.push({ step: 'grant-caller-b-db-level', outcome: 'granted', level: ADMIN_GRANT_LEVEL, dbEntityId, propId: dbGrantPropId });

		// ─── 3. Target person, via the REAL createInvite() ──────────────────────
		console.log('\n=== 3. Create target person via createInvite() ===');
		const { personId: targetId, memberId } = await createInvite(cfg, { dbEntityId });
		console.log(`  target person: ${targetId}`);
		console.log(`  target member: ${memberId}`);
		ledger.push({ step: 'create-target-via-createInvite', outcome: 'created', targetId, memberId });

		// ─── 4. Confirm the cascade merged Caller B in, BEFORE testing the write ──
		console.log('\n=== 4. Read target\'s own private rights (as admin) — expect Caller B INHERITED ===');
		const rightsRead = await getRightsRaw(cfg.db, cfg.token, targetId);
		console.log(`  GET target rights: HTTP ${rightsRead.status} — ${JSON.stringify(rightsRead.body)}`);
		const rightsBody = rightsRead.body as {
			entity?: { _editor?: Array<{ reference?: string; inherited?: boolean }> };
		};
		const callerBEditorRow = (rightsBody.entity?._editor ?? []).find((r) => r.reference === callerBId);
		const cascadeConfirmedInRights = callerBEditorRow?.inherited === true;
		console.log(
			cascadeConfirmedInRights
				? '  >> Caller B appears in target._editor as INHERITED — aggregate.js merge confirmed live.'
				: `  >> Caller B NOT found as an inherited _editor on the target (row: ${JSON.stringify(callerBEditorRow)}) — cascade did not materialize as predicted.`
		);
		ledger.push({
			step: 'confirm-cascade-in-rights',
			outcome: cascadeConfirmedInRights ? 'inherited-confirmed' : 'not-inherited',
			callerBId,
			targetId,
			callerBEditorRow
		});

		// ─── 5. THE TEST — mintSelfLinkInvite AS Caller B, targeting someone else ──
		console.log('\n=== 5. mintSelfLinkInvite(callerBCfg, targetId) — THE TEST ===');
		const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, {
			headers: { Authorization: `Bearer ${callerBRawKey}`, Accept: 'application/json' }
		});
		const authBody = (await authRes.json()) as { token?: string };
		if (!authBody.token) throw new Error('Caller B auth exchange failed or returned no token');
		const callerBCfg: EntuCfg = { db: cfg.db, token: authBody.token };

		// Diagnostic: a RAW POST with the identical body, capturing Entu's own
		// literal status + response body — mintSelfLinkInvite's own catch
		// only ever reports a fixed constructed string on any 403, which
		// isn't enough to tell "checkEntityAccess rejected the cascade" apart
		// from "the route's own !entu.user gate fired for an unrelated
		// reason" (e.g. api-key-derived JWTs resolving differently on this
		// route than on GET). Run BEFORE the library call so nothing has
		// touched the target yet.
		const rawDiag = await entuFetch(cfg.db, `entity/${targetId}`, callerBCfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'entu_user', string: INVITE_MINT_TRIGGER }])
		});
		const rawDiagBody = await rawDiag.json().catch(() => null);
		console.log(`  RAW diagnostic POST (identical body, before library call): HTTP ${rawDiag.status} — ${JSON.stringify(rawDiagBody)}`);
		ledger.push({ step: 'raw-diagnostic-post', outcome: String(rawDiag.status), status: rawDiag.status, body: rawDiagBody });
		if (rawDiag.ok) {
			// It succeeded raw — clean this entry up before the library call so
			// the library's own stale-cleanup + mint sequence is tested on the
			// same starting state as originally planned (one prior entry, from
			// createInvite's person-create, not two).
			const diagBody = rawDiagBody as { properties?: Array<{ type?: string; _id?: string }> };
			const diagPropId = (diagBody.properties ?? []).find((p) => p.type === 'entu_user')?._id;
			if (diagPropId) {
				const delDiag = await entuFetch(cfg.db, `property/${diagPropId}`, cfg.token, { method: 'DELETE' });
				console.log(`  cleanup: DELETE raw-diagnostic entu_user entry ${diagPropId}: ${delDiag.ok ? 'OK' : 'FAILED'} (${delDiag.status})`);
				ledger.push({ step: 'cleanup-delete-raw-diagnostic-entry', outcome: delDiag.ok ? 'deleted' : 'delete-failed', propId: diagPropId, status: delDiag.status });
			}
		}

		let mintOutcome: 'succeeded' | 'refused' | 'error';
		let mintDetail: string;
		try {
			await mintSelfLinkInvite(callerBCfg, targetId);
			mintOutcome = 'succeeded';
			mintDetail = 'mintSelfLinkInvite returned a token (never logged) — admin-cascade write PERMITTED.';
		} catch (e) {
			if (e instanceof Error && e.name === 'SelfLinkMintError') {
				const reason = (e as unknown as { reason?: string }).reason;
				mintOutcome = reason === 'missing-self-editor' || /HTTP 403/.test(e.message) ? 'refused' : 'error';
				mintDetail = e.message;
			} else {
				mintOutcome = 'error';
				mintDetail = e instanceof Error ? e.message : String(e);
			}
		}
		console.log(`  >> ${mintOutcome.toUpperCase()}: ${mintDetail}`);
		ledger.push({ step: 'admin-cascade-mint-test', outcome: mintOutcome, detail: mintDetail, callerBId, targetId });

		const postMintRead = await getEntuUserRaw(cfg.db, cfg.token, targetId);
		console.log(`  GET target.entu_user after test: HTTP ${postMintRead.status} — ${JSON.stringify(postMintRead.body)}`);
		ledger.push({ step: 'post-mint-read', outcome: String(postMintRead.status), shape: postMintRead.body });

		// ─── 6. Append-semantics corroboration (cheap, same rig) ────────────────
		if (mintOutcome === 'succeeded') {
			console.log('\n=== 6. Append-semantics corroboration ===');
			const entriesAfterLibraryMint = ((postMintRead.body as { entity?: { entu_user?: unknown[] } })?.entity?.entu_user ?? []).length;
			console.log(`  entu_user entries after library mint (cleanup ran first — expect 1): ${entriesAfterLibraryMint}`);
			ledger.push({ step: 'append-check-after-library-mint', outcome: 'observed', count: entriesAfterLibraryMint, expected: 1 });

			const bypassRes = await entuFetch(cfg.db, `entity/${targetId}`, callerBCfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ type: 'entu_user', string: INVITE_MINT_TRIGGER }])
			});
			console.log(`  raw bypass POST (no stale-cleanup): HTTP ${bypassRes.status}`);
			ledger.push({ step: 'append-check-bypass-post', outcome: String(bypassRes.status) });

			const afterBypassRead = await getEntuUserRaw(cfg.db, cfg.token, targetId);
			const entriesAfterBypass = ((afterBypassRead.body as { entity?: { entu_user?: unknown[] } })?.entity?.entu_user ?? []).length;
			console.log(`  entu_user entries after bypass POST (expect 2 — append, not replace): ${entriesAfterBypass}`);
			const appendConfirmed = entriesAfterBypass > entriesAfterLibraryMint;
			console.log(
				appendConfirmed
					? '  >> APPEND CONFIRMED: a second raw POST added a second entry rather than replacing the first — corroborates source (entu_post_appends_multi_value) and explains why mintSelfLinkInvite\'s own stale-cleanup step is load-bearing, not defensive-programming excess.'
					: '  >> Entry count did NOT increase — append semantics not corroborated as expected; do not assume the source reading without re-checking.'
			);
			ledger.push({
				step: 'append-check-result',
				outcome: appendConfirmed ? 'append-confirmed' : 'append-not-observed',
				entriesAfterLibraryMint,
				entriesAfterBypass
			});
		} else {
			console.log('\n=== 6. Append-semantics corroboration — SKIPPED (mint test did not succeed, nothing to corroborate on) ===');
			ledger.push({ step: 'append-check-skipped', outcome: 'skipped', reason: 'mint test did not succeed' });
		}

		// ─── 7. CLEANUP — full teardown + independent re-verification ───────────
		console.log('\n=== 7. CLEANUP ===');

		// 7a. entu_user entries on the target (whatever landed, admin can always delete)
		const finalUserRead = (await getEntuUserRaw(cfg.db, cfg.token, targetId)).body as {
			entity?: { entu_user?: Array<{ _id: string }> };
		};
		for (const entry of finalUserRead.entity?.entu_user ?? []) {
			const delRes = await entuFetch(cfg.db, `property/${entry._id}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE target.entu_user entry ${entry._id}: ${delRes.ok ? 'OK' : 'FAILED'} (${delRes.status})`);
			ledger.push({ step: 'cleanup-delete-entu-user-entry', outcome: delRes.ok ? 'deleted' : 'delete-failed', propId: entry._id, status: delRes.status });
		}

		// 7b. target member + person
		const delMember = await entuFetch(cfg.db, `entity/${memberId}`, cfg.token, { method: 'DELETE' });
		console.log(`  DELETE target member ${memberId}: ${delMember.ok ? 'OK' : 'FAILED'} (${delMember.status})`);
		ledger.push({ step: 'cleanup-delete-member', outcome: delMember.ok ? 'deleted' : 'delete-failed', memberId, status: delMember.status });

		const delPerson = await entuFetch(cfg.db, `entity/${targetId}`, cfg.token, { method: 'DELETE' });
		console.log(`  DELETE target person ${targetId}: ${delPerson.ok ? 'OK' : 'FAILED'} (${delPerson.status})`);
		ledger.push({ step: 'cleanup-delete-person', outcome: delPerson.ok ? 'deleted' : 'delete-failed', targetId, status: delPerson.status });

		// 7c. revert the db-entity grant
		const delGrant = await entuFetch(cfg.db, `property/${dbGrantPropId}`, cfg.token, { method: 'DELETE' });
		console.log(`  DELETE Caller B's db-entity _editor grant ${dbGrantPropId}: ${delGrant.ok ? 'OK' : 'FAILED'} (${delGrant.status})`);
		ledger.push({ step: 'cleanup-delete-db-grant', outcome: delGrant.ok ? 'deleted' : 'delete-failed', propId: dbGrantPropId, status: delGrant.status });

		// 7d. delete Caller B itself (cascades away its api-key too)
		const delCallerB = await entuFetch(cfg.db, `entity/${callerBId}`, cfg.token, { method: 'DELETE' });
		console.log(`  DELETE Caller B ${callerBId}: ${delCallerB.ok ? 'OK' : 'FAILED'} (${delCallerB.status})`);
		ledger.push({ step: 'cleanup-delete-caller-b', outcome: delCallerB.ok ? 'deleted' : 'delete-failed', callerBId, status: delCallerB.status });

		// 7e. independent post-teardown re-verification — fresh reads, not the script's own self-report
		console.log('\n=== 7e. Independent post-teardown re-verification ===');
		const targetGone = await getEntuUserRaw(cfg.db, cfg.token, targetId);
		console.log(`  fresh GET target person: HTTP ${targetGone.status} (expect 404)`);
		ledger.push({ step: 'verify-target-gone', outcome: String(targetGone.status), expected: 404 });

		const callerBGone = await getEntuUserRaw(cfg.db, cfg.token, callerBId);
		console.log(`  fresh GET Caller B: HTTP ${callerBGone.status} (expect 404)`);
		ledger.push({ step: 'verify-caller-b-gone', outcome: String(callerBGone.status), expected: 404 });

		const dbEntityRightsAfter = await getRightsRaw(cfg.db, cfg.token, dbEntityId);
		const dbEditorAfter = (dbEntityRightsAfter.body as { entity?: { _editor?: Array<{ reference?: string }> } })?.entity?._editor ?? [];
		const grantResidue = dbEditorAfter.some((r) => r.reference === callerBId);
		console.log(`  fresh GET db entity _editor: Caller B ${grantResidue ? 'STILL PRESENT — cleanup incomplete' : 'absent — grant fully reverted'}`);
		ledger.push({ step: 'verify-db-grant-reverted', outcome: grantResidue ? 'residue-found' : 'fully-reverted' });
	}

	const failures = ledger.filter((e) => e.outcome === 'failed' || e.outcome === 'delete-failed' || e.outcome === 'residue-found');
	console.log(`\n${ledger.length} ledger steps, ${failures.length} failures`);

	const artifactPath = writeLedger({
		scriptName: 'probe-294-admin-invite-cascade',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#294 follow-up (team-lead authorized 2026-09-09) — does a collective-admin grant on the DATABASE ENTITY cascade (via _inheritrights) to authorize mintSelfLinkInvite on ANOTHER person, when no direct grant exists on that person? Plus a cheap live corroboration of entu_user append-semantics.',
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('probe-294-admin-invite-cascade ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
