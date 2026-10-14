// resolveDbEditRight evaluates rights on the database entity, read by id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { dbEditRight, resetDbEditRight, resolveDbEditRight } from './dbRights';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb', 'test-token');
const personId = 'person-123';
const DB_ENTITY = '69c7f8718489bfcb0e81b065';

function mockFetch(opts: {
	database?: unknown;
	databaseStatus?: number;
	orgById?: Record<string, unknown>;
	orgStatus?: number;
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
			json({ entity: opts.orgById?.[id] ?? undefined }, opts.orgStatus ?? 200)
		);
	}) as unknown as typeof fetch;
}

function databaseBody(dbEntityId: string | null) {
	return dbEntityId ? { entities: [{ _id: dbEntityId }], count: 1 } : { entities: [], count: 0 };
}

describe('resolveDbEditRight', () => {
	beforeEach(() => {
		resetDbEditRight();
	});

	it('returns admin when personId is in the DATABASE entity _owner', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: personId }] } }
		});
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('editor');
	});

	it('returns admin when personId is in the DATABASE entity _editor', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY, _editor: [{ reference: personId }] } }
		});
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('editor');
	});

	it('reads rights off the DATABASE entity by id — never an organization search', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: 'someone-else' }] } }
		});
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('not-editor');

		const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
			String(c[0])
		);
		expect(urls.some((u) => u.includes(`/entity/${DB_ENTITY}?props=_owner,_editor`))).toBe(true);
		expect(urls.some((u) => u.includes('_type.string=organization'))).toBe(false);
		expect(urls.some((u) => u.includes('_type.string=member'))).toBe(false);
	});

	it('returns not-admin when personId is absent from the DATABASE entity _owner and _editor', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: 'other' }] } }
		});
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('not-editor');
	});

	it('returns not-admin when _owner and _editor are absent (no rights to see the private bucket)', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY } }
		});
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('not-editor');
	});

	it("returns ERROR (not 'not-editor') when no database entity is visible — an invisible prerequisite is not a rights answer", async () => {
		const fetchImpl = mockFetch({ database: { entities: [], count: 0 } });
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error when the database entity is not readable by id', async () => {
		const fetchImpl = mockFetch({ database: databaseBody(DB_ENTITY), orgById: {} });
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on HTTP failure of the database-entity lookup', async () => {
		const fetchImpl = mockFetch({ databaseStatus: 500 });
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on HTTP failure of the entity read', async () => {
		const fetchImpl = mockFetch({ database: databaseBody(DB_ENTITY), orgStatus: 500 });
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on network exception', async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
		expect(await resolveDbEditRight(cfg, personId, fetchImpl)).toBe('error');
	});
});

describe('dbEditRight', () => {
	it('starts at loading', () => {
		resetDbEditRight();
		expect(get(dbEditRight)).toBe('loading');
	});

	it('resetDbEditRight sets to loading', () => {
		dbEditRight.set('editor');
		resetDbEditRight();
		expect(get(dbEditRight)).toBe('loading');
	});
});
