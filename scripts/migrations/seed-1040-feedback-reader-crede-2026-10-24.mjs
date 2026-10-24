// #1040: read-only Entu person and key for the feedback MCP server on mvox_crede; no key in ledger.
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const API = 'https://api.entu.app';
const DB = 'mvox_crede';
const PERSON_TYPE = '6a8f471a5eb2498f434e50f7';
const KEY_PATH = `${homedir()}/workspace/scratchpad/feedback-mcp-crede-key`;
const ledger = [];
const log = (step, outcome, detail = {}) => { ledger.push({ step, outcome, ...detail }); console.log(step, outcome, JSON.stringify(detail)); };
const done = (ok) => {
	const dir = new URL('./seed-results/crede-instance/', import.meta.url).pathname;
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}seed-1040-feedback-reader-crede-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
		JSON.stringify({ sensitive: true, authorizedBy: 'team-lead 2026-10-24 (I authorize this run)', ok, ledger }, null, 2));
	process.exit(ok ? 0 : 1);
};
const stop = (m) => { log('STOP', 'surprise', { m }); done(false); };

async function jwt(key) {
	const r = await fetch(`${API}/auth?db=${DB}`, { headers: { Authorization: `Bearer ${key}` } });
	const b = await r.json();
	return { status: r.status, token: b.token, accounts: (b.accounts ?? []).length };
}
const call = (tok, method, path, body) => fetch(`${API}/${DB}/${path}`, {
	method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
	body: body ? JSON.stringify(body) : undefined });

const root = await jwt(process.env.MVOX_CREDE_API_KEY);
if (!root.token || !root.accounts) stop('root exchange failed');
const R = root.token;

// W1
let r, PID = process.env.RESUME_PERSON_ID;
if (PID) log('W1 create person', 'resumed', { personId: PID, name: 'feedback-mcp (read-only)', note: 'created by the first run, whose W2 got HTTP 400' });
else {
	r = await call(R, 'POST', 'entity', [{ type: '_type', reference: PERSON_TYPE }, { type: 'name', string: 'feedback-mcp (read-only)' }]);
	const w1 = await r.json();
	if (!r.ok || !w1._id) stop(`W1 HTTP ${r.status}`);
	PID = w1._id;
	log('W1 create person', 'ok', { personId: PID, name: 'feedback-mcp (read-only)' });
}

// W2
r = await call(R, 'POST', `entity/${PID}`, [{ type: 'entu_api_key', string: 'generate' }]);
const w2 = await r.json();
const prop = (w2.properties ?? []).find((p) => p.type === 'entu_api_key');
const rawKey = prop?.string ?? prop?.api_key ?? w2.api_key ?? w2.key;
if (!r.ok) stop(`W2 HTTP ${r.status} ${JSON.stringify(w2).replace(/[A-Za-z0-9]{40,}/g, '***')}`);
if (!rawKey) stop(`W2 no raw key in response; keys: ${Object.keys(w2)}`);
writeFileSync(KEY_PATH, rawKey + '\n', { mode: 0o600 });
log('W2 add entu_api_key', 'ok', { keyPath: KEY_PATH, propId: prop?._id });

// probe
const me = await jwt(rawKey);
log('probe exchange', me.accounts ? 'ok' : 'EMPTY', { status: me.status, accounts: me.accounts });
if (!me.token || !me.accounts) stop('new key has no seat; no grants made');
const T = me.token;

// R1
const props = 'name,description,metadata,doodle_layer,screenshot,issue_url,_parent,_created';
r = await call(T, 'GET', `entity?_type.string=feedback&props=${props}&limit=100`);
const l = await r.json();
const ents = l.entities ?? [];
log('R1 list feedback', r.ok && ents.length === 3 ? 'ok' : 'UNEXPECTED', { status: r.status, count: l.count, returned: ents.length,
	withDoodle: ents.filter((e) => e.doodle_layer?.length).length, withScreenshot: ents.filter((e) => e.screenshot?.length).length });
if (!r.ok || ents.length !== 3) stop('R1');
const fb = ents.find((e) => e.screenshot?.length) ?? ents[0];

// R2
r = await call(T, 'GET', `entity/${fb._id}?props=${props},_type`);
const one = (await r.json()).entity;
log('R2 get feedback', r.ok && one?._type?.[0]?.string === 'feedback' ? 'ok' : 'UNEXPECTED', { status: r.status, id: fb._id });
if (!r.ok) stop('R2');

// R3
const shot = fb.screenshot?.[0]?._id;
if (!shot) stop('R3 no screenshot property on sample');
r = await call(T, 'GET', `property/${shot}`);
const s = await r.json();
log('R3 screenshot url', r.ok && typeof s.url === 'string' ? 'ok' : 'UNEXPECTED', { status: r.status, propId: shot });
if (!r.ok || !s.url) stop('R3');

// private entity
r = await call(R, 'GET', 'entity?_sharing.string=private&limit=1&props=_id');
const priv = (await r.json()).entities?.[0]?._id;
if (priv) {
	r = await call(T, 'GET', `entity/${priv}`);
	log('private entity read', r.status === 403 || r.status === 404 ? 'refused' : 'LEAK', { status: r.status, id: priv });
	if (r.status < 400) stop('private entity readable');
} else log('private entity read', 'skipped', { note: 'none found' });

// write refusals
r = await call(T, 'POST', `entity/${fb._id}`, [{ type: 'description', string: '1040 write probe' }]);
log('write: description on feedback', r.status === 403 ? 'refused' : 'NOT-REFUSED', { status: r.status, id: fb._id });
if (r.status < 400) {
	const b = await r.json().catch(() => ({}));
	const pid = (b.properties ?? []).find((p) => p.type === 'description')?._id;
	if (pid) { const d = await call(R, 'DELETE', `property/${pid}`); log('rollback stray description', d.ok ? 'ok' : 'FAILED', { status: d.status, propId: pid }); }
	stop('write accepted');
}
const parent = fb._parent?.[0]?.reference;
const typeId = (await (await call(R, 'GET', 'entity?_type.string=entity&name.string=feedback&props=_id')).json()).entities?.[0]?._id;
r = await call(T, 'POST', 'entity', [{ type: '_type', reference: typeId }, { type: '_parent', reference: parent }, { type: 'name', string: '1040 write probe' }]);
log('write: new feedback', r.status === 403 ? 'refused' : 'NOT-REFUSED', { status: r.status });
if (r.status < 400) {
	const b = await r.json().catch(() => ({}));
	if (b._id) { const d = await call(R, 'DELETE', `entity/${b._id}`); log('rollback stray feedback', d.ok ? 'ok' : 'FAILED', { status: d.status, id: b._id }); }
	stop('create accepted');
}
done(true);
