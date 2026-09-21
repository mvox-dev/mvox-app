// Probe commission from Gama (no issue — platform behaviour), relayed by
// team-lead 2026-09-21. Estate: polyphony (synthetic, routine-ops pre-auth;
// ENTU_DATABASE in ~/.config/mvox/credentials.env — NOT crede).
//
// entu-www src/api/properties/index.md ("Properties" table, row 19) already
// states: "`created` | Object with `at` (ISO timestamp) and `by` (person
// entity ID) — who set this value and when." This probe settles what that
// line leaves open, empirically:
//
//   Q1 — is `created.at`/`created.by` actually PRESENT on every value object
//        of a live, previously-written string property, with what other
//        keys alongside it (`_id`, `type`, `string`)?
//   Q2 — `GET /api/{db}/property/{_id}` is documented ONLY under
//        src/api/files/index.md ("Download Process" — a signed-URL redirect
//        for FILE values). Undocumented for a plain string value: does the
//        endpoint even resolve one, and what shape comes back?
//   Q3 — own-writes: POST a new value, DELETE the old by `_id`, re-read.
//        Does the new value's `created.at` postdate the old one's, does
//        `created.by` read as the runner's own identity, and is the OLD
//        (now-deleted) value still fetchable via Q2's endpoint (soft-delete
//        visibility) after the DELETE?
//
// Q1 target: the database entity's own `name` property (resolveDatabaseEntityId
// — one canonical entity per db, schema-level, no PII). Q3 fixture: one
// throwaway `person`-typed entity, `_probe_property_created_stamp_*` name
// values, created and torn down within this run — same pattern as
// probe-create-auto-grant-doc-count-2026-09-09.ts.
//
// This probe is polyphony-only. It imports `loadCfg` (creds.ts), never the
// crede-scoped config loader from script-runner.ts — per
// liveRunAuthorization.guard.spec.ts's own scope note, `loadCfg` callers
// are deliberately outside that fence (pending #422), so this script calls
// `assertLiveRunAuthorized` itself, by hand, before its first mutating
// call — belt-and-suspenders, not required by the guard.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-property-value-created-stamp-2026-09-21.ts        # DRY_RUN=true default
//   DRY_RUN=false AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/probes/probe-property-value-created-stamp-2026-09-21.ts        # own-writes need LIVE

import { entuFetch } from '$lib/entu/request';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { loadCfg } from '../lib/creds';
import { readDryRun, readAuthorizedBy } from '../lib/script-runner';
import { writeLedger, assertLiveRunAuthorized } from '../lib/ledger-writer';

const DRY_RUN = readDryRun();
const AUTHORIZED_BY = readAuthorizedBy();

interface PropValue {
	_id?: string;
	type?: string;
	string?: string;
	created?: { at?: string; by?: string };
	[k: string]: unknown;
}

/**
 * Q1 established that `entity/{id}?props=X` value objects carry NO
 * `created` field (key set is just `_id`+`string`) — only the dedicated
 * `property/{_id}` endpoint returns it (Q2). So Q3's ordering/identity
 * check must fetch each value's stamp via THIS endpoint, never the
 * entity-embedded read.
 */
