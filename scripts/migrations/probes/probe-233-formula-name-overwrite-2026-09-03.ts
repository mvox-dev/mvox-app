// #233 — does a `formula` on a property unconditionally overwrite an app-written
// value, or does it respect an existing manual value (compute-when-empty)?
// Pre-authorized by team-lead (dispatch msg, throwaway `_probe_*` entities only,
// polyphony db — fully synthetic per privacy-boundary register).
//
// Creates a throwaway type `_probe_formula_233` with 3 string prop-defs
// (evt_date, evt_kind, name — no formula yet), one instance with a MANUALLY
// SET `name` (simulating a standalone-event free-text name), then adds a
// `formula` (`evt_date ' ' evt_kind`, implicit CONCAT) to the `name` prop-def
// and re-checks:
//   (a) does GET .../aggregate overwrite the manual name?
//   (b) does a fresh manual POST to `name` (same request cycle as any normal
//       app write, which always calls aggregateEntity — utils/entity.js:55)
//       stick even momentarily, or is it clobbered inline?
// Tears everything down (instance, 3 prop-defs, type) at the end regardless
// of outcome — nothing left live.

import { entuFetch } from '$lib/entu/request';
import { loadCfg } from '../lib/creds';

const ENTITY_META_TYPE_ID = '69bcfd8e9c031ab8e6ce8034'; // "entity" meta-type (type-defs)
const PROPERTY_META_TYPE_ID = '69bcfd8e9c031ab8e6ce8048'; // "property" meta-type (prop-defs)

type Cfg = Awaited<ReturnType<typeof loadCfg>>;

async function post(cfg: Cfg, path: string, body: unknown, fetchImpl: typeof fetch) {
	const res = await entuFetch(cfg.db, path, cfg.token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl);
	if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
	return (await res.json()) as { _id: string; properties?: Array<{ _id: string; type: string }> };
}

async function get(cfg: Cfg, path: string, fetchImpl: typeof fetch) {
	const res = await entuFetch(cfg.db, path, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
	return res.json();
}

async function del(cfg: Cfg, path: string, fetchImpl: typeof fetch) {
	const res = await entuFetch(cfg.db, path, cfg.token, { method: 'DELETE' }, fetchImpl);
	return res.ok;
}

async function main() {
	const cfg = await loadCfg();
	const fetchImpl = fetch;
	const teardown: Array<{ label: string; path: string }> = [];
	const result: Record<string, unknown> = { task: '#233 formula-overwrite probe', db: cfg.db };

	try {
		// 1. throwaway type
		const type = await post(cfg, 'entity', [
			{ type: '_type', reference: ENTITY_META_TYPE_ID },
			{ type: 'name', string: '_probe_formula_233' }
		], fetchImpl);
		teardown.unshift({ label: 'type', path: `entity/${type._id}` });

		// 2. prop-defs: evt_date, evt_kind, name (no formula yet)
		const pdDate = await post(cfg, 'entity', [
			{ type: '_type', reference: PROPERTY_META_TYPE_ID },
			{ type: '_parent', reference: type._id },
			{ type: 'name', string: 'evt_date' },
			{ type: 'type', string: 'string' }
		], fetchImpl);
		teardown.unshift({ label: 'propdef evt_date', path: `entity/${pdDate._id}` });

		const pdKind = await post(cfg, 'entity', [
			{ type: '_type', reference: PROPERTY_META_TYPE_ID },
			{ type: '_parent', reference: type._id },
			{ type: 'name', string: 'evt_kind' },
			{ type: 'type', string: 'string' }
		], fetchImpl);
		teardown.unshift({ label: 'propdef evt_kind', path: `entity/${pdKind._id}` });

		const pdName = await post(cfg, 'entity', [
			{ type: '_type', reference: PROPERTY_META_TYPE_ID },
			{ type: '_parent', reference: type._id },
			{ type: 'name', string: 'name' },
			{ type: 'type', string: 'string' }
		], fetchImpl);
		teardown.unshift({ label: 'propdef name', path: `entity/${pdName._id}` });

		// 3. instance with MANUAL name (no formula on `name` yet)
		const inst = await post(cfg, 'entity', [
			{ type: '_type', reference: type._id },
			{ type: 'evt_date', string: '2026-09-15' },
			{ type: 'evt_kind', string: 'proov' },
			{ type: 'name', string: 'MANUAL-NAME-BEFORE-FORMULA' }
		], fetchImpl);
		teardown.unshift({ label: 'instance', path: `entity/${inst._id}` });

		const beforeRead = (await get(cfg, `entity/${inst._id}?props=name,evt_date,evt_kind`, fetchImpl)) as {
			entity: { name?: Array<{ string: string }> };
		};
		result.stepA_manualNameBeforeFormula = beforeRead.entity.name?.[0]?.string ?? null;

		// 4. add formula to the `name` prop-def (implicit CONCAT: evt_date ' ' evt_kind)
		await post(cfg, `entity/${pdName._id}`, [{ type: 'formula', string: "evt_date ' ' evt_kind" }], fetchImpl);

		// 5a. explicit re-aggregate — does it overwrite the manual value?
		const aggRead = (await get(cfg, `entity/${inst._id}/aggregate`, fetchImpl)) as {
			entity: { name?: Array<{ string: string }> };
		};
		result.stepB_nameAfterExplicitAggregate = aggRead.entity.name?.[0]?.string ?? null;

		// 5b. read-back via plain GET (cached) to confirm the aggregate result persisted, not just the response body
		const afterAggPlainRead = (await get(cfg, `entity/${inst._id}?props=name`, fetchImpl)) as {
			entity: { name?: Array<{ string: string }> };
		};
		result.stepC_nameReadBackAfterAggregate = afterAggPlainRead.entity.name?.[0]?.string ?? null;

		// 6. fresh manual POST to `name` while formula is active — does it stick even momentarily?
		const postAttemptBody = await post(cfg, `entity/${inst._id}`, [{ type: 'name', string: 'MANUAL-NAME-ATTEMPT-2' }], fetchImpl);
		result.stepD_postResponseBody = postAttemptBody; // raw response — does the API echo the manual value or the formula value?

		const afterManualPost = (await get(cfg, `entity/${inst._id}?props=name`, fetchImpl)) as {
			entity: { name?: Array<{ string: string }> };
		};
		result.stepE_nameAfterFreshManualPost = afterManualPost.entity.name?.[0]?.string ?? null;

		result.verdict =
			result.stepC_nameReadBackAfterAggregate !== 'MANUAL-NAME-BEFORE-FORMULA' &&
			result.stepE_nameAfterFreshManualPost !== 'MANUAL-NAME-ATTEMPT-2'
				? 'FORMULA UNCONDITIONALLY OVERWRITES manual `name` values — halt condition CONFIRMED live'
				: 'manual value survived — unexpected, re-examine';
	} finally {
		// teardown: instance, then prop-defs, then type (reverse creation order, already unshifted)
		const deleted: Array<{ label: string; ok: boolean }> = [];
		for (const t of teardown) {
			deleted.push({ label: t.label, ok: await del(cfg, t.path, fetchImpl) });
		}
		result.teardown = deleted;
	}

	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error('probe-233-formula-name-overwrite ABORTED:', err instanceof Error ? err.message : String(err));
	if (err instanceof Error && err.cause) console.error('CAUSE:', err.cause);
	if (err instanceof Error && err.stack) console.error('STACK:', err.stack);
	process.exit(1);
});
