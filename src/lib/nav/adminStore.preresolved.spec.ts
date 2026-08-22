// src/lib/nav/adminStore.preresolved.spec.ts
//
// #173 RED — reduce admin page lookups: `resolveAdmin` must accept a
// PRE-RESOLVED database entity id and, when one is provided, skip its internal
// `resolveDatabaseEntityId` round-trip entirely.
//
// WHY: the /admin page load currently resolves the database entity THREE times
// (page direct + inside resolveAdmin + inside resolveLibrarian). The id is
// db-scoped and constant for the load — resolving it once and threading it
// through is pure round-trip removal, no behavior change.
//
// Pinned contract (GREEN must implement):
//   resolveAdmin(cfg, personId, fetchImpl?, dbEntityId?)
//   - 4th param OPTIONAL — omitted, behavior is IDENTICAL to today (the
//     existing adminStore.spec.ts pins that path; this file does not re-pin it).
//   - Provided, resolveAdmin makes NO `_type.string=database` query: the ONLY
//     wire traffic is the rights read `entity/{dbEntityId}?props=_owner,_editor`
//     against the PROVIDED id.
//   - The rights answer ('admin' / 'not-admin') is computed exactly as before.
import { describe, it, expect, vi } from 'vitest';
import { resolveAdmin as resolveAdminActual, type AdminState } from './adminStore';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// The #173 target signature. Cast (rather than raw extra-arg call) so this
// spec is typecheck-clean in RED; the runtime assertions below do the failing.
type ResolveAdminPreResolved = (
	cfg: EntuCfg,
	personId: string,
	fetchImpl?: typeof fetch,
	dbEntityId?: string
) => Promise<AdminState>;
const resolveAdmin = resolveAdminActual as ResolveAdminPreResolved;

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

/** Routed stub: serves BOTH the database lookup (so a leftover internal
 *  resolution still completes and the spec fails on the COUNT assertions, not
 *  on a broken flow) and the rights read by id. */
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
		// ONE wire call total: the rights read against the pre-resolved id.
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
