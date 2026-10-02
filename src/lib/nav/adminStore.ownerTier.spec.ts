// resolveOwnerTier: the owner/editor split behind the roster's invite controls.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import * as adminStoreModule from './adminStore';
import { json, testCfg } from '$lib/testing/entuFetchKit';

type OwnerTier = 'owner' | 'editor' | 'none' | 'error';
type ResolveOwnerTier = (
	cfg: EntuCfg,
	personId: string,
	fetchImpl?: typeof fetch,
	dbEntityId?: string
) => Promise<OwnerTier>;

const resolveOwnerTier = (adminStoreModule as unknown as { resolveOwnerTier?: ResolveOwnerTier })
	.resolveOwnerTier;

const cfg = testCfg('sampledb', 'test-token');
const personId = 'person-123';
const DB_ENTITY = '69c7f8718489bfcb0e81b065';

function mockFetch(opts: {
	database?: unknown;
	databaseStatus?: number;
	entityById?: Record<string, unknown>;
	entityStatus?: number;
}) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=database')) {
			return Promise.resolve(
				json(opts.database ?? { entities: [], count: 0 }, opts.databaseStatus ?? 200)
			);
		}
		const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
		return Promise.resolve(
			json({ entity: opts.entityById?.[id] ?? undefined }, opts.entityStatus ?? 200)
		);
	}) as unknown as typeof fetch;
}

function databaseBody(dbEntityId: string | null) {
	return dbEntityId ? { entities: [{ _id: dbEntityId }], count: 1 } : { entities: [], count: 0 };
}

describe('resolveOwnerTier — owner vs editor on the DATABASE entity', () => {
	it("personId in `_owner` → 'owner' (the probe's 200-mint tier)", async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			entityById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: personId }] } }
		});
		expect(await resolveOwnerTier!(cfg, personId, fetchImpl)).toBe('owner');
	});

	it("personId in `_editor` only → 'editor' (the probe's 403 tier: \"User not in _owner property\")", async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			entityById: { [DB_ENTITY]: { _id: DB_ENTITY, _editor: [{ reference: personId }] } }
		});
		expect(await resolveOwnerTier!(cfg, personId, fetchImpl)).toBe('editor');
	});

	it("personId in BOTH lists → 'owner' — the higher tier wins", async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			entityById: {
				[DB_ENTITY]: {
					_id: DB_ENTITY,
					_owner: [{ reference: personId }],
					_editor: [{ reference: personId }]
				}
			}
		});
		expect(await resolveOwnerTier!(cfg, personId, fetchImpl)).toBe('owner');
	});

	it("personId in neither list → 'none' — a rights ANSWER, read from the entity", async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			entityById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: 'someone-else' }] } }
		});
		expect(await resolveOwnerTier!(cfg, personId, fetchImpl)).toBe('none');
	});

	it("an entity-read HTTP failure → 'error', never a silent 'none'", async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			entityById: {},
			entityStatus: 500
		});
		expect(await resolveOwnerTier!(cfg, personId, fetchImpl)).toBe('error');
	});

	it("no visible database entity → 'error' — no rights were evaluated, so none are claimed", async () => {
		const fetchImpl = mockFetch({ database: databaseBody(null) });
		expect(await resolveOwnerTier!(cfg, personId, fetchImpl)).toBe('error');
	});

	it('a pre-resolved dbEntityId (#173 shape) skips the database lookup round-trip', async () => {
		const fetchImpl = mockFetch({
			entityById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: personId }] } }
		});
		expect(await resolveOwnerTier!(cfg, personId, fetchImpl, DB_ENTITY)).toBe('owner');
		const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
			String(c[0])
		);
		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(false);
	});
});

// (*MVOX:Tallis* — #294 RED: owner-only control gate, probe-observed boundary)
