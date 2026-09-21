// Gama follow-up (06:24Z + a later note), relayed by team-lead, to the
// property-created-stamp probe (#439/#440). Same estate: polyphony
// (synthetic, routine-ops pre-auth). READ-ONLY throughout — no writes, no
// fixtures, nothing to tear down.
//
// Q1 — does the documented reference/datetime filter pattern
//      (entu-www src/api/query-reference/index.md: "`prop.reference=id` |
//      `owner.reference=abc123` | Exact reference match" and
//      "`prop.datetime.gte=ISO8601` | `created_at.datetime.gte=
//      2025-01-01T00:00:00Z` | Greater than or equal") work when applied to
//      the entity-level system field `_created` — an application the docs
//      never show as a worked example?
// Q2 — for three undocumented spellings aimed at a VALUE's own `created`
//      stamp (`name.created.by=`, `name.created.reference=`, `created.by=`),
//      does the API REJECT (4xx), SILENTLY IGNORE (200, count equals an
//      unfiltered baseline — every entity comes back, which would mislead a
//      caller reading a non-empty result as a match), or something else?
// Q3 — `entity/{id}?props=name` (the original probe's Q1) requested ONE
//      prop. Does the `created` stamp appear on entity-embedded values under
//      a DIFFERENT read shape: the FULL entity (no `props=` at all), or
//      `props=name,_created` (naming `_created` alongside the value)?
// Q4 — Q1/Q3 of the original probe sampled ONE entity with ONE value. Read
//      one polyphony entity carrying SEVERAL values of mixed property types
//      (string, reference, date/datetime, boolean) — both as a full read and
//      via an explicit `props=` list — and record the key set of EVERY
//      value object, to confirm "entity reads never carry `created`" holds
//      generally, not just for the single-value case already sampled.
//
// Fixture selection for Q4: polyphony's populated types today are sparse —
// `event`/`rsvp`/`attendance` etc. all read count=0 live. `member` (2
// instances) carries a reference (`person`), a plain string (`status`), a
// FORMULA string (`name`), and the universal system props (`_created`,
// `_owner` et al, `_inheritrights` boolean) — the richest mixed-type sample
// actually populated on this db. `season` (1 instance) adds `date`-typed
// props (`start_date`/`end_date`) as a secondary cross-check; neither type
// carries a `datetime`-typed regular property on live polyphony today.
//
// This probe imports `loadCfg` (creds.ts), never the crede-scoped config
// loader — out of liveRunAuthorization.guard.spec.ts's scope by design
// (pending #422). No mutating call anywhere in this file, so no
// `assertLiveRunAuthorized` call is needed (nothing to gate).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL}/"   # trailing slash required, see loadCfg
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-property-author-filter-2026-09-21.ts

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';
import { writeLedger } from '../lib/ledger-writer';

