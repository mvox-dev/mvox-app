// mvox-app#294 — grant Joosep Loidap `_owner` on crede's database entity.
// Authorized: Mihkel confirmed directly to team-lead 2026-09-09 (not relayed);
// team-lead's explicit "I authorize this run" the same message. REAL PII db
// (mvox_crede) — narrow, single-target, no cleanup phase (the grant is meant
// to persist).
//
// WHY: my earlier polyphony probe (probe-294-admin-invite-cascade) found
// #294's three invite controls only work for a caller whose collective
// rights are `_owner` — `_editor`-only cascade gets a live 403 ("User not in
// _owner property"). My read-only crede check (2026-09-09, same day) found
// Joosep Loidap holds `_editor` on crede's db entity, direct, and is NOT in
// `_owner` at all. Without this grant, #294 ships invisible to the pilot's
// actual admin. Mihkel took the decision with the private-bucket
// consequence already in front of him (an entity-level grant admits the
// holder to the WHOLE private bucket — #294's own probe + #287's research
// both established this) — not re-litigated here.
//
// SCOPE, and nothing beyond it:
//   - Add Joosep to `_owner` on the DATABASE ENTITY only. No other entity,
//     no other collective, no other rights property.
//   - Do NOT remove his existing `_editor` — untouched. Owner folding into
//     editor in the aggregate (aggregate.js:186-190) is expected and
//     harmless — not this script's concern.
//   - Idempotent: if Joosep already holds a DIRECT `_owner` entry, this
//     script reports that and makes NO write.
//
// ENTU POSTS APPEND, NOT REPLACE (project memory:
// entu_post_appends_multi_value) — `_owner` already holds Mihkel + the db
// entity's own self-reference; the live run must show BOTH survive and
// EXACTLY ONE new entry land. Read-back is independent GETs, not the POST's
// own echo.
//
// NO CLEANUP PHASE. This grant is meant to persist — do not write any
// fixture, marker, or test entity alongside it.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/grant-294-joosep-owner-crede-2026-09-09.ts   # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/grant-294-joosep-owner-crede-2026-09-09.ts   # only after team-lead's authorization

import { entuFetch } from '$lib/entu/request';
import { loadCredeCfg, readDryRun } from './lib/script-runner';
import { writeLedger } from './lib/ledger-writer';

const DRY_RUN = readDryRun();

// Sourced from today's read-only crede check (2026-09-09) — already in hand,
// not a fresh PII fetch.
const JOOSEP_PERSON_ID = '6a92a3fdca67df980f41565d';

interface RightsRow {
	_id: string;
	reference?: string;
	string?: string;
	inherited?: boolean;
}

interface LedgerEntry {
	step: string;
	outcome: string;
	[key: string]: unknown;
}

