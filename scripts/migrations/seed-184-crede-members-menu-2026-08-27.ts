// #184 — create the "Members"/"Liikmed" menu entry in mvox_crede. Authorized
// by team-lead 2026-08-27. Shape matched to the existing "Persons" menu
// entity (closest analog, same group) rather than the dispatch's literal
// single-string values — menu name/group are multilingual (en+et pairs) in
// every existing entry, and "Persons" carries no `ordinal`.
import { entuFetch } from '$lib/entu/request';

const DB = process.env.MVOX_CREDE_DB ?? 'mvox_crede';
const DB_ENTITY_ID = process.env.MVOX_CREDE_DB_ENTITY_ID ?? '6a8f471a5eb2498f434e5112';
const MENU_TYPE_ID = '6a8f471a5eb2498f434e50d4';

async function getToken(): Promise<string> {
	const key = process.env.MVOX_CREDE_API_KEY;
	if (!key) throw new Error('MVOX_CREDE_API_KEY is not set — source ~/.config/mvox/credentials.env first');
	const res = await fetch(`https://api.entu.app/auth?db=${DB}`, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`auth exchange failed: ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error('auth exchange returned no token');
	return body.token;
}

async function main() {
	const token = await getToken();

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

	const res = await entuFetch(DB, 'entity', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(props)
	});
	console.log(`CREATE status: ${res.status}`);
	const body = (await res.json()) as { _id?: string };
	console.log(JSON.stringify(body, null, 2));
	if (!res.ok || !body._id) throw new Error('menu create failed or returned no _id');

	const verifyRes = await entuFetch(DB, `entity/${body._id}?props=name,group,query,_sharing,_inheritrights,_parent`, token);
	console.log('\nverify:', JSON.stringify(await verifyRes.json(), null, 2));
}

main().catch((err) => {
	console.error('#184 menu create ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
