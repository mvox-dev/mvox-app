// Settles a conflict Nunes found: §7.2 of entu-rights-and-visibility-model.md
// says entity CREATE auto-grants the creating caller all four rights DIRECT;
// the supersession finding (§7.3) says at most one direct tier per
// (reference, entity) can exist. The #294 ledger recorded classifications
// (`callerGrants`), not raw property documents, so it can't settle whether
// this is ONE `_owner` doc that aggregates into all four tiers, or FOUR
// separate direct docs (which would be an exception to §7.3's rule).
// Team-lead authorized, polyphony, synthetic, teardown as usual.
//
// Method: create a bare entity (no rights sent in the payload at all), then
// read its rights via `entity/{id}?props=_owner,_editor,_viewer,_expander`
// — each row in EVERY array carries its own `_id` and `property_type` (the
// RAW type of that specific property document, independent of which
// aggregated array it's folded into — same field used throughout #294/#295).
// Collect every row across all four arrays where `reference` is the
// creating caller's own id AND `inherited` is not `true` (direct only —
// inherited rows aren't from this create), dedupe by `_id` (the SAME
// document can legitimately appear in multiple arrays via folding), and
// report: how many DISTINCT property documents, and what `property_type`
// each one actually is.
//
// EXTENSION (Gama, routed via team-lead, same fixture, 2026-09-09): after
// the count, write ONE explicit direct grant (`_editor`) for the SAME
// caller on the SAME entity and read back again. This settles a DIFFERENT
// question than the count did: does the create-seeded `_owner` document
// survive an explicit grant (create-time seeding is exempt from §7.3's
// supersession rule), or does it collapse to the new one like any other
// direct grant would (no create-time exception — one doc per reference per
// entity, full stop, regardless of how the first one got there)? Joosep's
// cross-tier retirement (§7.3) already rules out "one per tier" as the
// model — this settles whether create's seed is special-cased.

import { entuFetch } from '$lib/entu/request';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

interface RightsRow {
	_id: string;
	reference?: string;
	property_type?: string;
	inherited?: boolean;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: Array<{ step: string; outcome: string; [k: string]: unknown }> = [];

