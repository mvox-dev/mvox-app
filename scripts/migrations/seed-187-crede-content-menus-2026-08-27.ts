// #187 — create 13 content-type menu entries in mvox_crede, mirroring
// polyphony's shape exactly (name/group are single EN-only values for this
// class of menu, unlike the bilingual "Members"/#184 entry). Data taken
// directly from the #186 audit (polyphony's live query/ordinal values).
// group="Crede" mirrors polyphony's own self-referential "Polyphony" group
// literal, applied to this collective — flagged as a judgment call in the
// report, not blocking since it's a one-line value, trivially correctable.
// Authorized by team-lead 2026-08-27.
//
// mvox-app#274 — migrated onto the shared script-runner + ledger-writer.
// This script previously had NO DRY_RUN guard at all: every invocation ran
// live unconditionally, one copy-paste away from an accidental mutation.
// Now dry-run by default, same as every other crede script.
//
// Run:
//   ./scripts/migrations/seed-187-crede-content-menus-2026-08-27.ts        # DRY_RUN=true default
//   DRY_RUN=false ... same-file                                           # live, AFTER authorization

import { entuFetch } from '$lib/entu/request';
import { readDryRun, loadCredeCfg, runScript, errMsg } from './lib/script-runner';
import { writeLedger } from './lib/ledger-writer';

const DRY_RUN = readDryRun();
const DB_ENTITY_ID = process.env.MVOX_CREDE_DB_ENTITY_ID ?? '6a8f471a5eb2498f434e5112';
const MENU_TYPE_ID = '6a8f471a5eb2498f434e50d4';
const GROUP = 'Crede';

const MENUS: Array<{ name: string; query: string; ordinal: number }> = [
	{ name: 'Sections', query: '_type.string=section&sort=name.string', ordinal: 130 },
	{ name: 'Libraries', query: '_type.string=library&sort=name.string', ordinal: 240 },
	{ name: 'Works', query: '_type.string=work&sort=name.string', ordinal: 200 },
	{ name: 'Editions', query: '_type.string=edition&sort=name.string', ordinal: 210 },
	{ name: 'Copies', query: '_type.string=copy&sort=name.string', ordinal: 220 },
	{ name: 'Loans', query: '_type.string=lending&sort=name.string', ordinal: 230 },
	{ name: 'Seasons', query: '_type.string=season&sort=start_date.date', ordinal: 410 },
	{ name: 'Event Series', query: '_type.string=event_series&sort=name.string', ordinal: 440 },
	{ name: 'Events', query: '_type.string=event&sort=start_date.date', ordinal: 400 },
	{ name: 'Repertoire', query: '_type.string=repertoire_item&sort=name.string', ordinal: 420 },
	{ name: 'Programme', query: '_type.string=program_item&sort=name.string', ordinal: 430 },
	{ name: 'RSVPs', query: '_type.string=rsvp&sort=name.string', ordinal: 510 },
	{ name: 'Attendance', query: '_type.string=attendance&sort=name.string', ordinal: 500 }
];

type LedgerEntry = { name: string; status: 'created' | 'would-create' | 'failed'; id?: string; message?: string };

async function createMenu(db: string, token: string, menu: (typeof MENUS)[number], ledger: LedgerEntry[]): Promise<void> {
	if (DRY_RUN) {
		ledger.push({ name: menu.name, status: 'would-create' });
		return;
	}
	try {
		const res = await entuFetch(db, 'entity', token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: '_type', reference: MENU_TYPE_ID },
				{ type: '_parent', reference: DB_ENTITY_ID },
				{ type: '_inheritrights', boolean: true },
				{ type: '_sharing', string: 'domain' },
				{ type: 'name', string: menu.name },
				{ type: 'group', string: GROUP },
				{ type: 'query', string: menu.query },
				{ type: 'ordinal', number: menu.ordinal }
			])
		});
		if (!res.ok) throw new Error(`create failed: ${res.status}`);
		const body = (await res.json()) as { _id?: string };
		if (!body._id) throw new Error('create returned 2xx without _id (apparent-success trap)');

		const verifyRes = await entuFetch(db, `entity/${body._id}?props=name,query,ordinal`, token);
		const verifyBody = await verifyRes.json();
		const actualQuery = verifyBody.entity?.query?.[0]?.string;
		if (actualQuery !== menu.query) throw new Error(`verify mismatch: expected query ${JSON.stringify(menu.query)}, got ${JSON.stringify(actualQuery)}`);

		ledger.push({ name: menu.name, status: 'created', id: body._id });
	} catch (err) {
		ledger.push({ name: menu.name, status: 'failed', message: errMsg(err) });
	}
}

async function main(): Promise<boolean> {
	const cfg = await loadCredeCfg();
	const ledger: LedgerEntry[] = [];
	for (const menu of MENUS) await createMenu(cfg.db, cfg.token, menu, ledger);

	const failures = ledger.filter((e) => e.status === 'failed');
	console.log(`\n── #187 Crede content menus — summary ──`);
	console.log(`DRY_RUN=${DRY_RUN}`);
	console.log(`Total: ${ledger.length}  failed: ${failures.length}`);
	for (const e of ledger) console.log(`  ${e.status} ${e.name}${e.id ? ` (${e.id})` : ''}${e.message ? ` — ${e.message}` : ''}`);

	const filePath = writeLedger({
		scriptName: 'seed-187-crede-content-menus',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: true,
		payload: { ledger }
	});
	console.log(`\nLedger artifact: ${filePath}`);

	return failures.length === 0;
}

runScript('#187 Crede content menus', main);

// (*MVOX:Perotin*)
