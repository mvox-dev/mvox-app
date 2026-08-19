// src/lib/nav/adminStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { adminStore, resetAdmin, resolveAdmin } from './adminStore';

// #161 (collective = database, Mihkel ruling 2026-08-16) — `resolveAdmin`
// evaluates rights on the DATABASE entity (resolved via
// `resolveDatabaseEntityId`, `_type.string=database&limit=1`), read by id. The
// retired person -> active member row -> organization `_parent` walk is gone
// (#159 deleted every organization instance, so that chain could only ever
// answer wrong or empty).

const cfg = { db: 'polyphony', token: 'test-token' };
const personId = 'person-123';
const DB_ENTITY = '69c7f8718489bfcb0e81b065';

function json(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body)
	} as unknown as Response;
}

/** Routed mock: the database-entity lookup, then the entity GET by id. */
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
		// entity/<id>?props=_owner,_editor
		const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
		return Promise.resolve(
			json({ entity: opts.orgById?.[id] ?? undefined }, opts.orgStatus ?? 200)
		);
	}) as unknown as typeof fetch;
}

/** The database entity lookup response. */
function databaseBody(dbEntityId: string | null) {
	return dbEntityId ? { entities: [{ _id: dbEntityId }], count: 1 } : { entities: [], count: 0 };
}

describe('resolveAdmin', () => {
	beforeEach(() => {
		resetAdmin();
	});

	it('returns admin when personId is in the DATABASE entity _owner', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: personId }] } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('admin');
	});

	it('returns admin when personId is in the DATABASE entity _editor', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY, _editor: [{ reference: personId }] } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('admin');
	});

	it('reads rights off the DATABASE entity by id — never an organization search', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY, _owner: [{ reference: 'someone-else' }] } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('not-admin');

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
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('not-admin');
	});

	it('returns not-admin when _owner and _editor are absent (no rights to see the private bucket)', async () => {
		const fetchImpl = mockFetch({
			database: databaseBody(DB_ENTITY),
			orgById: { [DB_ENTITY]: { _id: DB_ENTITY } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('not-admin');
	});

	it("returns ERROR (not 'not-admin') when no database entity is visible — an invisible prerequisite is not a rights answer", async () => {
		const fetchImpl = mockFetch({ database: { entities: [], count: 0 } });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error when the database entity is not readable by id', async () => {
		const fetchImpl = mockFetch({ database: databaseBody(DB_ENTITY), orgById: {} });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on HTTP failure of the database-entity lookup', async () => {
		const fetchImpl = mockFetch({ databaseStatus: 500 });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on HTTP failure of the entity read', async () => {
		const fetchImpl = mockFetch({ database: databaseBody(DB_ENTITY), orgStatus: 500 });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on network exception', async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});
});

describe('adminStore', () => {
	it('starts at loading', () => {
		resetAdmin();
		expect(get(adminStore)).toBe('loading');
	});

	it('resetAdmin sets to loading', () => {
		adminStore.set('admin');
		resetAdmin();
		expect(get(adminStore)).toBe('loading');
	});
});
