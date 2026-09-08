// mvox-app#294 follow-up — Gap A (unredeemed-invite population) + Gap B
// (per-rights-level private-property read), polyphony only, PO-authorized
// 2026-09-08 following the plan sent to team-lead the same day. DRY_RUN
// default via the shared runner.
//
// GAP A — mint ONE throwaway invite via inviteData.ts's OWN createInvite()
// (person create -> self-_editor grant -> member create), proving the
// THREE STATES are distinguishable: never-invited (entu_user key absent —
// demonstrated via the new MEMBER entity, which never carries this
// property at all, no extra fixture needed), unredeemed placeholder (the
// new person, masked '***'), redeemed (any existing bound person,
// re-verified fresh). Disposition: DELETE both after the reads (team-lead
// ruling 2026-09-08, my own recommendation — no future use, unlike #275's
// SMOKE fixture, and a standing unredeemed invite risks polluting a real
// headcount).
//
// DISCRIMINATOR (team-lead addendum, one-probe-two-answers, Henry-
// endorsed): immediately after createInvite() completes, read the fresh
// person's rights-as-they-stand and compare against what the client code
// SENT (self-_editor to the PERSON only — nothing to the CALLER). A direct
// (non-inherited) caller grant present anyway = Entu auto-grants the
// creator something the client never asked for, at create time — explains
// the first #294 probe's two-direct-grant surprise. None present = those
// two persons predate or bypass the literal createInvite() path.
//
// GAP B — the load-bearing half, Mihkel's own question verbatim ("if all
// domain could read person.entu_user?"): does a caller holding EXACTLY
// _viewer / _expander / _editor (no owner, nothing else) read a
// private-tier property? SEQUENTIAL, STOP AT THE FIRST POSITIVE (team-lead
// addendum 2026-09-08): viewer alone, then expander alone, then editor
// alone ONLY if both weaker levels came back negative — rights are
// monotonic, so a positive at any level already answers the question and
// escalating further adds nothing. GRANT CONSTRUCTION, stated not left
// implicit: every grant here is DIRECT (an explicit `{type: level,
// reference: testerId}` POST on the target itself), never inherited — an
// inherited-only single-level grant would require writing on the db ROOT,
// which cascades to every entity in the db and is far too broad a mutation
// for an isolated test. Gap A's minted person doubles as the TARGET
// (already private-tier entu_user, no second fixture needed). For each
// level: one throwaway synthetic person (holds nothing but an
// entu_api_key), one explicit single-level grant on the target, one read
// via that identity's own JWT. TWO QUESTIONS KEPT SEPARATE throughout: (1)
// polyphony platform behavior per level — this run settles it; (2) crede's
// actual configuration — NOT touched, NOT inferred here.
//
// STAKES (recorded, not asserted): #181 flipped 14 person prop-defs
// domain->private on crede as a privacy measure. If a rights-holding
// viewer bypasses property sharing, that control may be inert against
// exactly its intended readers. This script asserts nothing — the result
// decides, positive or negative, and either is reported with equal
// weight. If ANY level CAN read: report factually and STOP — the crede
// question routes to Mihkel with the mechanism named, never acted on here.
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-294-gap-a-b-rights-level-2026-09-08.ts   # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-294-gap-a-b-rights-level-2026-09-08.ts   # ONLY after team-lead's single explicit authorization

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { createInvite, INVITE_MINT_TRIGGER } from '$lib/invite/inviteData';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

// Recommendation, overridable: DELETE the gap-A fixture after the reads
// (clean teardown — see module doc). Set KEEP_GAP_A_FIXTURE=true to stand
// it up permanently instead (team-lead's call, not this script's default).
const KEEP_GAP_A_FIXTURE = (process.env.KEEP_GAP_A_FIXTURE ?? 'false').toLowerCase() === 'true';

const RIGHTS_LEVELS = ['_viewer', '_expander', '_editor'] as const;
type RightsLevel = (typeof RIGHTS_LEVELS)[number];

interface LedgerEntry {
	step: string;
	outcome: string;
	[key: string]: unknown;
}