async function fetchCreatedStamp(
	db: string,
	token: string,
	valueId: string
): Promise<{ at?: string; by?: string } | undefined> {
	const res = await entuFetch(db, `property/${valueId}`, token);
	if (!res.ok) return undefined;
	const body = (await res.json()) as PropValue;
	return body.created;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	// #417-style preflight, by hand: this script is not discovered by
	// liveRunAuthorization.guard.spec.ts (it imports loadCfg, not the
	// crede-scoped config loader), but the same rule applies in spirit —
	// throw before the first mutating call when a live run carries no
	// recorded authorizer.
	assertLiveRunAuthorized(DRY_RUN, AUTHORIZED_BY);

	const ledger: Array<{ step: string; outcome: string; [k: string]: unknown }> = [];

	const authRes = await fetch(`https://api.entu.app/auth?db=${cfg.db}`, {
		headers: { Authorization: `Bearer ${process.env.ENTU_API_KEY}`, Accept: 'application/json' }
	});
	const authBody = (await authRes.json()) as { accounts?: Array<{ user?: { _id?: string } }> };
	const callerId = authBody.accounts?.[0]?.user?._id;
	if (!callerId) throw new Error('could not resolve runner identity');
	console.log(`runner identity: ${callerId}`);

	// ── Q1 — key set on an existing, previously-written value ──────────────
	const dbEntityId = await resolveDatabaseEntityId(cfg);
	if (!dbEntityId) throw new Error('no database entity readable');
	const dbRes = await entuFetch(cfg.db, `entity/${dbEntityId}?props=name`, cfg.token);
	const dbBody = (await dbRes.json()) as { entity?: { name?: PropValue[] } };
	const nameValues = dbBody.entity?.name ?? [];
	const keySets = nameValues.map((v) => Object.keys(v).sort());
	const firstValue = nameValues[0];
	console.log(`Q1 — db entity ${dbEntityId} name values: ${nameValues.length}, key set(s): ${JSON.stringify(keySets)}`);
	ledger.push({
		step: 'q1-existing-value-key-set',
		outcome: 'observed',
		entityId: dbEntityId,
		valueCount: nameValues.length,
		keySets,
		createdShape: firstValue?.created
			? { atPresent: typeof firstValue.created.at === 'string', byPresent: typeof firstValue.created.by === 'string' }
			: { atPresent: false, byPresent: false }
	});

	// ── Q2 — GET /property/{_id} for that same string value ────────────────
	const q1ValueId = firstValue?._id;
	if (!q1ValueId) throw new Error('Q1 value carried no _id — cannot probe Q2');
	const q2Res = await entuFetch(cfg.db, `property/${q1ValueId}`, cfg.token);
	let q2Body: unknown;
	try {
		q2Body = await q2Res.json();
	} catch {
		q2Body = null;
	}
	const q2BodyKeys = q2Body && typeof q2Body === 'object' ? Object.keys(q2Body as Record<string, unknown>) : [];
	console.log(`Q2 — GET property/${q1ValueId}: HTTP ${q2Res.status}, body keys: ${JSON.stringify(q2BodyKeys)}`);
	ledger.push({
		step: 'q2-property-endpoint-string-value',
		outcome: `http-${q2Res.status}`,
		propertyId: q1ValueId,
		httpStatus: q2Res.status,
		bodyKeys: q2BodyKeys
	});

	// ── Q3 — own-writes on a throwaway fixture ──────────────────────────────
	if (DRY_RUN) {
		console.log(
			'\nDRY RUN — would create one throwaway person-typed entity (_probe_property_created_stamp_A), ' +
				'POST a second name value (_probe_property_created_stamp_B), DELETE the first by _id, re-read ' +
				'created.at/created.by ordering, GET property/{oldId} to check soft-delete visibility, then clean up.'
		);
		ledger.push({ step: 'q3-dry-run', outcome: 'dry-run-would-run' });
	} else {
		const personTypeRes = await entuFetch(
			cfg.db,
			'entity?_type.string=entity&name.string=person&props=_id&limit=1',
			cfg.token
		);
		const personTypeBody = (await personTypeRes.json()) as { entities?: Array<{ _id?: string }> };
		const personTypeId = personTypeBody.entities?.[0]?._id;
		if (!personTypeId) throw new Error('could not resolve person type-def id');

		const createRes = await entuFetch(cfg.db, 'entity', cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: '_type', reference: personTypeId },
				{ type: '_parent', reference: dbEntityId },
				{ type: 'name', string: '_probe_property_created_stamp_A' }
			])
		});
		const createBody = (await createRes.json()) as { _id?: string };
		const fixtureId = createBody._id;
		if (!fixtureId) throw new Error('fixture create failed');
		console.log(`created throwaway fixture: ${fixtureId}`);
		ledger.push({ step: 'q3-create-fixture', outcome: 'created', fixtureId });

		const readARes = await entuFetch(cfg.db, `entity/${fixtureId}?props=name`, cfg.token);
		const readABody = (await readARes.json()) as { entity?: { name?: PropValue[] } };
		const valueA = (readABody.entity?.name ?? [])[0];
		if (!valueA?._id) throw new Error('fixture value A carried no _id');
		const createdA = await fetchCreatedStamp(cfg.db, cfg.token, valueA._id);
		console.log(`value A: _id=${valueA._id} created=${JSON.stringify(createdA)} (via property/{_id}, per Q1/Q2)`);
		ledger.push({ step: 'q3-read-value-a', outcome: 'observed', valueId: valueA._id, created: createdA });

		const postBRes = await entuFetch(cfg.db, `entity/${fixtureId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'name', string: '_probe_property_created_stamp_B' }])
		});
		await postBRes.json();

		const readAfterBRes = await entuFetch(cfg.db, `entity/${fixtureId}?props=name`, cfg.token);
		const readAfterBBody = (await readAfterBRes.json()) as { entity?: { name?: PropValue[] } };
		const valuesAfterB = readAfterBBody.entity?.name ?? [];
		const valueB = valuesAfterB.find((v) => v._id !== valueA._id);
		if (!valueB?._id) throw new Error('value B not found after POST (append semantics expected)');
		const createdB = await fetchCreatedStamp(cfg.db, cfg.token, valueB._id);
		console.log(`value B: _id=${valueB._id} created=${JSON.stringify(createdB)} (via property/{_id}, per Q1/Q2)`);
		ledger.push({ step: 'q3-read-value-b', outcome: 'observed', valueId: valueB._id, created: createdB, totalValuesAfterPost: valuesAfterB.length });

		const bPostdatesA = !!(createdA?.at && createdB?.at && createdB.at > createdA.at);
		const bByIsRunner = createdB?.by === callerId;
		console.log(`>> B.created.at postdates A.created.at: ${bPostdatesA}`);
		console.log(`>> B.created.by === runner identity: ${bByIsRunner}`);
		ledger.push({
			step: 'q3-verdict-ordering-and-identity',
			outcome: bPostdatesA && bByIsRunner ? 'confirmed' : 'unexpected',
			bPostdatesA,
			bByIsRunner
		});

		const deleteARes = await entuFetch(cfg.db, `property/${valueA._id}`, cfg.token, { method: 'DELETE' });
		console.log(`DELETE property/${valueA._id}: HTTP ${deleteARes.status}`);
		ledger.push({ step: 'q3-delete-value-a', outcome: deleteARes.ok ? 'deleted' : 'delete-failed', valueId: valueA._id, httpStatus: deleteARes.status });

		const readAfterDeleteRes = await entuFetch(cfg.db, `entity/${fixtureId}?props=name`, cfg.token);
		const readAfterDeleteBody = (await readAfterDeleteRes.json()) as { entity?: { name?: PropValue[] } };
		const valuesAfterDelete = readAfterDeleteBody.entity?.name ?? [];
		console.log(`entity name values after DELETE of A: ${valuesAfterDelete.length} (expect 1, only B)`);
		ledger.push({ step: 'q3-read-after-delete', outcome: 'observed', valueCount: valuesAfterDelete.length, remainingIds: valuesAfterDelete.map((v) => v._id) });

		const softDeleteRes = await entuFetch(cfg.db, `property/${valueA._id}`, cfg.token);
		let softDeleteBody: unknown;
		try {
			softDeleteBody = await softDeleteRes.json();
		} catch {
			softDeleteBody = null;
		}
		const softDeleteBodyKeys =
			softDeleteBody && typeof softDeleteBody === 'object' ? Object.keys(softDeleteBody as Record<string, unknown>) : [];
		console.log(`Q3 soft-delete check — GET property/${valueA._id} after DELETE: HTTP ${softDeleteRes.status}, body keys: ${JSON.stringify(softDeleteBodyKeys)}`);
		ledger.push({
			step: 'q3-soft-delete-visibility-check',
			outcome: `http-${softDeleteRes.status}`,
			propertyId: valueA._id,
			httpStatus: softDeleteRes.status,
			bodyKeys: softDeleteBodyKeys,
			stillReadable: softDeleteRes.ok
		});

		// cleanup — delete the surviving value, then the fixture entity, then verify gone
		const deleteBRes = await entuFetch(cfg.db, `property/${valueB._id}`, cfg.token, { method: 'DELETE' });
		console.log(`cleanup DELETE property/${valueB._id}: HTTP ${deleteBRes.status}`);
		ledger.push({ step: 'cleanup-delete-value-b', outcome: deleteBRes.ok ? 'deleted' : 'delete-failed', valueId: valueB._id, httpStatus: deleteBRes.status });

		const deleteFixtureRes = await entuFetch(cfg.db, `entity/${fixtureId}`, cfg.token, { method: 'DELETE' });
		console.log(`cleanup DELETE entity/${fixtureId}: HTTP ${deleteFixtureRes.status}`);
		ledger.push({ step: 'cleanup-delete-fixture', outcome: deleteFixtureRes.ok ? 'deleted' : 'delete-failed', fixtureId, httpStatus: deleteFixtureRes.status });

		const verifyGoneRes = await entuFetch(cfg.db, `entity/${fixtureId}`, cfg.token);
		console.log(`independent re-verify: HTTP ${verifyGoneRes.status} (expect 404)`);
		ledger.push({ step: 'verify-fixture-gone', outcome: String(verifyGoneRes.status), expected: 404 });
	}

	const artifactPath = writeLedger({
		scriptName: 'probe-property-value-created-stamp',
		dryRun: DRY_RUN,
		db: cfg.db,
		sensitive: false,
		payload: {
			purpose:
				"Settles what entu-www properties/index.md leaves open about the `created` stamp on a value object, " +
				'and whether GET /property/{_id} — documented only for file values — resolves a plain string value at ' +
				'all. Gama commission via team-lead, 2026-09-21, polyphony synthetic, routine-ops pre-auth.',
			docQuote:
				'entu-www src/api/properties/index.md: "`created` | Object with `at` (ISO timestamp) and `by` (person ' +
				'entity ID) — who set this value and when."',
			ledger
		},
		authorizedBy: AUTHORIZED_BY
	});
	console.log(`\nLedger: ${artifactPath}`);
}

main().catch((err) => {
	console.error('probe-property-value-created-stamp ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