interface PropValue {
	_id?: string;
	type?: string;
	string?: string;
	created?: { at?: string; by?: string };
	[k: string]: unknown;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: READ-ONLY — db=${cfg.db}\n`);

	const ledger: Array<{ step: string; outcome: string; [k: string]: unknown }> = [];

	const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, {
		headers: { Authorization: `Bearer ${process.env.ENTU_API_KEY}`, Accept: 'application/json' }
	});
	const authBody = (await authRes.json()) as { accounts?: Array<{ user?: { _id?: string } }> };
	const callerId = authBody.accounts?.[0]?.user?._id;
	if (!callerId) throw new Error('could not resolve runner identity');
	console.log(`runner identity: ${callerId}`);

	// ── Q1 — documented filter pattern applied to _created ──────────────────
	const q1aRes = await entuFetch(cfg.db, `entity?_created.reference=${callerId}&props=_type,_created&limit=5`, cfg.token);
	const q1aBody = (await q1aRes.json()) as { entities?: Array<{ _created?: PropValue[] }>; count?: number };
	const q1aEntities = q1aBody.entities ?? [];
	const q1aAllMatch = q1aEntities.length > 0 && q1aEntities.every((e) => e._created?.[0]?.reference === callerId);
	console.log(
		`Q1a — entity?_created.reference=<runner>: HTTP ${q1aRes.status}, count=${q1aBody.count}, returned=${q1aEntities.length}, every _created[0].reference===runner: ${q1aAllMatch}`
	);
	ledger.push({
		step: 'q1a-created-reference-filter',
		outcome: `http-${q1aRes.status}`,
		httpStatus: q1aRes.status,
		reportedCount: q1aBody.count,
		returnedCount: q1aEntities.length,
		everyMatchesRunner: q1aAllMatch
	});

	const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const q1bRes = await entuFetch(
		cfg.db,
		`entity?_created.datetime.gte=${encodeURIComponent(yesterdayIso)}&props=_type,_created&limit=5`,
		cfg.token
	);
	const q1bBody = (await q1bRes.json()) as { entities?: unknown[]; count?: number };
	console.log(
		`Q1b — entity?_created.datetime.gte=<yesterday>: HTTP ${q1bRes.status}, count=${q1bBody.count}, returned=${(q1bBody.entities ?? []).length}`
	);
	ledger.push({
		step: 'q1b-created-datetime-gte-filter',
		outcome: `http-${q1bRes.status}`,
		httpStatus: q1bRes.status,
		reportedCount: q1bBody.count,
		returnedCount: (q1bBody.entities ?? []).length,
		sinceIso: yesterdayIso
	});

	// ── Q2 — three value-stamp spellings, explicit REJECTED vs IGNORED vs OTHER ──
	const baselineRes = await entuFetch(cfg.db, 'entity?props=_id&limit=1', cfg.token);
	const baselineBody = (await baselineRes.json()) as { count?: number };
	const baselineCount = baselineBody.count;
	console.log(`Q2 baseline — entity?limit=1 (no filter): HTTP ${baselineRes.status}, count=${baselineCount}`);
	ledger.push({
		step: 'q2-baseline-unfiltered-count',
		outcome: `http-${baselineRes.status}`,
		httpStatus: baselineRes.status,
		reportedCount: baselineCount
	});

	const valueStampSpellings = [
		{ label: 'name.created.by', qs: `name.created.by=${callerId}` },
		{ label: 'name.created.reference', qs: `name.created.reference=${callerId}` },
		{ label: 'created.by', qs: `created.by=${callerId}` }
	];
	for (const { label, qs } of valueStampSpellings) {
		const res = await entuFetch(cfg.db, `entity?${qs}&props=_id&limit=5`, cfg.token);
		let body: { count?: number } = {};
		let bodyIsJson = true;
		try {
			body = await res.json();
		} catch {
			bodyIsJson = false;
		}
		const reportedCount = body.count;
		const disposition = !res.ok
			? 'rejected'
			: reportedCount === baselineCount
				? 'silently-ignored'
				: reportedCount === 0
					? 'filtered-to-zero'
					: 'other-nonzero-nonbaseline';
		console.log(`Q2 spelling '${label}': HTTP ${res.status}, count=${reportedCount}, disposition=${disposition}`);
		ledger.push({
			step: `q2-value-stamp-spelling-${label.replace(/\./g, '-')}`,
			outcome: disposition,
			spelling: label,
			httpStatus: res.status,
			bodyIsJson,
			reportedCount,
			baselineCount,
			note:
				disposition === 'silently-ignored'
					? 'DANGEROUS: count equals the unfiltered baseline — every entity returned, which would mislead a caller reading a non-empty result as a match'
					: disposition === 'filtered-to-zero'
						? 'safe (empty set, not everything) but does NOT confirm this spelling addresses the value-level stamp specifically'
						: undefined
		});
	}

	// ── Q3 — does `created` appear on entity-embedded values under a
	// different read shape (full entity, or props naming _created too)? ─────
	const dbRes0 = await entuFetch(cfg.db, 'entity?_type.string=database&props=_id&limit=1', cfg.token);
	const dbBody0 = (await dbRes0.json()) as { entities?: Array<{ _id?: string }> };
	const dbEntityId = dbBody0.entities?.[0]?._id;
	if (!dbEntityId) throw new Error('no database entity readable');

	const fullRes = await entuFetch(cfg.db, `entity/${dbEntityId}`, cfg.token);
	const fullBody = (await fullRes.json()) as { entity?: { name?: PropValue[] } };
	const fullNameKeys = (fullBody.entity?.name ?? []).map((v) => Object.keys(v).sort());
	console.log(`Q3a — entity/${dbEntityId} (NO props=, full entity): name value key set(s): ${JSON.stringify(fullNameKeys)}`);
	ledger.push({ step: 'q3a-full-entity-read-name-key-set', outcome: 'observed', entityId: dbEntityId, keySets: fullNameKeys });

	const withCreatedRes = await entuFetch(cfg.db, `entity/${dbEntityId}?props=name,_created`, cfg.token);
	const withCreatedBody = (await withCreatedRes.json()) as { entity?: { name?: PropValue[]; _created?: PropValue[] } };
	const withCreatedNameKeys = (withCreatedBody.entity?.name ?? []).map((v) => Object.keys(v).sort());
	const entityLevelCreatedKeys = (withCreatedBody.entity?._created ?? []).map((v) => Object.keys(v).sort());
	console.log(
		`Q3b — entity/${dbEntityId}?props=name,_created: name value key set(s): ${JSON.stringify(withCreatedNameKeys)}, _created (entity-level) key set(s): ${JSON.stringify(entityLevelCreatedKeys)}`
	);
	ledger.push({
		step: 'q3b-props-name-and-created-key-sets',
		outcome: 'observed',
		entityId: dbEntityId,
		nameKeySets: withCreatedNameKeys,
		entityLevelCreatedKeySets: entityLevelCreatedKeys
	});

	// ── Q4 — mixed-value-type entity, full read + explicit props=, every value's key set ──
	const memberRes = await entuFetch(cfg.db, 'entity?_type.string=member&props=_id&limit=1', cfg.token);
	const memberBody = (await memberRes.json()) as { entities?: Array<{ _id?: string }> };
	const memberId = memberBody.entities?.[0]?._id;
	if (!memberId) throw new Error('no member entity readable for Q4');

	const memberFullRes = await entuFetch(cfg.db, `entity/${memberId}`, cfg.token);
	const memberFullBody = (await memberFullRes.json()) as { entity?: Record<string, PropValue[] | undefined> };
	const memberFullEntity = memberFullBody.entity ?? {};
	const memberFullKeySetsByProp: Record<string, string[][]> = {};
	for (const [prop, values] of Object.entries(memberFullEntity)) {
		if (Array.isArray(values)) memberFullKeySetsByProp[prop] = values.map((v) => Object.keys(v).sort());
	}
	console.log(`Q4a — entity/${memberId} (NO props=, full entity, type=member): key sets by property:`);
	console.log(JSON.stringify(memberFullKeySetsByProp, null, 2));
	ledger.push({ step: 'q4a-mixed-type-entity-full-read', outcome: 'observed', entityId: memberId, entityType: 'member', keySetsByProperty: memberFullKeySetsByProp });

	const memberScopedRes = await entuFetch(cfg.db, `entity/${memberId}?props=person,status,name,_created`, cfg.token);
	const memberScopedBody = (await memberScopedRes.json()) as { entity?: Record<string, PropValue[] | undefined> };
	const memberScopedEntity = memberScopedBody.entity ?? {};
	const memberScopedKeySetsByProp: Record<string, string[][]> = {};
	for (const [prop, values] of Object.entries(memberScopedEntity)) {
		if (Array.isArray(values)) memberScopedKeySetsByProp[prop] = values.map((v) => Object.keys(v).sort());
	}
	const anyValueCarriesCreated = Object.entries(memberScopedKeySetsByProp)
		.filter(([prop]) => prop !== '_created')
		.some(([, keySets]) => keySets.some((ks) => ks.includes('created')));
	console.log(`Q4b — entity/${memberId}?props=person,status,name,_created: key sets by property:`);
	console.log(JSON.stringify(memberScopedKeySetsByProp, null, 2));
	console.log(`>> any non-_created value carries a 'created' key: ${anyValueCarriesCreated} (expect false)`);
	ledger.push({
		step: 'q4b-mixed-type-entity-scoped-props-read',
		outcome: anyValueCarriesCreated ? 'unexpected-created-present' : 'confirmed-absent',
		entityId: memberId,
		entityType: 'member',
		keySetsByProperty: memberScopedKeySetsByProp,
		anyNonCreatedValueCarriesCreated: anyValueCarriesCreated
	});

	const artifactPath = writeLedger({
		scriptName: 'probe-property-author-filter',
		dryRun: false,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose:
				'Gama follow-up to the property-created-stamp probe (#439/#440): does the documented reference/' +
				'datetime filter pattern work on entity-level _created; do three undocumented value-stamp filter ' +
				'spellings get rejected or silently ignored; does created ever appear on an entity-embedded value ' +
				'under a different read shape (full entity, or props naming _created); and does the "entity reads ' +
				'never carry created" finding hold on a real multi-value, mixed-property-type entity, not just the ' +
				'single-value sample from the original probe. Read-only, polyphony synthetic.',
			docQuote:
				'entu-www src/api/query-reference/index.md: "`prop.reference=id` | `owner.reference=abc123` | Exact ' +
				'reference match" and "`prop.datetime.gte=ISO8601` | `created_at.datetime.gte=2025-01-01T00:00:00Z` ' +
				'| Greater than or equal" — `_created` itself never appears as a worked filter example.',
			ledger
		}
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-property-author-filter ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