async function getEntuUserRaw(db: string, token: string, personId: string): Promise<{ status: number; body: unknown }> {
	const res = await fetch(`https://api.entu.app/${db}/entity/${personId}?props=entu_user`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
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

	const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, { headers: { Authorization: `Bearer ${process.env.ENTU_API_KEY}`, Accept: 'application/json' } });
	const authBody = (await authRes.json()) as { accounts?: Array<{ user?: { _id?: string } }> };
	const callerId = authBody.accounts?.[0]?.user?._id ?? '(unresolved)';
	console.log(`Caller identity: ${callerId}`);

	if (DRY_RUN) {
		console.log('\n=== GAP A (dry-run: would-do, nothing executed) ===');
		console.log('Would call createInvite() — person create (entu_user=trigger) -> self-_editor grant -> member create.');
		console.log('Would compare the fresh person\'s rights-as-they-stand against what createInvite() sent (nothing to the caller) — the auto-grant discriminator.');
		console.log('Would GET the new person\'s entu_user (expect masked placeholder) and the new member\'s entu_user (expect key absent).');
		console.log(`Disposition if run live: ${KEEP_GAP_A_FIXTURE ? 'KEEP as standing fixture (KEEP_GAP_A_FIXTURE=true)' : 'DELETE both person+member after reads (team-lead ruling + my recommendation)'}`);
		ledger.push({ step: 'gap-a', outcome: 'dry-run-would-run' });

		console.log('\n=== GAP B (dry-run: would-do, nothing executed) ===');
		console.log('SEQUENTIAL, stop at the first positive: viewer alone -> expander alone -> editor alone (editor only if both weaker levels are negative). Every grant is DIRECT (explicit POST on the target), never inherited — an inherited-only grant would require writing on the db root, too broad for an isolated test.');
		for (const level of RIGHTS_LEVELS) {
			console.log(`  Would create one throwaway tester person, mint an entu_api_key on it, grant EXACTLY ${level} on the gap-A target, then read entu_user via that identity's JWT.`);
		}
		console.log('Would clean up: one rights-grant property-value DELETE + one tester-person entity DELETE per level actually tested (fewer than 3 if an earlier level stops the sequence).');
		ledger.push({ step: 'gap-b', outcome: 'dry-run-would-run', levels: RIGHTS_LEVELS, ordering: 'sequential-stop-at-first-positive', grantKind: 'direct' });
	} else {
		// ─── GAP A ───────────────────────────────────────────────────────────
		console.log('\n=== GAP A — LIVE ===');
		const { personId: targetId, memberId } = await createInvite(cfg, { dbEntityId });
		console.log(`Person created: ${targetId}`);
		console.log(`Member created: ${memberId}`);
		ledger.push({ step: 'gap-a-create-invite', outcome: 'created', personId: targetId, memberId });

		// DISCRIMINATOR (team-lead addendum, one-probe-two-answers, Henry-
		// endorsed): createInvite() SENDS the caller nothing directly — only
		// a self-_editor grant on the new person, to the person itself. If
		// the caller's own identity shows up on this FRESH mint with a
		// DIRECT (non-inherited) grant anyway, that is Entu auto-granting
		// the creator something the client never asked for — confirming the
		// surprise from the first #294 probe rather than leaving it open.
		const rightsRes = await entuFetch(cfg.db, `entity/${targetId}?props=_owner,_editor,_viewer,_expander`, cfg.token);
		const rightsBody = (await rightsRes.json()) as {
			entity?: Record<string, Array<{ reference?: string; inherited?: boolean }> | undefined>;
		};
		const rightsEntity = rightsBody.entity ?? {};
		const callerGrants: Record<string, string> = {};
		for (const key of ['_owner', '_editor', '_viewer', '_expander']) {
			const row = (rightsEntity[key] ?? []).find((r) => r.reference === callerId);
			callerGrants[key] = !row ? 'absent' : row.inherited === true ? 'inherited' : 'direct';
		}
		console.log(`Discriminator — caller's own grants on the FRESH mint (createInvite sent NONE of these explicitly): ${JSON.stringify(callerGrants)}`);
		const anyDirect = Object.values(callerGrants).some((v) => v === 'direct');
		console.log(anyDirect
			? '  >> AUTO-GRANT CONFIRMED: a direct grant is present that the client never sent — Entu grants the creator something at create time regardless of payload. Explains the first probe\'s surprise.'
			: '  >> NO auto-grant on this fresh mint — the first probe\'s two direct-grant persons likely predate or bypass the literal createInvite() path.');
		ledger.push({ step: 'gap-a-auto-grant-discriminator', outcome: anyDirect ? 'auto-grant-confirmed' : 'no-auto-grant', callerId, callerGrants });

		const placeholderRead = await getEntuUserRaw(cfg.db, cfg.token, targetId);
		console.log(`State 2 (unredeemed placeholder) — GET person.entu_user: HTTP ${placeholderRead.status} — ${JSON.stringify(placeholderRead.body)}`);
		ledger.push({ step: 'gap-a-state-unredeemed', outcome: String(placeholderRead.status), shape: placeholderRead.body });

		const absentRead = await getEntuUserRaw(cfg.db, cfg.token, memberId);
		console.log(`State 1 (never-invited shape, via member — property never exists) — GET member.entu_user: HTTP ${absentRead.status} — ${JSON.stringify(absentRead.body)}`);
		ledger.push({ step: 'gap-a-state-absent-via-member', outcome: String(absentRead.status), shape: absentRead.body });

		// Re-verify one existing redeemed person fresh, for the 3rd state.
		const personsRes = await entuFetch(cfg.db, `entity?_type.string=person&props=entu_user&limit=100`, cfg.token);
		const personsBody = (await personsRes.json()) as { entities: Array<{ _id: string; entu_user?: Array<Record<string, unknown>> }> };
		const redeemedSample = personsBody.entities.find((p) => (p.entu_user ?? []).some((e) => 'uid' in e) && p._id !== targetId);
		if (redeemedSample) {
			const redeemedRead = await getEntuUserRaw(cfg.db, cfg.token, redeemedSample._id);
			console.log(`State 3 (redeemed) — GET person.entu_user: HTTP ${redeemedRead.status} — ${JSON.stringify(redeemedRead.body)}`);
			ledger.push({ step: 'gap-a-state-redeemed', outcome: String(redeemedRead.status), personId: redeemedSample._id, shape: redeemedRead.body });
		}

		// ─── GAP B ───────────────────────────────────────────────────────────
		console.log('\n=== GAP B — LIVE ===');
		const grantDeletes: Array<{ level: RightsLevel; propId: string }> = [];
		const testerIds: string[] = [];

		for (const level of RIGHTS_LEVELS) {
			console.log(`\n--- level ${level} ---`);
			// Bn.1 create tester person
			const createRes = await entuFetch(cfg.db, 'entity', cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([
					{ type: '_type', reference: personTypeId },
					{ type: '_parent', reference: dbEntityId }
				])
			});
			if (!createRes.ok) throw new Error(`gap-b tester create (${level}) failed: ${createRes.status}`);
			const createBody = (await createRes.json()) as { _id?: string };
			if (!createBody._id) throw new Error(`gap-b tester create (${level}) returned no _id`);
			const testerId = createBody._id;
			testerIds.push(testerId);
			console.log(`  tester person: ${testerId}`);
			ledger.push({ step: `gap-b-${level}-create-tester`, outcome: 'created', testerId });

			// Bn.2 mint entu_api_key. WIRE-SHAPE NOTE (live-observed 2026-09-08,
			// entu-www/api/authentication/index.md:114 says "create the
			// property with no value" — a bare `{type:'entu_api_key'}` with NO
			// value key at all 400s live: "Property must have at least one
			// value". An explicit `string: ''` satisfies the wire's own
			// generic value-presence check and the server still ignores it and
			// generates the real key — confirmed live, this exact shape
			// returned a real 32-byte key. Doc describes the INTENT (no
			// meaningful value needed) correctly; its literal wire example is
			// imprecise for this property type. Not filed upstream — Argo
			// routing per the standing platform-behavior channel is
			// team-lead's call, not this script's.
			const keyRes = await entuFetch(cfg.db, `entity/${testerId}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ type: 'entu_api_key', string: '' }])
			});
			if (!keyRes.ok) throw new Error(`gap-b api-key mint (${level}) failed: ${keyRes.status}`);
			const keyBody = (await keyRes.json()) as { properties?: Array<{ type?: string; string?: string }> };
			const rawKey = (keyBody.properties ?? []).find((p) => p.type === 'entu_api_key')?.string;
			if (!rawKey) throw new Error(`gap-b api-key mint (${level}): response carried no raw key — apparent-success trap`);
			console.log(`  entu_api_key minted (never logged/persisted)`);
			ledger.push({ step: `gap-b-${level}-mint-key`, outcome: 'minted', testerId, note: 'raw key never logged or persisted' });

			// Bn.3 grant exactly this level on the target
			const grantRes = await entuFetch(cfg.db, `entity/${targetId}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ type: level, reference: testerId }])
			});
			if (!grantRes.ok) throw new Error(`gap-b grant (${level}) failed: ${grantRes.status}`);
			const grantBody = (await grantRes.json()) as { properties?: Array<{ type?: string; _id?: string }> };
			const grantPropId = (grantBody.properties ?? []).find((p) => p.type === level)?._id;
			if (!grantPropId) throw new Error(`gap-b grant (${level}) returned 2xx without a matching property _id`);
			grantDeletes.push({ level, propId: grantPropId });
			console.log(`  granted ${level} on target ${targetId} (property ${grantPropId})`);
			ledger.push({ step: `gap-b-${level}-grant`, outcome: 'granted', targetId, propId: grantPropId });

			// Exchange the tester's own key for a JWT, then read.
			const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, { headers: { Authorization: `Bearer ${rawKey}`, Accept: 'application/json' } });
			const authBody = (await authRes.json()) as { token?: string };
			if (!authBody.token) throw new Error(`gap-b auth exchange (${level}) failed or returned no token`);

			const levelRead = await getEntuUserRaw(cfg.db, authBody.token, targetId);
			console.log(`  READ target.entu_user AS ${level}-only caller: HTTP ${levelRead.status} — ${JSON.stringify(levelRead.body)}`);
			const bodyStr = JSON.stringify(levelRead.body);
			const canRead = levelRead.status === 200 && bodyStr.includes('entu_user') && !bodyStr.includes('"entu_user":[]');
			ledger.push({ step: `gap-b-${level}-read`, outcome: String(levelRead.status), level, targetId, shape: levelRead.body, canRead });

			// Mihkel's ordering (2026-09-08 addendum): viewer -> expander ->
			// editor, STOP at the first positive — a positive at any level
			// already answers "does entity-rights-only bypass property
			// sharing" and rights are monotonic (a stronger level would only
			// confirm the same thing), so escalating further adds no new
			// information. `_editor` is reached ONLY when both weaker levels
			// came back negative.
			if (canRead) {
				console.log(`  >> ${level} CAN read the private-tier property. Reporting factually and STOPPING — no further levels tested. The crede-configuration question routes to Mihkel with this mechanism named, not acted on here.`);
				ledger.push({ step: 'gap-b-early-stop', outcome: 'stopped', atLevel: level, reason: 'positive result — further escalation adds no new information' });
				break;
			} else {
				console.log(`  >> ${level} CANNOT read the private-tier property.${level !== '_editor' ? ' Escalating to the next level.' : ''}`);
			}
		}

		// ─── CLEANUP ─────────────────────────────────────────────────────────
		console.log('\n=== CLEANUP ===');
		for (const { level, propId } of grantDeletes) {
			const delRes = await entuFetch(cfg.db, `property/${propId}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE ${level} grant (property ${propId}): ${delRes.ok ? 'OK' : 'FAILED'} (${delRes.status})`);
			ledger.push({ step: `cleanup-delete-grant-${level}`, outcome: delRes.ok ? 'deleted' : 'delete-failed', status: delRes.status, propId });
		}
		for (const testerId of testerIds) {
			const delRes = await entuFetch(cfg.db, `entity/${testerId}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE tester person ${testerId}: ${delRes.ok ? 'OK' : 'FAILED'} (${delRes.status})`);
			ledger.push({ step: 'cleanup-delete-tester', outcome: delRes.ok ? 'deleted' : 'delete-failed', status: delRes.status, testerId });
		}

		if (!KEEP_GAP_A_FIXTURE) {
			const delMember = await entuFetch(cfg.db, `entity/${memberId}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE gap-A member ${memberId}: ${delMember.ok ? 'OK' : 'FAILED'} (${delMember.status})`);
			ledger.push({ step: 'cleanup-delete-gap-a-member', outcome: delMember.ok ? 'deleted' : 'delete-failed', status: delMember.status, memberId });

			const delPerson = await entuFetch(cfg.db, `entity/${targetId}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE gap-A person ${targetId}: ${delPerson.ok ? 'OK' : 'FAILED'} (${delPerson.status})`);
			ledger.push({ step: 'cleanup-delete-gap-a-person', outcome: delPerson.ok ? 'deleted' : 'delete-failed', status: delPerson.status, targetId });
		} else {
			console.log(`  gap-A fixture KEPT standing per KEEP_GAP_A_FIXTURE=true: person ${targetId}, member ${memberId}`);
			ledger.push({ step: 'gap-a-fixture-disposition', outcome: 'kept-standing', targetId, memberId });
		}
	}

	const failures = ledger.filter((e) => e.outcome === 'failed' || e.outcome === 'delete-failed');
	console.log(`\n${ledger.length} ledger steps, ${failures.length} failures`);

	const artifactPath = writeLedger({
		scriptName: 'probe-294-gap-a-b-rights-level',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#294 follow-up (PO-authorized 2026-09-08) — Gap A: unredeemed-invite population + 3-state distinguishability. Gap B: per-rights-level (_viewer/_expander/_editor) private-property read test. Question (1) polyphony platform behavior settled here; question (2) crede configuration NOT touched, NOT inferred.',
			keepGapAFixture: KEEP_GAP_A_FIXTURE,
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('probe-294-gap-a-b-rights-level ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
