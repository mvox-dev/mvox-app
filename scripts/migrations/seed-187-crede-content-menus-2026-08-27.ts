// #187 — create 13 content-type menu entries in mvox_crede, mirroring
// polyphony's shape exactly (name/group are single EN-only values for this
// class of menu, unlike the bilingual "Members"/#184 entry). Data taken
// directly from the #186 audit (polyphony's live query/ordinal values).
// group="Crede" mirrors polyphony's own self-referential "Polyphony" group
// literal, applied to this collective — flagged as a judgment call in the
// report, not blocking since it's a one-line value, trivially correctable.
// Authorized by team-lead 2026-08-27.
import { entuFetch } from '$lib/entu/request';

const DB = process.env.MVOX_CREDE_DB ?? 'mvox_crede';
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

type LedgerEntry = { name: string; status: 'created' | 'failed'; id?: string; message?: string };

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function getToken(): Promise<string> {
	const key = process.env.MVOX_CREDE_API_KEY;
	if (!key) throw new Error('MVOX_CREDE_API_KEY is not set');
	const res = await fetch(`https://api.entu.app/auth?db=${DB}`, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`auth exchange failed: ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error('auth exchange returned no token');
	return body.token;
}

async function createMenu(token: string, menu: (typeof MENUS)[number], ledger: LedgerEntry[]): Promise<void> {
	try {
		const res = await entuFetch(DB, 'entity', token, {
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

		const verifyRes = await entuFetch(DB, `entity/${body._id}?props=name,query,ordinal`, token);
		const verifyBody = await verifyRes.json();
		const actualQuery = verifyBody.entity?.query?.[0]?.string;
		if (actualQuery !== menu.query) throw new Error(`verify mismatch: expected query ${JSON.stringify(menu.query)}, got ${JSON.stringify(actualQuery)}`);

		ledger.push({ name: menu.name, status: 'created', id: body._id });
	} catch (err) {
		ledger.push({ name: menu.name, status: 'failed', message: errMsg(err) });
	}
}

async function main() {
	const token = await getToken();
	const ledger: LedgerEntry[] = [];
	for (const menu of MENUS) await createMenu(token, menu, ledger);

	const created = ledger.filter((e) => e.status === 'created').length;
	const failures = ledger.filter((e) => e.status === 'failed');
	console.log(`\n── #187 Crede content menus — summary ──`);
	console.log(`Total: ${ledger.length}  created: ${created}  failed: ${failures.length}`);
	for (const e of ledger) console.log(`  ${e.status === 'created' ? 'OK' : 'FAIL'} ${e.name}${e.id ? ` (${e.id})` : ''}${e.message ? ` — ${e.message}` : ''}`);

	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#187 ABORTED:', errMsg(err));
	process.exit(1);
});
