// resolveAdmin skips the database lookup when given its id.
import { describe, it, expect, vi } from 'vitest';
import { resolveAdmin as resolveAdminActual, type AdminState } from './adminStore';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { json } from '$lib/testing/entuFetchKit';

type ResolveAdminPreResolved = (
	cfg: EntuCfg,
	personId: string,
	fetchImpl?: typeof fetch,
	dbEntityId?: string
) => Promise<AdminState>;
const resolveAdmin = resolveAdminActual as ResolveAdminPreResolved;

const cfg = { db: 'sampledb', token: 'test-token' };
const personId = 'person-123';
const DB_ENTITY = '69c7f8718489bfcb0e81b065';

function mockFetch(rights: { _owner?: unknown[]; _editor?: unknown[] }) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }], count: 1 }));
		}
		return Promise.resolve(json({ entity: { _id: DB_ENTITY, ...rights } }));
	}) as unknown as typeof fetch;
}

function calledUrls(fetchImpl: typeof fetch): string[] {
	return (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
		String(c[0])
	);
}

describe('resolveAdmin with a pre-resolved dbEntityId (#173)', () => {
	it('skips the database-entity lookup — NO _type.string=database query on the wire', async () => {
		const fetchImpl = mockFetch({ _owner: [{ reference: personId }] });

		const state = await resolveAdmin(cfg, personId, fetchImpl, DB_ENTITY);

		expect(state).toBe('admin');
		const urls = calledUrls(fetchImpl);
		expect(urls.filter((u) => u.includes('_type.string=database'))).toEqual([]);
	});

	it('reads rights off the PROVIDED id in a single round-trip', async () => {
		const fetchImpl = mockFetch({ _editor: [{ reference: personId }] });

		const state = await resolveAdmin(cfg, personId, fetchImpl, DB_ENTITY);

		expect(state).toBe('admin');
		const urls = calledUrls(fetchImpl);
		expect(urls).toHaveLength(1);
		expect(urls[0]).toContain(`/entity/${DB_ENTITY}`);
		expect(urls[0]).toContain('props=_owner');
	});

	it('still answers not-admin from the provided id when the person is in neither list', async () => {
		const fetchImpl = mockFetch({ _owner: [{ reference: 'someone-else' }] });

		const state = await resolveAdmin(cfg, personId, fetchImpl, DB_ENTITY);

		expect(state).toBe('not-admin');
		expect(calledUrls(fetchImpl)).toHaveLength(1);
	});
});

// (*MVOX:Tallis* — #173 RED)
