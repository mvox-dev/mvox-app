// mvox-app#304 SPIKE — THE `_parent` RIGHTS GATE, VERIFIED LIVE ON POLYPHONY.
//
// QUESTION. Team memory (from the #264 stage-1 read of the PUBLIC entu-api
// source) says: a `_parent` POST is EDITOR-gated but a `_parent` value DELETE
// is OWNER-gated. If true, #304's UNASSIGN (a pure DELETE of the event's
// event_series `_parent` value — the `unassignMemberSection` idiom) is
// owner-only, while REASSIGN via the house atomic-overwrite primitive (POST
// carrying the old value's `_id`) stays editor-gated end to end. The live
// deployment runs NEWER code than the public source, so this is settled
// EMPIRICALLY, not by reading source.
//
// SHAPE. Build a throwaway fixture that reproduces #304's exact wire shape —
// an `event` whose `_parent` holds TWO values of different `entity_type`
// (a `season` AND an `event_series`) — then act on it as a caller holding
// EXACTLY `_editor` on the event and nothing else (direct grant, never
// inherited; the tester holds no rights on the season, the series, or the db
// root). Four probes, in this order (the overwrite runs FIRST because a
// successful DELETE would destroy the value the overwrite needs to pair with):
//
//   B  editor ATOMIC-OVERWRITE of the series `_parent` value
//        POST entity/{event} [{ _id: <series parent value id>, type: '_parent',
//        reference: <series B> }]                          → the REASSIGN path
//      B2 (only if B is refused) — re-grant `_expander` on series B and retry,
//        to tell "the POST is owner-gated" apart from "the POST needs rights on
//        the REFERENCED entity too".
//   A  editor DELETE of the series `_parent` value
//        DELETE property/{value id}                        → the UNASSIGN path
//   A2 CONTROL — editor DELETE of a PLAIN property value (`location`) on the
//        same entity. Discriminates "`_parent` DELETE specifically is
//        owner-gated" from "DELETE is owner-gated for everything".
//   A3 CONTROL — owner DELETE of whatever A could not delete. Proves the
//        operation itself is possible and only the RIGHTS differed.
//
// Every fixture entity is named `_probe_304_*` and is DELETED at the end
// (owner identity, cleanup runs even when a probe step reports a refusal —
// refusals are DATA here, not failures).
//
// Polyphony is the synthetic dev/test collective; routine synthetic-data ops on
// it are pre-authorized (CLAUDE.md, Mihkel 2026-08-05). This script asserts
// nothing — whatever the wire answers is the finding.
//
// Run:
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-304-parent-rights-gate-2026-09-10.ts     # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-304-parent-rights-gate-2026-09-10.ts
//
// (*MVOX:Perotin* — #304 spike)

import { entuFetch } from '$lib/entu/request';
import { resolveTypeId } from '$lib/seasons/entuSeasons';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun } from '../lib/script-runner';
import { writeLedger } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();
const ledger: Array<Record<string, unknown>> = [];

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
		parsed = '(no json body)';
	}
	return { status: res.status, ok: res.ok, body: parsed };
}

async function createEntity(
	db: string,
	token: string,
	props: WireValue[],
	label: string
): Promise<string> {
	const r = await post(db, token, 'entity', props);
	if (!r.ok) throw new Error(`${label} create failed: ${r.status} ${JSON.stringify(r.body)}`);
	const id = (r.body as { _id?: string })._id;
	if (!id) throw new Error(`${label} create returned 2xx with no _id`);
	console.log(`  ${label}: ${id}`);
	ledger.push({ step: `create-${label}`, outcome: 'created', id });
	return id;
}

async function readProps(db: string, token: string, entityId: string, props: string) {
	const res = await entuFetch(db, `entity/${entityId}?props=${props}`, token);
	let parsed: unknown = null;
	try {
		parsed = await res.json();
	} catch {
		parsed = '(no json body)';
	}
	return { status: res.status, ok: res.ok, entity: (parsed as { entity?: Record<string, unknown> })?.entity, raw: parsed };
}

