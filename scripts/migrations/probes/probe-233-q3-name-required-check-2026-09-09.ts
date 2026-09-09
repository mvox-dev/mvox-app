// mvox-app#233 — Q3 live corroboration, polyphony (synthetic, pre-authorized
// routine op). Source read (entu-api utils/entity.js:30-40, the ONLY
// server-side "required" check in setEntity — `_type` alone) already
// answers Q3: v4E does not enforce a prop-def's `mandatory` flag at create
// time. This is a one-shot, cheap, reversible live corroboration of that
// read before it gates a schema mutation — matches the same discipline as
// the original #233 halt finding (docs/source read, THEN live-confirmed).
//
// Creates a bare `event` (no `name` sent at all) directly against Entu,
// bypassing mvox's own client-side validation (createEvent() requires
// `name` for standalone events — that is app policy, not what this probe
// tests). Confirms create succeeds server-side, then deletes it. No schema
// touched, no other entity touched.

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable');
	const eventTypeId = await resolveTypeId(cfg, 'event');
	console.log(`db entity: ${dbEntityId}, event type-def: ${eventTypeId}`);

	const ledger: Array<{ step: string; outcome: string; [k: string]: unknown }> = [];

	if (DRY_RUN) {
		console.log('\nWould POST a bare event ([_type, _parent, start_datetime] — NO name) and expect success, then DELETE it.');
		ledger.push({ step: 'dry-run', outcome: 'dry-run-would-run' });
	} else {
		const createRes = await entuFetch(cfg.db, 'entity', cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: '_type', reference: eventTypeId },
				{ type: '_parent', reference: dbEntityId },
				{ type: 'start_datetime', datetime: new Date().toISOString() }
				// deliberately NO `name` property at all
			])
		});
		const createBody = (await createRes.json().catch(() => null)) as { _id?: string } | null;
		console.log(`create (no name sent): HTTP ${createRes.status} — ${JSON.stringify(createBody)}`);
		ledger.push({ step: 'create-no-name', outcome: String(createRes.status), status: createRes.status, body: createBody });

		if (createRes.ok && createBody?._id) {
			console.log('>> Q3 CONFIRMED LIVE: create with no `name` succeeded — v4E does not enforce `mandatory` server-side.');
			const delRes = await entuFetch(cfg.db, `entity/${createBody._id}`, cfg.token, { method: 'DELETE' });
			console.log(`cleanup DELETE ${createBody._id}: ${delRes.ok ? 'OK' : 'FAILED'} (${delRes.status})`);
			ledger.push({ step: 'cleanup-delete', outcome: delRes.ok ? 'deleted' : 'delete-failed', status: delRes.status, id: createBody._id });

			const verifyRes = await entuFetch(cfg.db, `entity/${createBody._id}`, cfg.token, {});
			console.log(`independent re-verify GET: HTTP ${verifyRes.status} (expect 404)`);
			ledger.push({ step: 'verify-gone', outcome: String(verifyRes.status), expected: 404 });
		} else {
			console.log('>> Q3 REFUTED LIVE: create with no `name` was REJECTED — halt condition triggers, do not proceed with the schema mutation.');
		}
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-233-q3-name-required-check',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#233 Q3 — does v4E reject an event create with no `name` sent, once `name` is slated to become formula-owned? Source read (entity.js:30-40) says no; this corroborates live on polyphony.',
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-233-q3-name-required-check ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