async function getRightsRaw(
	db: string,
	token: string,
	entityId: string
): Promise<{ status: number; owner: RightsRow[]; editor: RightsRow[] }> {
	const res = await fetch(`https://api.entu.app/${db}/entity/${entityId}?props=_owner,_editor`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	const body = (await res.json().catch(() => null)) as {
		entity?: { _owner?: RightsRow[]; _editor?: RightsRow[] };
	} | null;
	return {
		status: res.status,
		owner: body?.entity?._owner ?? [],
		editor: body?.entity?._editor ?? []
	};
}

async function main(): Promise<void> {
	const cfg = await loadCredeCfg();
	const dbEntityId = process.env.MVOX_CREDE_DB_ENTITY_ID;
	if (!dbEntityId) throw new Error('MVOX_CREDE_DB_ENTITY_ID is not set — source ~/.config/mvox/credentials.env first');
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}, db entity=${dbEntityId}\n`);

	const ledger: LedgerEntry[] = [];

	console.log('=== BEFORE ===');
	const before = await getRightsRaw(cfg.db, cfg.token, dbEntityId);
	console.log(`  _owner (${before.owner.length}): ${JSON.stringify(before.owner)}`);
	console.log(`  _editor (${before.editor.length}): ${JSON.stringify(before.editor)}`);
	ledger.push({ step: 'read-before', outcome: 'observed', owner: before.owner, editor: before.editor });

	const existingDirectOwner = before.owner.find(
		(r) => r.reference === JOOSEP_PERSON_ID && r.inherited !== true
	);
	const joosepEditorBefore = before.editor.find((r) => r.reference === JOOSEP_PERSON_ID);

	if (existingDirectOwner) {
		console.log(`\n>> Joosep already holds a DIRECT _owner entry (${existingDirectOwner._id}) — idempotent no-op, no write made.`);
		ledger.push({ step: 'idempotency-check', outcome: 'already-granted', existingDirectOwner });
	} else if (DRY_RUN) {
		console.log('\n=== DRY RUN — would-do, nothing executed ===');
		console.log(`Would POST entity/${dbEntityId} with [{type:'_owner', reference:'${JOOSEP_PERSON_ID}'}].`);
		console.log('Would then independently GET _owner/_editor and verify: both pre-existing _owner entries survive, exactly one new entry lands, Joosep\'s existing _editor entry is untouched.');
		ledger.push({ step: 'dry-run', outcome: 'dry-run-would-run', target: JOOSEP_PERSON_ID });
	} else {
		console.log('\n=== GRANT — LIVE ===');
		const grantRes = await entuFetch(cfg.db, `entity/${dbEntityId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_owner', reference: JOOSEP_PERSON_ID }])
		});
		if (!grantRes.ok) throw new Error(`grant failed: HTTP ${grantRes.status}`);
		const grantBody = (await grantRes.json()) as { properties?: Array<{ type?: string; _id?: string }> };
		const newPropId = (grantBody.properties ?? []).find((p) => p.type === '_owner')?._id;
		if (!newPropId) throw new Error('grant returned 2xx without a matching _owner property _id (apparent-success trap)');
		console.log(`  granted _owner on ${dbEntityId} for Joosep (property ${newPropId})`);
		ledger.push({ step: 'grant', outcome: 'granted', dbEntityId, target: JOOSEP_PERSON_ID, propId: newPropId });

		console.log('\n=== AFTER — independent read-back ===');
		const after = await getRightsRaw(cfg.db, cfg.token, dbEntityId);
		console.log(`  _owner (${after.owner.length}): ${JSON.stringify(after.owner)}`);
		console.log(`  _editor (${after.editor.length}): ${JSON.stringify(after.editor)}`);
		ledger.push({ step: 'read-after', outcome: 'observed', owner: after.owner, editor: after.editor });

		const ownerCountDelta = after.owner.length - before.owner.length;
		const bothPriorSurvive = before.owner.every((b) => after.owner.some((a) => a._id === b._id));
		const newDirectOwnerRow = after.owner.find((r) => r.reference === JOOSEP_PERSON_ID && r._id === newPropId);
		const joosepEditorAfter = after.editor.find((r) => r.reference === JOOSEP_PERSON_ID);
		const editorUnchanged = joosepEditorBefore?._id === joosepEditorAfter?._id;

		console.log(`\n  owner count delta: ${ownerCountDelta} (expect exactly 1)`);
		console.log(`  both pre-existing _owner entries survive: ${bothPriorSurvive}`);
		console.log(`  new entry is a DIRECT _owner row for Joosep: ${Boolean(newDirectOwnerRow)} (inherited=${newDirectOwnerRow?.inherited ?? 'absent'})`);
		console.log(`  Joosep's pre-existing _editor entry unchanged: ${editorUnchanged} (before ${joosepEditorBefore?._id}, after ${joosepEditorAfter?._id})`);

		const verified = ownerCountDelta === 1 && bothPriorSurvive && Boolean(newDirectOwnerRow) && editorUnchanged;
		console.log(`\n  >> ${verified ? 'VERIFIED' : 'NOT VERIFIED — see detail above, do not report success'}`);
		ledger.push({
			step: 'verify',
			outcome: verified ? 'verified' : 'verification-failed',
			ownerCountDelta,
			bothPriorSurvive,
			newDirectOwnerRow,
			editorUnchanged,
			joosepEditorBefore,
			joosepEditorAfter
		});
	}

	const failures = ledger.filter((e) => e.outcome === 'verification-failed' || e.outcome === 'failed');
	console.log(`\n${ledger.length} ledger steps, ${failures.length} failures`);

	const artifactPath = writeLedger({
		scriptName: 'grant-294-joosep-owner-crede',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: true,
		payload: {
			purpose: "mvox-app#294 — grant Joosep Loidap _owner on crede's database entity, Mihkel-authorized 2026-09-09 (relayed via team-lead's explicit authorization), so #294's owner-gated invite controls are reachable by the pilot's actual admin. Idempotent, no cleanup phase — the grant persists by design.",
			target: JOOSEP_PERSON_ID,
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('grant-294-joosep-owner-crede ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
