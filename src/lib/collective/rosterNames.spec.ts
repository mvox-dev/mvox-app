import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
// #267 RED — the contract module does not exist yet; GREEN creates it.
import { readRosterNamesSetting, updateRosterShowRealNames } from './rosterNames';

// #267 RED — the data seam behind the profile page's admin-only roster-names
// toggle: the collective-wide `roster_show_real_names` boolean on the
// DATABASE ENTITY (collective = database, #161; prop-def provisioned live on
// both dbs by #265 — boolean, `_sharing: domain`, so every member's client
// can READ it while only the db entity's `_owner`/`_editor` — exactly the set
// the admin gate checks — can WRITE it; no new rights mechanism).
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/lib/collective/rosterNames.ts (new)
//     export type RosterNamesSetting = { dbEntityId: string; showRealNames: boolean };
//     export async function readRosterNamesSetting(
//       cfg: EntuCfg,
//       fetchImpl?: typeof fetch
//     ): Promise<RosterNamesSetting>;
//     export async function updateRosterShowRealNames(
//       cfg: EntuCfg,
//       dbEntityId: string,
//       value: boolean,
//       fetchImpl?: typeof fetch
//     ): Promise<void>;
//
//   readRosterNamesSetting — resolveDatabaseEntityId (the ONE way the app
//   answers "which entity is this db's collective") then ONE GET
//   `entity/{dbEntityId}?props=roster_show_real_names`. Value shape:
//   `entity.roster_show_real_names?.[0]?.boolean ?? false` — the key is
//   entirely ABSENT from the entity JSON when unset (platform-doc-verified,
//   entu-www properties docs), so absent → false → the UI's 'profile'
//   default. The resolved dbEntityId rides along in the answer because the
//   WRITE needs it. Fail loud (house rule): no visible database entity or a
//   non-2xx anywhere → throw — a broken read must never silently render as
//   "profile names".
//
//   updateRosterShowRealNames — a thin wrapper (the updateCollectiveName
//   precedent, collectiveName.ts) around the shared replaceEntityProperty
//   choreography, ATOMIC since #264. MANDATORY — a bare POST on every toggle
//   would silently ACCUMULATE duplicate values (Entu POST-appends; all
//   non-formula props are implicitly multi-valued):
//     1. GET entity/{dbEntityId}?props=roster_show_real_names → the
//        pre-existing value id(s);
//     2. POST entity/{dbEntityId} with exactly ONE entry:
//        [{ _id: <first existing id>, type: 'roster_show_real_names',
//           boolean: <value> }] — the `_id` is dropped when no value exists
//        yet (this collective has never been toggled: bare POST);
//     3. corrupted EXTRA ids only → DELETE property/{valueId}, strictly
//        AFTER the POST; the normal ≤1-value path issues ZERO deletes.
//   Non-2xx anywhere → throw (fail loud, no silent success) — turning that
//   into the truthful inline error is the profile page's job.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function callUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0]));
}

function callMethods(fetchImpl: ReturnType<typeof vi.fn>): Array<string | undefined> {
	return fetchImpl.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
}

// ── readRosterNamesSetting ───────────────────────────────────────────────────

