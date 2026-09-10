// mvox-app#304 SPIKE, second half — the APPEND branch of the series picker.
//
// probe-304-parent-rights-gate settled the two branches that act on an EXISTING
// series `_parent` value (atomic-overwrite = reassign, DELETE = unassign). The
// third branch is #304's "standalone event gets a series": a PLAIN append POST
// `[{ type: '_parent', reference: <series> }]` with no `_id` — the wire shape
// `eventConvert.ts`'s step-3 link-event already uses.
//
// Question: does the same rights-on-the-REFERENCED-entity check that refused
// the overwrite (HTTP 400, "User not in parent _owner, _editor nor _expander
// property") also apply to a bare append, and does `_expander` on the series
// clear it? Two runs against one fixture, editor-only then editor+expander.
//
// Polyphony only; every fixture entity is `_probe_304b_*` and deleted at the end.
//
// Run:
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-304-parent-append-gate-2026-09-10.ts
//
// (*MVOX:Perotin* — #304 spike)

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';

const DRY_RUN = readDryRun();
type WireValue = { type: string } & Record<string, unknown>;

async function post(db: string, token: string, path: string, body: WireValue[]) {
	const res = await entuFetch(db, path, token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	let parsed: unknown = null;
	try {
		parsed = await res.json();
	} catch {
		parsed = '(no json)';
	}
	return { status: res.status, ok: res.ok, body: parsed };
}

async function create(db: string, token: string, props: WireValue[], label: string): Promise<string> {
	const r = await post(db, token, 'entity', props);
	if (!r.ok) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
	const id = (r.body as { _id?: string })._id;
	if (!id) throw new Error(`${label}: 2xx with no _id`);
	console.log(`  ${label}: ${id}`);
	return id;
}

async function main() {
	const cfg = await loadCfg();
	console.log(`db=${cfg.db} DRY_RUN=${DRY_RUN}`);
	if (cfg.db !== 'polyphony') throw new Error(`refusing outside polyphony (db=${cfg.db})`);

	const [seasonTypeId, seriesTypeId, eventTypeId, personTypeId, dbRaw] = await Promise.all([
		resolveTypeId(cfg, 'season'),
		resolveTypeId(cfg, 'event_series'),
		resolveTypeId(cfg, 'event'),
		resolveTypeId(cfg, 'person'),
		resolveDatabaseEntityId(cfg)
	]);
	if (!dbRaw) throw new Error('no database entity');
	if (DRY_RUN) {
		console.log('DRY RUN — would create _probe_304b_{season,series,event,tester}, grant _editor on the event only,');
		console.log('append-POST a series _parent as editor (expect refusal), grant _expander on the series, retry, then clean up.');
		return;
	}

	console.log('\n=== FIXTURE ===');
	const seasonId = await create(cfg.db, cfg.token, [
		{ type: '_type', reference: seasonTypeId },
		{ type: '_parent', reference: dbRaw },
		{ type: 'name', string: '_probe_304b_season' }
	], '_probe_304b_season');
	const seriesId = await create(cfg.db, cfg.token, [
		{ type: '_type', reference: seriesTypeId },
		{ type: '_parent', reference: seasonId },
		{ type: 'name', string: '_probe_304b_series' }
	], '_probe_304b_series');
	// STANDALONE event: season parent only, NO series parent.
	const eventId = await create(cfg.db, cfg.token, [
		{ type: '_type', reference: eventTypeId },
		{ type: '_parent', reference: seasonId },
		{ type: 'name', string: '_probe_304b_event' }
	], '_probe_304b_event');
	const testerId = await create(cfg.db, cfg.token, [
		{ type: '_type', reference: personTypeId },
		{ type: '_parent', reference: dbRaw },
		{ type: 'name', string: '_probe_304b_tester' }
	], '_probe_304b_tester');

	const keyRes = await post(cfg.db, cfg.token, `entity/${testerId}`, [{ type: 'entu_api_key', string: '' }]);
	const rawKey = ((keyRes.body as { properties?: Array<{ type?: string; string?: string }> }).properties ?? []).find((p) => p.type === 'entu_api_key')?.string;
	if (!rawKey) throw new Error('no api key');
	const grant = await post(cfg.db, cfg.token, `entity/${eventId}`, [{ type: '_editor', reference: testerId }]);
	const grantId = ((grant.body as { properties?: Array<{ type?: string; _id?: string }> }).properties ?? []).find((p) => p.type === '_editor')?._id;
	console.log(`  DIRECT _editor on the event: ${grantId}`);
	const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, { headers: { Authorization: `Bearer ${rawKey}`, Accept: 'application/json' } });
	const testerToken = ((await authRes.json()) as { token?: string }).token;
	if (!testerToken) throw new Error('no tester token');

	console.log('\n=== C1 — editor-only APPEND of a series _parent (no _id) ===');
	const c1 = await post(cfg.db, testerToken, `entity/${eventId}`, [{ type: '_parent', reference: seriesId }]);
	console.log(`  HTTP ${c1.status} — ${JSON.stringify(c1.body)}`);

	console.log('\n=== C2 — same append, after granting _expander on the SERIES ===');
	const eg = await post(cfg.db, cfg.token, `entity/${seriesId}`, [{ type: '_expander', reference: testerId }]);
	const egId = ((eg.body as { properties?: Array<{ type?: string; _id?: string }> }).properties ?? []).find((p) => p.type === '_expander')?._id;
	const c2 = await post(cfg.db, testerToken, `entity/${eventId}`, [{ type: '_parent', reference: seriesId }]);
	console.log(`  HTTP ${c2.status} — ${JSON.stringify(c2.body)}`);

	const back = await entuFetch(cfg.db, `entity/${eventId}?props=_parent`, cfg.token);
	const backBody = (await back.json()) as { entity?: { _parent?: Array<Record<string, unknown>> } };
	console.log(`  owner readback _parent: ${JSON.stringify(backBody.entity?._parent ?? [])}`);

	console.log('\n=== VERDICT ===');
	console.log(`  editor-only append          : ${c1.ok ? 'ALLOWED' : `REFUSED (${c1.status})`}`);
	console.log(`  editor + expander-on-series : ${c2.ok ? 'ALLOWED' : `REFUSED (${c2.status})`}`);

	console.log('\n=== CLEANUP ===');
	for (const p of [grantId ? `property/${grantId}` : '', egId ? `property/${egId}` : '', `entity/${testerId}`, `entity/${eventId}`, `entity/${seriesId}`, `entity/${seasonId}`]) {
		if (!p) continue;
		const r = await entuFetch(cfg.db, p, cfg.token, { method: 'DELETE' });
		console.log(`  delete ${p}: ${r.ok ? 'OK' : 'FAILED'} (${r.status})`);
	}
}

main().catch((e) => {
	console.error('PROBE FAILED:', e);
	process.exit(1);
});
