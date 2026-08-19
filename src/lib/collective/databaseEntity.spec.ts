import { describe, expect, it, vi } from 'vitest';
import { DatabaseEntityLookupError, resolveDatabaseEntityId } from './databaseEntity';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// #161 RED — collective = database (Mihkel ruling 2026-08-16, via Henry).
//
// The core resolution of "which entity is THIS collective" must return the
// DATABASE entity id, discovered via `entity?_type.string=database&limit=1`
// (exactly one per db, guaranteed by entu). The old person → member →
// `_parent[entity_type=organization]` chain (`resolveMyOrgId`, $lib/org/myOrg)
// is retired — #159 deleted every organization instance, so that chain can only
// answer wrong or empty.

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // database entity id (live shape)

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('resolveDatabaseEntityId', () => {
	it('resolves via `_type.string=database&limit=1` and returns the database entity _id — no personId, no member-row walk, no organization query', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: DB_ENTITY }], count: 1 }));
		const id = await resolveDatabaseEntityId(cfg, fetchImpl);
		expect(id).toBe(DB_ENTITY);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('/polyphony/entity?_type.string=database');
		expect(url).toContain('limit=1');
		expect(url).not.toContain('_type.string=member');
		expect(url).not.toContain('organization');
	});

	it('returns null when no database entity is readable (an answer — "this reader cannot see the collective" — never a guess)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [], count: 0 }));
		expect(await resolveDatabaseEntityId(cfg, fetchImpl)).toBeNull();
	});

	it('fails loud on a non-2xx with DatabaseEntityLookupError naming the status and the db', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 503));
		const err = await resolveDatabaseEntityId(cfg, fetchImpl).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(DatabaseEntityLookupError);
		expect((err as DatabaseEntityLookupError).status).toBe(503);
		expect((err as Error).message).toMatch(/503/);
		expect((err as Error).message).toMatch(/polyphony/);
	});

	it('fails loud when the 2xx entity carries no _id (apparent-success trap — same guard as inviteData.resolvePersonParentId)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{}], count: 1 }));
		await expect(resolveDatabaseEntityId(cfg, fetchImpl)).rejects.toBeInstanceOf(
			DatabaseEntityLookupError
		);
	});

	it('asks Entu for `props=_id` — the resolve needs the id only, never the full entity body (#161 review fix)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: DB_ENTITY }], count: 1 }));
		await resolveDatabaseEntityId(cfg, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		// Same shape resolveTypeId already uses: without the props filter every
		// property of the database entity (rights arrays included) rides along on
		// a lookup that only ever reads `_id`.
		expect(url).toContain('props=_id');
	});

	it('issues ONE GET per call — no module-level cache (cfg.db varies between calls; each db resolves its own entity)', async () => {
		const fetchA = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'db-a' }], count: 1 }));
		const fetchB = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'db-b' }], count: 1 }));

		expect(await resolveDatabaseEntityId({ db: 'alpha', token: 't' }, fetchA)).toBe('db-a');
		expect(await resolveDatabaseEntityId({ db: 'beta', token: 't' }, fetchB)).toBe('db-b');

		expect(fetchA).toHaveBeenCalledTimes(1);
		expect(fetchB).toHaveBeenCalledTimes(1);
		expect(String(fetchA.mock.calls[0][0])).toContain('/alpha/entity?');
		expect(String(fetchB.mock.calls[0][0])).toContain('/beta/entity?');
	});
});

// (*MVOX:Tallis* — #161 RED)
