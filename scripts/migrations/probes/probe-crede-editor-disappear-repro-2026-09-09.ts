// Reproduction: does adding `_owner` to a caller who already holds a
// standalone direct `_editor` on the same entity delete that `_editor`
// property? Polyphony only, synthetic, team-lead's explicit "I authorize a
// reproduction run" (2026-09-09) following the unexplained disappearance of
// Joosep Loidap's `_editor` on crede when he was granted `_owner`.
//
// PRIOR EVIDENCE (crede's own /history audit log, read-only, no write):
// `GET entity/{dbEntityId}/history` shows the EXACT SAME pattern occurring
// TWICE — once for Mihkel's own `_owner` grant on 2026-08-31 (his prior
// standalone `_editor` property, _id `...552f`, deleted 0.1s after his
// `_owner` property, _id `...a04`, was created) and again for Joosep's on
// 2026-09-09 (`_editor` `...5a05` deleted 43ms after `_owner` `...aa76`
// landed) — both attributed (`by`) to the SAME identity that made the
// `_owner` POST. Entu retains history for deleted properties: the
// `property` collection keeps a `deleted:{at,by}` document rather than
// physically removing it (entu-api utils/entity.js:549-564,
// `markPropertiesDeleted`), and `/history` unions the not-deleted and
// deleted views (routes/[db]/entity/[_id]/history.get.js). This ALSO
// answers the separate `[unverified]` question about history retention.
//
// MECHANISM, source-read before this probe (not asserted, this probe tests
// it): `insertProperties` (entu-api utils/entity.js:432-441) marks a
// property `oldPIds`-deleted ONLY IF THE CLIENT'S OWN POST PAYLOAD CARRIES
// THAT PROPERTY'S `_id` — a generic upsert-replace-by-id, type-agnostic (it
// does not check the old property's type matches the new one). Entu.app's
// own Rights drawer (`~/projects/webapp/app/components/entity/drawer/
// rights.vue:142-151`, `onEditRight`) implements "change this person's
// tier" by calling `apiUpsertEntity(entityId, [{ _id: <the CURRENT
// property's _id, whatever tier>, type: '_${newTier}', reference }])` — a
// single dropdown action that LOOKS like "change the tier" to the admin
// using it but is implemented as delete-old-insert-new. This is the
// leading hypothesis for how Mihkel's own admin action produced this
// without him experiencing it as a delete.
//
// FOUR SCENARIOS, all on throwaway synthetic testers + the polyphony
// database entity, all torn down:
//   A. BARE APPEND CONTROL — editor (bare POST, no _id), then owner (bare
//      POST, no _id). Predict: BOTH survive. Confirms the append rule holds
//      for genuine appends — this is NOT what crede did.
//   B. REPRODUCTION — editor (bare, record _id), then owner WITH `_id` set
//      to the editor property's _id (entu.app's exact upsert shape).
//      Predict: editor property soft-deleted (404 direct GET).
//   C. ORDER FLIP — owner (bare, record _id), then editor WITH `_id` = the
//      owner property's _id. Predict: owner disappears too — tests whether
//      the mechanism is owner-specific or symmetric/generic on `_id`.
//   D. DIFFERENT TIER PAIR — viewer (bare, record _id), then expander WITH
//      `_id` = the viewer property's _id. Predict: viewer disappears —
//      tests whether it's an owner/editor special case or applies to any
//      pair, confirming the causal variable is `_id`-carrying, not tier
//      choice.
//
// Read-only against crede throughout — this script only touches polyphony.
// No repair of anything on crede is attempted or proposed here.

import { entuFetch } from '$lib/entu/request';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

interface LedgerEntry {
	step: string;
	outcome: string;
	[key: string]: unknown;
}