	const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, {
		headers: { Authorization: `Bearer ${process.env.ENTU_API_KEY}`, Accept: 'application/json' }
	});
	const authBody = (await authRes.json()) as { accounts?: Array<{ user?: { _id?: string } }> };
	const callerId = authBody.accounts?.[0]?.user?._id;
	if (!callerId) throw new Error('could not resolve creating caller identity');
	console.log(`creating caller: ${callerId}`);

	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable');
	const personTypeRes = await entuFetch(cfg.db, 'entity?_type.string=entity&name.string=person&props=_id&limit=1', cfg.token);
	const personTypeBody = (await personTypeRes.json()) as { entities?: Array<{ _id?: string }> };
	const personTypeId = personTypeBody.entities?.[0]?._id;
	if (!personTypeId) throw new Error('could not resolve person type-def id');

	if (DRY_RUN) {
		console.log('\nWould create a bare person (no rights sent) and count the creating caller\'s DIRECT rights property documents by distinct _id, reporting each one\'s raw property_type.');
		ledger.push({ step: 'dry-run', outcome: 'dry-run-would-run' });
	} else {
		const createRes = await entuFetch(cfg.db, 'entity', cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_type', reference: personTypeId }, { type: '_parent', reference: dbEntityId }])
		});
		const createBody = (await createRes.json()) as { _id?: string };
		const newId = createBody._id;
		if (!newId) throw new Error('create failed');
		console.log(`created entity (no rights sent in payload): ${newId}`);
		ledger.push({ step: 'create-bare-entity', outcome: 'created', newId });

		const rightsRes = await entuFetch(cfg.db, `entity/${newId}?props=_owner,_editor,_viewer,_expander`, cfg.token);
		const rightsBody = (await rightsRes.json()) as { entity?: Record<string, RightsRow[] | undefined> };
		console.log(`full rights read: ${JSON.stringify(rightsBody)}`);
		ledger.push({ step: 'read-rights-raw', outcome: 'observed', responseBody: rightsBody });

		const entity = rightsBody.entity ?? {};
		const directCallerDocs = new Map<string, string>(); // _id -> property_type
		for (const tier of ['_owner', '_editor', '_viewer', '_expander']) {
			for (const row of entity[tier] ?? []) {
				if (row.reference === callerId && row.inherited !== true) {
					directCallerDocs.set(row._id, row.property_type ?? tier);
				}
			}
		}

		const distinctDocs = [...directCallerDocs.entries()].map(([id, type]) => ({ id, type }));
		console.log(`\nDISTINCT direct rights property documents for the creating caller: ${distinctDocs.length}`);
		console.log(JSON.stringify(distinctDocs, null, 2));
		ledger.push({ step: 'verdict', outcome: distinctDocs.length === 1 ? 'one-document-folds-into-four' : `${distinctDocs.length}-documents`, distinctDocs });

		// ─── EXTENSION — explicit grant on top of the create-seeded doc ──────
		const seedDocId = distinctDocs[0]?.id;
		console.log(`\n=== EXTENSION — explicit _editor grant for the same caller on the same entity (seed doc: ${seedDocId ?? 'none'}) ===`);
		const grantRes = await entuFetch(cfg.db, `entity/${newId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: '_editor', reference: callerId }])
		});
		const grantBody = (await grantRes.json()) as { properties?: Array<{ type?: string; _id?: string }> };
		const newGrantId = (grantBody.properties ?? []).find((p) => p.type === '_editor')?._id;
		console.log(`explicit _editor grant response: ${JSON.stringify(grantBody)}`);
		ledger.push({ step: 'extension-explicit-editor-grant', outcome: 'observed', responseBody: grantBody, newGrantId });

		const rightsRes2 = await entuFetch(cfg.db, `entity/${newId}?props=_owner,_editor,_viewer,_expander`, cfg.token);
		const rightsBody2 = (await rightsRes2.json()) as { entity?: Record<string, RightsRow[] | undefined> };
		console.log(`full rights read AFTER explicit grant: ${JSON.stringify(rightsBody2)}`);
		ledger.push({ step: 'extension-read-rights-after-grant', outcome: 'observed', responseBody: rightsBody2 });

		const entity2 = rightsBody2.entity ?? {};
		const directCallerDocs2 = new Map<string, string>();
		for (const tier of ['_owner', '_editor', '_viewer', '_expander']) {
			for (const row of entity2[tier] ?? []) {
				if (row.reference === callerId && row.inherited !== true) {
					directCallerDocs2.set(row._id, row.property_type ?? tier);
				}
			}
		}
		const distinctDocs2 = [...directCallerDocs2.entries()].map(([id, type]) => ({ id, type }));
		console.log(`\nDISTINCT direct rights property documents AFTER explicit grant: ${distinctDocs2.length}`);
		console.log(JSON.stringify(distinctDocs2, null, 2));

		const seedSurvived = seedDocId ? distinctDocs2.some((d) => d.id === seedDocId) : false;
		const onlyNewDocRemains = distinctDocs2.length === 1 && distinctDocs2[0]?.id === newGrantId;
		console.log(`\n>> create-seeded doc (${seedDocId}) survived the explicit grant: ${seedSurvived}`);
		console.log(`>> exactly the NEW grant doc remains (create-exempt claim REFUTED, one-doc-everywhere CONFIRMED): ${onlyNewDocRemains}`);
		ledger.push({
			step: 'extension-verdict',
			outcome: seedSurvived ? 'create-seed-is-exempt-from-supersession' : onlyNewDocRemains ? 'create-seed-collapses-like-any-other-direct-grant' : 'inconclusive',
			seedDocId,
			newGrantId,
			distinctDocsAfter: distinctDocs2
		});

		// cleanup — union of every doc id seen across both reads, dedup, delete once each
		const allDocIdsToClean = new Set([...distinctDocs.map((d) => d.id), ...distinctDocs2.map((d) => d.id)]);
		for (const id of allDocIdsToClean) {
			const del = await entuFetch(cfg.db, `property/${id}`, cfg.token, { method: 'DELETE' });
			const alreadyGone = del.status === 404;
			console.log(`  DELETE property ${id}: ${del.status}`);
			ledger.push({ step: 'cleanup-delete-property', outcome: del.ok || alreadyGone ? 'deleted-or-already-gone' : 'delete-failed', id, status: del.status });
		}
		const delEntity = await entuFetch(cfg.db, `entity/${newId}`, cfg.token, { method: 'DELETE' });
		console.log(`  DELETE entity ${newId}: ${delEntity.status}`);
		ledger.push({ step: 'cleanup-delete-entity', outcome: delEntity.ok ? 'deleted' : 'delete-failed', newId, status: delEntity.status });
		const verify = await entuFetch(cfg.db, `entity/${newId}`, cfg.token, {});
		console.log(`  independent re-verify: HTTP ${verify.status} (expect 404)`);
		ledger.push({ step: 'verify-gone', outcome: String(verify.status), expected: 404 });
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-create-auto-grant-doc-count',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'Settles #294/§7.2-vs-§7.3 conflict Nunes found: does entity CREATE write ONE _owner property doc that aggregates into all four tiers, or FOUR separate direct docs? Team-lead authorized 2026-09-09, polyphony, synthetic.',
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-create-auto-grant-doc-count ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