describe('readRosterNamesSetting', () => {
	it('resolves the database entity id, then GETs roster_show_real_names off it — two GETs, no writes', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(
				json({
					entity: {
						_id: 'db-entity-1',
						roster_show_real_names: [{ _id: 'bv-1', boolean: true }]
					}
				})
			);

		const result = await readRosterNamesSetting(cfg, fetchImpl);
		expect(result).toEqual({ dbEntityId: 'db-entity-1', showRealNames: true });

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const urls = callUrls(fetchImpl);
		// 1. the id resolve — the databaseEntity.ts query, db-scoped
		expect(urls[0]).toContain('/testdb/entity?');
		expect(urls[0]).toContain('_type.string=database');
		expect(urls[0]).toContain('props=_id');
		expect(urls[0]).toContain('limit=1');
		// 2. the value read — one prop off the resolved entity
		expect(urls[1]).toContain('/testdb/entity/db-entity-1?props=roster_show_real_names');
		for (const method of callMethods(fetchImpl)) {
			expect(method === undefined || method === 'GET').toBe(true);
		}
	});

	it('explicit boolean false → showRealNames false', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(
				json({
					entity: {
						_id: 'db-entity-1',
						roster_show_real_names: [{ _id: 'bv-1', boolean: false }]
					}
				})
			);

		await expect(readRosterNamesSetting(cfg, fetchImpl)).resolves.toEqual({
			dbEntityId: 'db-entity-1',
			showRealNames: false
		});
	});

	it('the key is entirely ABSENT when unset (platform wire shape) → false — never a throw, never true', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(json({ entity: { _id: 'db-entity-1' } }));

		await expect(readRosterNamesSetting(cfg, fetchImpl)).resolves.toEqual({
			dbEntityId: 'db-entity-1',
			showRealNames: false
		});
	});

	it('no visible database entity → throws (fail loud — a broken read must never render as "profile names")', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ entities: [] }));
		await expect(readRosterNamesSetting(cfg, fetchImpl)).rejects.toThrow();
	});

	it('non-2xx on the value read → throws with the status', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
		await expect(readRosterNamesSetting(cfg, fetchImpl)).rejects.toThrow(/403/);
	});

	it('non-2xx on the id resolve → throws with the status', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'down' }, 500));
		await expect(readRosterNamesSetting(cfg, fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── updateRosterShowRealNames ────────────────────────────────────────────────

/** The db entity's aggregated read: ONE pre-existing boolean value — the
 *  normal shape after any earlier toggle. */
function entityWithValue(): Response {
	return json({
		entity: {
			_id: 'db-entity-1',
			roster_show_real_names: [{ _id: 'bv-old', boolean: false }]
		}
	});
}

describe('updateRosterShowRealNames', () => {
	it('#264 atomic overwrite: GET the existing value id → ONE POST pairing it with the new boolean; FULL wire shape, zero deletes on the normal path', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(entityWithValue())
			.mockResolvedValue(json({}));

		await updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl);

		// EXACTLY two calls: lookup + overwrite-POST. A third call would be a
		// delete the ≤1-value path must never issue.
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const urls = callUrls(fetchImpl);
		const methods = callMethods(fetchImpl);

		// 1. the lookup — FIRST: the overwrite entry cannot be built blind
		expect(urls[0]).toContain('/testdb/entity/db-entity-1?props=roster_show_real_names');
		expect(methods[0] === undefined || methods[0] === 'GET').toBe(true);

		// 2. the POST — the old value's `_id` rides the entry (Entu's native
		// overwrite soft-deletes it in the SAME call — a bare POST would
		// silently ACCUMULATE a duplicate value). FULL body shape (toEqual,
		// never objectContaining) — exactly ONE entry, no stray keys.
		expect(urls[1]).toContain('/testdb/entity/db-entity-1');
		expect(methods[1]).toBe('POST');
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ _id: 'bv-old', type: 'roster_show_real_names', boolean: true }]);
	});

	it('no existing value (never toggled) → the POST goes BARE: no `_id`, exactly one entry', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'db-entity-1' } }))
			.mockResolvedValue(json({}));

		await updateRosterShowRealNames(cfg, 'db-entity-1', false, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(callMethods(fetchImpl)[1]).toBe('POST');
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ type: 'roster_show_real_names', boolean: false }]);
	});

	it('corrupted multi-value state: the FIRST id rides the POST; only the phantom EXTRA dies, via the property endpoint, strictly AFTER the POST', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json({
					entity: {
						_id: 'db-entity-1',
						roster_show_real_names: [
							{ _id: 'bv-old', boolean: false },
							{ _id: 'bv-phantom', boolean: true }
						]
					}
				})
			)
			.mockResolvedValue(json({}));

		await updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const urls = callUrls(fetchImpl);
		const methods = callMethods(fetchImpl);
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ _id: 'bv-old', type: 'roster_show_real_names', boolean: true }]);
		expect(urls[2]).toContain('/testdb/property/bv-phantom');
		expect(methods[2]).toBe('DELETE');
	});

	it('a failed POST throws and DELETES NOTHING — the old value must survive a failed write (the page then tells the truth)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(entityWithValue())
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));

		await expect(updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl)).rejects.toThrow(
			/403/
		);
		expect(callMethods(fetchImpl)).not.toContain('DELETE');
	});

	it('a failed lookup throws and POSTS NOTHING (writing blind would guarantee a phantom double-value)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));

		await expect(updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl)).rejects.toThrow(
			/500/
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — #267 RED)