async function del(db: string, token: string, path: string) {
	const res = await entuFetch(db, path, token, { method: 'DELETE' });
	let parsed: unknown = null;
	try {
		parsed = await res.json();
	} catch {
		parsed = '(no json body)';
	}
	return { status: res.status, ok: res.ok, body: parsed };
}

type ParentValue = { _id: string; reference?: string; entity_type?: string; string?: string };

function parentsOf(entity: Record<string, unknown> | undefined): ParentValue[] {
	return ((entity?._parent as ParentValue[] | undefined) ?? []).slice();
}

function seriesParentOf(entity: Record<string, unknown> | undefined): ParentValue | undefined {
	return parentsOf(entity).find((p) => p.entity_type === 'event_series');
}

function seasonParentOf(entity: Record<string, unknown> | undefined): ParentValue | undefined {
	return parentsOf(entity).find((p) => p.entity_type === 'season');
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`db=${cfg.db}  DRY_RUN=${DRY_RUN}`);
	if (cfg.db !== 'polyphony') {
		throw new Error(`refusing to run outside polyphony (db=${cfg.db}) — this probe creates and deletes entities`);
	}

	const [seasonTypeId, seriesTypeId, eventTypeId, personTypeId, dbEntityIdRaw] = await Promise.all([
		resolveTypeId(cfg, 'season'),
		resolveTypeId(cfg, 'event_series'),
		resolveTypeId(cfg, 'event'),
		resolveTypeId(cfg, 'person'),
		resolveDatabaseEntityId(cfg)
	]);
	if (!dbEntityIdRaw) throw new Error('resolveDatabaseEntityId returned null — no `database` entity in this db');
	const dbEntityId = dbEntityIdRaw;
	console.log(`types: season=${seasonTypeId} event_series=${seriesTypeId} event=${eventTypeId} person=${personTypeId} dbEntity=${dbEntityId}`);

	if (DRY_RUN) {
		console.log('\nDRY RUN — would create _probe_304_season, _probe_304_series_a, _probe_304_series_b,');
		console.log('_probe_304_event (two _parent values: season + series A, plus a location value),');
		console.log('_probe_304_tester (person + entu_api_key), grant EXACTLY _editor on the event, then run');
		console.log('B (editor atomic-overwrite of the series _parent), A (editor DELETE of the series _parent),');
		console.log('A2 (editor DELETE of a plain location value), A3 (owner DELETE control), then delete everything.');
		return;
	}

	// ── FIXTURE ───────────────────────────────────────────────────────────────
	console.log('\n=== FIXTURE ===');
	const seasonId = await createEntity(
		cfg.db,
		cfg.token,
		[
			{ type: '_type', reference: seasonTypeId },
			{ type: '_parent', reference: dbEntityId },
			{ type: 'name', string: '_probe_304_season' }
		],
		'_probe_304_season'
	);
	const seriesAId = await createEntity(
		cfg.db,
		cfg.token,
		[
			{ type: '_type', reference: seriesTypeId },
			{ type: '_parent', reference: seasonId },
			{ type: 'name', string: '_probe_304_series_a' }
		],
		'_probe_304_series_a'
	);
	const seriesBId = await createEntity(
		cfg.db,
		cfg.token,
		[
			{ type: '_type', reference: seriesTypeId },
			{ type: '_parent', reference: seasonId },
			{ type: 'name', string: '_probe_304_series_b' }
		],
		'_probe_304_series_b'
	);
	const eventId = await createEntity(
		cfg.db,
		cfg.token,
		[
			{ type: '_type', reference: eventTypeId },
			{ type: '_parent', reference: seasonId },
			{ type: '_parent', reference: seriesAId },
			{ type: 'name', string: '_probe_304_event' },
			{ type: 'location', string: '_probe_304_location' }
		],
		'_probe_304_event'
	);

	const ownerRead0 = await readProps(cfg.db, cfg.token, eventId, '_parent,location');
	console.log(`  owner read event._parent: ${JSON.stringify(parentsOf(ownerRead0.entity))}`);
	ledger.push({ step: 'fixture-owner-read', outcome: String(ownerRead0.status), parents: parentsOf(ownerRead0.entity) });
	const seriesParent0 = seriesParentOf(ownerRead0.entity);
	const seasonParent0 = seasonParentOf(ownerRead0.entity);
	if (!seriesParent0 || !seasonParent0) {
		throw new Error(`fixture did not produce the two-typed _parent shape: ${JSON.stringify(parentsOf(ownerRead0.entity))}`);
	}
	const locationValue = ((ownerRead0.entity?.location as Array<{ _id: string }> | undefined) ?? [])[0];
	console.log(`  season parent value ${seasonParent0._id} → ${seasonParent0.reference}`);
	console.log(`  series parent value ${seriesParent0._id} → ${seriesParent0.reference}`);
	console.log(`  location value ${locationValue?._id ?? '(none)'}`);

	// ── TESTER: EDITOR AND NOTHING ELSE ───────────────────────────────────────
	console.log('\n=== TESTER (editor-not-owner) ===');
	const testerId = await createEntity(
		cfg.db,
		cfg.token,
		[
			{ type: '_type', reference: personTypeId },
			{ type: '_parent', reference: dbEntityId },
			{ type: 'name', string: '_probe_304_tester' }
		],
		'_probe_304_tester'
	);
	const keyRes = await post(cfg.db, cfg.token, `entity/${testerId}`, [{ type: 'entu_api_key', string: '' }]);
	if (!keyRes.ok) throw new Error(`api-key mint failed: ${keyRes.status}`);
	const rawKey = ((keyRes.body as { properties?: Array<{ type?: string; string?: string }> }).properties ?? []).find(
		(p) => p.type === 'entu_api_key'
	)?.string;
	if (!rawKey) throw new Error('api-key mint returned 2xx with no raw key (apparent-success trap)');
	console.log('  entu_api_key minted (never logged)');

	const grantRes = await post(cfg.db, cfg.token, `entity/${eventId}`, [{ type: '_editor', reference: testerId }]);
	if (!grantRes.ok) throw new Error(`_editor grant failed: ${grantRes.status}`);
	const grantPropId = ((grantRes.body as { properties?: Array<{ type?: string; _id?: string }> }).properties ?? []).find(
		(p) => p.type === '_editor'
	)?._id;
	console.log(`  granted DIRECT _editor on the event (property ${grantPropId})`);
	ledger.push({ step: 'grant-editor', outcome: 'granted', eventId, testerId, propId: grantPropId });

	const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, {
		headers: { Authorization: `Bearer ${rawKey}`, Accept: 'application/json' }
	});
	const testerToken = ((await authRes.json()) as { token?: string }).token;
	if (!testerToken) throw new Error('tester auth exchange returned no token');

	// Sanity: the tester's rights on the event, as the tester sees them.
	const testerRights = await readProps(cfg.db, testerToken, eventId, '_owner,_editor,_expander,_viewer,_parent');
	console.log(`  tester read event rights+parent: HTTP ${testerRights.status} — ${JSON.stringify(testerRights.entity)}`);
	ledger.push({ step: 'tester-rights-selfcheck', outcome: String(testerRights.status), entity: testerRights.entity });

	// ── B: EDITOR ATOMIC-OVERWRITE OF THE SERIES `_parent` VALUE ──────────────
	console.log('\n=== B — editor ATOMIC-OVERWRITE of the series _parent value (the REASSIGN path) ===');
	const b = await post(cfg.db, testerToken, `entity/${eventId}`, [
		{ _id: seriesParent0._id, type: '_parent', reference: seriesBId }
	]);
	console.log(`  POST entity/{event} [{_id: <series parent>, _parent → series B}] AS EDITOR: HTTP ${b.status}`);
	console.log(`  body: ${JSON.stringify(b.body)}`);
	ledger.push({ step: 'B-editor-atomic-overwrite-parent', outcome: String(b.status), ok: b.ok, body: b.body });

	let bExpander: { status: number; ok: boolean; body: unknown } | null = null;
	let expanderGrantPropId: string | undefined;
	if (!b.ok) {
		console.log('  B refused — re-testing with _expander on the REFERENCED series B, to tell an owner-gate');
		console.log('  apart from a rights-on-the-referenced-entity requirement.');
		const eg = await post(cfg.db, cfg.token, `entity/${seriesBId}`, [{ type: '_expander', reference: testerId }]);
		expanderGrantPropId = ((eg.body as { properties?: Array<{ type?: string; _id?: string }> }).properties ?? []).find(
			(p) => p.type === '_expander'
		)?._id;
		bExpander = await post(cfg.db, testerToken, `entity/${eventId}`, [
			{ _id: seriesParent0._id, type: '_parent', reference: seriesBId }
		]);
		console.log(`  B2 (editor on event + expander on series B): HTTP ${bExpander.status} — ${JSON.stringify(bExpander.body)}`);
		ledger.push({ step: 'B2-editor-plus-expander-on-referenced', outcome: String(bExpander.status), ok: bExpander.ok, body: bExpander.body });
	}

	const afterB = await readProps(cfg.db, cfg.token, eventId, '_parent');
	console.log(`  owner readback after B: ${JSON.stringify(parentsOf(afterB.entity))}`);
	ledger.push({ step: 'B-readback', outcome: String(afterB.status), parents: parentsOf(afterB.entity) });
	const seasonStillThere = !!seasonParentOf(afterB.entity);
	const seriesNow = seriesParentOf(afterB.entity);
	console.log(`  season parent survived: ${seasonStillThere}; series parent now → ${seriesNow?.reference ?? '(none)'} (value ${seriesNow?._id ?? '-'})`);
	console.log(`  _parent value count after B: ${parentsOf(afterB.entity).length} (2 = clean overwrite, 3 = APPEND/duplicate)`);

	// ── A: EDITOR DELETE OF THE SERIES `_parent` VALUE ────────────────────────
	const targetForDelete = seriesNow ?? seriesParent0;
	console.log(`\n=== A — editor DELETE of the series _parent value ${targetForDelete._id} (the UNASSIGN path) ===`);
	const a = await del(cfg.db, testerToken, `property/${targetForDelete._id}`);
	console.log(`  DELETE property/{series parent value} AS EDITOR: HTTP ${a.status} — ${JSON.stringify(a.body)}`);
	ledger.push({ step: 'A-editor-delete-parent-value', outcome: String(a.status), ok: a.ok, body: a.body });

	const afterA = await readProps(cfg.db, cfg.token, eventId, '_parent');
	console.log(`  owner readback after A: ${JSON.stringify(parentsOf(afterA.entity))}`);
	ledger.push({ step: 'A-readback', outcome: String(afterA.status), parents: parentsOf(afterA.entity) });

	// ── A2: CONTROL — EDITOR DELETE OF A PLAIN PROPERTY VALUE ─────────────────
	console.log('\n=== A2 CONTROL — editor DELETE of a PLAIN (`location`) property value ===');
	let a2: { status: number; ok: boolean; body: unknown } | null = null;
	if (locationValue?._id) {
		a2 = await del(cfg.db, testerToken, `property/${locationValue._id}`);
		console.log(`  DELETE property/{location value} AS EDITOR: HTTP ${a2.status} — ${JSON.stringify(a2.body)}`);
		ledger.push({ step: 'A2-editor-delete-plain-value', outcome: String(a2.status), ok: a2.ok, body: a2.body });
		const afterA2 = await readProps(cfg.db, cfg.token, eventId, 'location');
		console.log(`  owner readback location: ${JSON.stringify(afterA2.entity?.location ?? null)}`);
		ledger.push({ step: 'A2-readback', outcome: String(afterA2.status), location: afterA2.entity?.location ?? null });
	} else {
		console.log('  skipped — fixture carried no location value');
	}

	// ── A3: CONTROL — OWNER DELETE OF WHAT THE EDITOR COULD NOT DELETE ────────
	console.log('\n=== A3 CONTROL — owner DELETE of the series _parent value ===');
	let a3: { status: number; ok: boolean; body: unknown } | null = null;
	const stillPresent = seriesParentOf(afterA.entity);
	if (stillPresent) {
		a3 = await del(cfg.db, cfg.token, `property/${stillPresent._id}`);
		console.log(`  DELETE property/{series parent value} AS OWNER: HTTP ${a3.status} — ${JSON.stringify(a3.body)}`);
		ledger.push({ step: 'A3-owner-delete-parent-value', outcome: String(a3.status), ok: a3.ok, body: a3.body });
		const afterA3 = await readProps(cfg.db, cfg.token, eventId, '_parent');
		console.log(`  owner readback after A3: ${JSON.stringify(parentsOf(afterA3.entity))}`);
		ledger.push({ step: 'A3-readback', outcome: String(afterA3.status), parents: parentsOf(afterA3.entity) });
	} else {
		console.log('  skipped — the editor DELETE already removed it (A succeeded)');
	}

	// ── VERDICT ───────────────────────────────────────────────────────────────
	console.log('\n=== VERDICT ===');
	console.log(`  editor atomic-overwrite of _parent : ${b.ok ? 'ALLOWED' : `REFUSED (${b.status})`}${bExpander ? ` | with _expander on referenced: ${bExpander.ok ? 'ALLOWED' : `REFUSED (${bExpander.status})`}` : ''}`);
	console.log(`  editor DELETE of a _parent value   : ${a.ok ? 'ALLOWED' : `REFUSED (${a.status})`}`);
	console.log(`  editor DELETE of a plain value     : ${a2 ? (a2.ok ? 'ALLOWED' : `REFUSED (${a2.status})`) : 'not run'}`);
	console.log(`  owner  DELETE of a _parent value   : ${a3 ? (a3.ok ? 'ALLOWED' : `REFUSED (${a3.status})`) : 'not run (editor already removed it)'}`);

	// ── CLEANUP ───────────────────────────────────────────────────────────────
	console.log('\n=== CLEANUP ===');
	for (const [label, path] of [
		['editor grant', grantPropId ? `property/${grantPropId}` : ''],
		['expander grant', expanderGrantPropId ? `property/${expanderGrantPropId}` : ''],
		['tester', `entity/${testerId}`],
		['event', `entity/${eventId}`],
		['series A', `entity/${seriesAId}`],
		['series B', `entity/${seriesBId}`],
		['season', `entity/${seasonId}`]
	] as Array<[string, string]>) {
		if (!path) continue;
		const r = await del(cfg.db, cfg.token, path);
		console.log(`  delete ${label} (${path}): ${r.ok ? 'OK' : 'FAILED'} (${r.status})`);
		ledger.push({ step: `cleanup-${label.replace(/\s+/g, '-')}`, outcome: r.ok ? 'deleted' : 'delete-failed', status: r.status, path });
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-304-parent-rights-gate',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose: 'mvox-app#304 SPIKE — is a _parent value DELETE owner-gated while a _parent atomic-overwrite POST is editor-gated? Verified live on polyphony with an editor-not-owner caller.',
			ledger
		}
	});
	console.log(`\nledger: ${artifactPath}`);
}

main().catch((e) => {
	console.error('PROBE FAILED:', e);
	console.error('ledger so far:', JSON.stringify(ledger, null, 2));
	process.exit(1);
});