async function createTester(db: string, token: string, personTypeId: string, dbEntityId: string): Promise<string> {
	const res = await entuFetch(db, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([
			{ type: '_type', reference: personTypeId },
			{ type: '_parent', reference: dbEntityId }
		])
	});
	if (!res.ok) throw new Error(`tester create failed: HTTP ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	if (!body._id) throw new Error('tester create returned no _id');
	return body._id;
}

async function grantBare(db: string, token: string, dbEntityId: string, type: string, reference: string): Promise<string> {
	const res = await entuFetch(db, `entity/${dbEntityId}`, token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([{ type, reference }])
	});
	if (!res.ok) throw new Error(`bare grant ${type} failed: HTTP ${res.status}`);
	const body = (await res.json()) as { properties?: Array<{ type?: string; _id?: string }> };
	const propId = (body.properties ?? []).find((p) => p.type === type)?._id;
	if (!propId) throw new Error(`bare grant ${type} returned no matching property _id`);
	return propId;
}

async function upsertWithOldId(db: string, token: string, dbEntityId: string, oldId: string, newType: string, reference: string): Promise<string> {
	const res = await entuFetch(db, `entity/${dbEntityId}`, token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([{ _id: oldId, type: newType, reference }])
	});
	if (!res.ok) throw new Error(`upsert-with-old-id ${newType} failed: HTTP ${res.status}`);
	const body = (await res.json()) as { properties?: Array<{ type?: string; _id?: string }> };
	const propId = (body.properties ?? []).find((p) => p.type === newType)?._id;
	if (!propId) throw new Error(`upsert-with-old-id ${newType} returned no matching property _id`);
	return propId;
}

async function propertyStatus(db: string, token: string, propId: string): Promise<number> {
	const res = await fetch(`https://api.entu.app/${db}/property/${propId}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	return res.status;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerEntry[] = [];
	const cleanupProps: string[] = [];
	const cleanupTesters: string[] = [];
	const orphans: string[] = [];

	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable');
	const personTypeRes = await entuFetch(cfg.db, 'entity?_type.string=entity&name.string=person&props=_id&limit=1', cfg.token);
	const personTypeBody = (await personTypeRes.json()) as { entities?: Array<{ _id?: string }> };
	const personTypeId = personTypeBody.entities?.[0]?._id;
	if (!personTypeId) throw new Error('could not resolve person type-def id');
	console.log(`db entity: ${dbEntityId}, person type-def: ${personTypeId}`);

	if (DRY_RUN) {
		console.log('\n=== DRY RUN — would-do, nothing executed ===');
		console.log('A. bare editor, then bare owner — predict BOTH survive.');
		console.log('B. bare editor, then owner carrying editor\'s _id (entu.app upsert shape) — predict editor soft-deleted.');
		console.log('C. bare owner, then editor carrying owner\'s _id — predict owner soft-deleted (symmetry check).');
		console.log('D. bare viewer, then expander carrying viewer\'s _id — predict viewer soft-deleted (tier-pair-agnostic check).');
		ledger.push({ step: 'dry-run', outcome: 'dry-run-would-run' });
	} else {
		// ─── A. bare append control ─────────────────────────────────────────
		console.log('\n=== A. bare append control (editor, then owner, no _id on either) ===');
		const testerA = await createTester(cfg.db, cfg.token, personTypeId, dbEntityId);
		cleanupTesters.push(testerA);
		const editorA = await grantBare(cfg.db, cfg.token, dbEntityId, '_editor', testerA);
		const ownerA = await grantBare(cfg.db, cfg.token, dbEntityId, '_owner', testerA);
		const statusA = await propertyStatus(cfg.db, cfg.token, editorA);
		console.log(`  editor property after bare owner grant: HTTP ${statusA} (predict 200 — survives)`);
		ledger.push({ step: 'scenario-A-bare-append', outcome: statusA === 200 ? 'survived-as-predicted' : 'unexpected', editorPropId: editorA, ownerPropId: ownerA, statusAfterOwnerGrant: statusA });
		cleanupProps.push(editorA, ownerA);

		// ─── B. reproduction — owner carries editor's _id ────────────────────
		console.log("\n=== B. reproduction (bare editor, then owner carrying editor's _id) ===");
		const testerB = await createTester(cfg.db, cfg.token, personTypeId, dbEntityId);
		cleanupTesters.push(testerB);
		const editorB = await grantBare(cfg.db, cfg.token, dbEntityId, '_editor', testerB);
		const ownerB = await upsertWithOldId(cfg.db, cfg.token, dbEntityId, editorB, '_owner', testerB);
		const statusB = await propertyStatus(cfg.db, cfg.token, editorB);
		console.log(`  editor property after owner-upsert-with-editor's-_id: HTTP ${statusB} (predict 404 — reproduces crede)`);
		ledger.push({ step: 'scenario-B-reproduction', outcome: statusB === 404 ? 'reproduced-as-predicted' : 'did-not-reproduce', editorPropId: editorB, ownerPropId: ownerB, statusAfterUpsert: statusB });
		cleanupProps.push(ownerB); // editorB is already gone if reproduced; delete attempt below handles either case

		// ─── C. order flip — editor carries owner's _id ──────────────────────
		console.log("\n=== C. order flip (bare owner, then editor carrying owner's _id) ===");
		const testerC = await createTester(cfg.db, cfg.token, personTypeId, dbEntityId);
		cleanupTesters.push(testerC);
		const ownerC = await grantBare(cfg.db, cfg.token, dbEntityId, '_owner', testerC);
		const editorC = await upsertWithOldId(cfg.db, cfg.token, dbEntityId, ownerC, '_editor', testerC);
		const statusC = await propertyStatus(cfg.db, cfg.token, ownerC);
		console.log(`  owner property after editor-upsert-with-owner's-_id: HTTP ${statusC} (predict 404 — symmetric)`);
		ledger.push({ step: 'scenario-C-order-flip', outcome: statusC === 404 ? 'symmetric-as-predicted' : 'not-symmetric', ownerPropId: ownerC, editorPropId: editorC, statusAfterUpsert: statusC });
		cleanupProps.push(editorC);

		// ─── D. different tier pair — expander carries viewer's _id ──────────
		console.log("\n=== D. different tier pair (bare viewer, then expander carrying viewer's _id) ===");
		const testerD = await createTester(cfg.db, cfg.token, personTypeId, dbEntityId);
		cleanupTesters.push(testerD);
		const viewerD = await grantBare(cfg.db, cfg.token, dbEntityId, '_viewer', testerD);
		const expanderD = await upsertWithOldId(cfg.db, cfg.token, dbEntityId, viewerD, '_expander', testerD);
		const statusD = await propertyStatus(cfg.db, cfg.token, viewerD);
		console.log(`  viewer property after expander-upsert-with-viewer's-_id: HTTP ${statusD} (predict 404 — tier-pair-agnostic)`);
		ledger.push({ step: 'scenario-D-different-tier-pair', outcome: statusD === 404 ? 'tier-agnostic-as-predicted' : 'not-tier-agnostic', viewerPropId: viewerD, expanderPropId: expanderD, statusAfterUpsert: statusD });
		cleanupProps.push(expanderD);

		// ─── CLEANUP ─────────────────────────────────────────────────────────
		console.log('\n=== CLEANUP ===');
		for (const propId of cleanupProps) {
			const delRes = await entuFetch(cfg.db, `property/${propId}`, cfg.token, { method: 'DELETE' });
			const alreadyGone = delRes.status === 404;
			console.log(`  DELETE property ${propId}: ${delRes.ok || alreadyGone ? 'OK' : 'FAILED'} (${delRes.status})`);
			ledger.push({ step: 'cleanup-delete-property', outcome: delRes.ok || alreadyGone ? 'deleted-or-already-gone' : 'delete-failed', propId, status: delRes.status });
			if (!delRes.ok && !alreadyGone) orphans.push(`property ${propId} (status ${delRes.status})`);
		}
		for (const testerId of cleanupTesters) {
			const delRes = await entuFetch(cfg.db, `entity/${testerId}`, cfg.token, { method: 'DELETE' });
			console.log(`  DELETE tester ${testerId}: ${delRes.ok ? 'OK' : 'FAILED'} (${delRes.status})`);
			ledger.push({ step: 'cleanup-delete-tester', outcome: delRes.ok ? 'deleted' : 'delete-failed', testerId, status: delRes.status });
			if (!delRes.ok) orphans.push(`tester ${testerId} (status ${delRes.status})`);
		}
		console.log(`\n${orphans.length === 0 ? '>> Full teardown, nothing orphaned.' : `>> ORPHANED, on the record: ${orphans.join('; ')}`}`);
		ledger.push({ step: 'orphan-summary', outcome: orphans.length === 0 ? 'clean' : 'orphans-present', orphans });
	}

	const failures = ledger.filter((e) => e.outcome === 'did-not-reproduce' || e.outcome === 'not-symmetric' || e.outcome === 'not-tier-agnostic' || e.outcome === 'unexpected' || e.outcome === 'orphans-present');
	console.log(`\n${ledger.length} ledger steps, ${failures.length} flagged`);

	const artifactPath = writeLedger({
		scriptName: 'probe-crede-editor-disappear-repro',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: "Reproduction (team-lead authorized 2026-09-09) of crede's Joosep-editor-disappearance: does an upsert-by-old-_id (entu.app's own Rights-drawer 'change tier' shape) delete the old property, vs a bare append which should not. Polyphony only, synthetic.",
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('probe-crede-editor-disappear-repro ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
