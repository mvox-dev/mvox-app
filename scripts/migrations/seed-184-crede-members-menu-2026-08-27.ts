// #184 — create the "Members"/"Liikmed" menu entry in mvox_crede. Authorized
// by team-lead 2026-08-27. Shape matched to the existing "Persons" menu
// entity (closest analog, same group) rather than the dispatch's literal
// single-string values — menu name/group are multilingual (en+et pairs) in
// every existing entry, and "Persons" carries no `ordinal`.
//
// mvox-app#274 — migrated onto the shared script-runner + ledger-writer.
// This script previously had NO DRY_RUN guard at all: every invocation ran
// live unconditionally, one copy-paste away from an accidental mutation.
// Now dry-run by default, same as every other crede script.
//
// Run:
//   ./scripts/migrations/seed-184-crede-members-menu-2026-08-27.ts        # DRY_RUN=true default
//   DRY_RUN=false ... same-file                                           # live, AFTER authorization

import { entuFetch } from '$lib/entu/request';
import { readDryRun, loadCredeCfg, runScript, errMsg } from './lib/script-runner';
import { writeLedger } from './lib/ledger-writer';

const DRY_RUN = readDryRun();
const DB_ENTITY_ID = process.env.MVOX_CREDE_DB_ENTITY_ID ?? '6a8f471a5eb2498f434e5112';
const MENU_TYPE_ID = '6a8f471a5eb2498f434e50d4';

type LedgerEntry = { name: string; status: 'created' | 'would-create' | 'failed'; id?: string; message?: string };

async function main(): Promise<boolean> {
	const cfg = await loadCredeCfg();
	const ledger: LedgerEntry[] = [];

	if (DRY_RUN) {
		ledger.push({ name: 'Members', status: 'would-create' });
	} else {
		try {
			const props = [
				{ type: '_type', reference: MENU_TYPE_ID },
				{ type: '_parent', reference: DB_ENTITY_ID },
				{ type: '_inheritrights', boolean: true },
				{ type: '_sharing', string: 'domain' },
				{ type: 'name', language: 'en', string: 'Members' },
				{ type: 'name', language: 'et', string: 'Liikmed' },
				{ type: 'group', language: 'en', string: 'Organisations' },
				{ type: 'group', language: 'et', string: 'Asutus' },
				{ type: 'query', string: '_type.string=member&sort=name.string' }
			];

			const res = await entuFetch(cfg.db, 'entity', cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(props)
			});
			if (!res.ok) throw new Error(`create failed: ${res.status}`);
			const body = (await res.json()) as { _id?: string };
			if (!body._id) throw new Error('create returned 2xx without _id (apparent-success trap)');

			const verifyRes = await entuFetch(cfg.db, `entity/${body._id}?props=name,group,query,_sharing,_inheritrights,_parent`, cfg.token);
			console.log('verify:', JSON.stringify(await verifyRes.json(), null, 2));

			ledger.push({ name: 'Members', status: 'created', id: body._id });
		} catch (err) {
			ledger.push({ name: 'Members', status: 'failed', message: errMsg(err) });
		}
	}

	const failures = ledger.filter((e) => e.status === 'failed');
	console.log(`\n── #184 Crede members menu — summary ──`);
	console.log(`DRY_RUN=${DRY_RUN}`);
	for (const e of ledger) console.log(`  ${e.status} ${e.name}${e.id ? ` (${e.id})` : ''}${e.message ? ` — ${e.message}` : ''}`);

	const filePath = writeLedger({
		scriptName: 'seed-184-crede-members-menu',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: true,
		payload: { ledger }
	});
	console.log(`\nLedger artifact: ${filePath}`);

	return failures.length === 0;
}

runScript('#184 Crede members menu', main);

// (*MVOX:Perotin*)
