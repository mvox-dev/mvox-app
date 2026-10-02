// resolveMyLibraryId and resolveLibrarian skip the database lookup when given its id.
import { describe, it, expect, vi } from 'vitest';
import {
	resolveMyLibraryId as resolveMyLibraryIdActual,
	resolveLibrarian as resolveLibrarianActual,
	type LibrarianResult
} from './librarianStore';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { json } from '$lib/testing/entuFetchKit';

type ResolveMyLibraryIdPreResolved = (
	cfg: EntuCfg,
	fetchImpl?: typeof fetch,
	dbEntityId?: string
) => Promise<string | null>;
type ResolveLibrarianPreResolved = (
	cfg: EntuCfg,
	personId: string,
	fetchImpl?: typeof fetch,
	dbEntityId?: string
) => Promise<LibrarianResult>;
const resolveMyLibraryId = resolveMyLibraryIdActual as ResolveMyLibraryIdPreResolved;
const resolveLibrarian = resolveLibrarianActual as ResolveLibrarianPreResolved;

const cfg = { db: 'sampledb', token: 'test-token' };
const personId = 'person-123';
const DB_ENTITY = '69c7f8718489bfcb0e81b065';
const LIBRARY_ID = 'lib-entity-1';

function mockFetch(opts: { libraryHit?: boolean; libraryRights?: unknown } = {}) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }], count: 1 }));
		}
		if (u.includes('_type.string=library')) {
			return Promise.resolve(
				json(opts.libraryHit ? { entities: [{ _id: LIBRARY_ID }] } : { entities: [] })
			);
		}
		return Promise.resolve(json({ entity: opts.libraryRights ?? { _id: LIBRARY_ID } }));
	}) as unknown as typeof fetch;
}

function calledUrls(fetchImpl: typeof fetch): string[] {
	return (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
		String(c[0])
	);
}

describe('resolveMyLibraryId with a pre-resolved dbEntityId (#173)', () => {
	it('skips the database-entity lookup — NO _type.string=database query on the wire', async () => {
		const fetchImpl = mockFetch({ libraryHit: true });

		const libraryId = await resolveMyLibraryId(cfg, fetchImpl, DB_ENTITY);

		expect(libraryId).toBe(LIBRARY_ID);
		const urls = calledUrls(fetchImpl);
		expect(urls.filter((u) => u.includes('_type.string=database'))).toEqual([]);
	});

	it('scopes the library search to the PROVIDED id in a single round-trip', async () => {
		const fetchImpl = mockFetch({ libraryHit: true });

		await resolveMyLibraryId(cfg, fetchImpl, DB_ENTITY);

		const urls = calledUrls(fetchImpl);
		expect(urls).toHaveLength(1);
		expect(urls[0]).toContain('_type.string=library');
		expect(urls[0]).toContain(`_parent.reference=${DB_ENTITY}`);
	});
});

describe('resolveLibrarian with a pre-resolved dbEntityId (#173)', () => {
	it('resolves librarian state without any _type.string=database query', async () => {
		const fetchImpl = mockFetch({
			libraryHit: true,
			libraryRights: { _id: LIBRARY_ID, _editor: [{ reference: personId }] }
		});

		const result = await resolveLibrarian(cfg, personId, fetchImpl, DB_ENTITY);

		expect(result).toEqual({ state: 'librarian', libraryId: LIBRARY_ID });
		const urls = calledUrls(fetchImpl);
		expect(urls.filter((u) => u.includes('_type.string=database'))).toEqual([]);
		expect(urls).toHaveLength(2);
	});

	it('answers the factual not-librarian (no library under the provided id) in ONE round-trip', async () => {
		const fetchImpl = mockFetch({ libraryHit: false });

		const result = await resolveLibrarian(cfg, personId, fetchImpl, DB_ENTITY);

		expect(result).toEqual({ state: 'not-librarian', libraryId: null });
		expect(calledUrls(fetchImpl)).toHaveLength(1);
	});
});

// (*MVOX:Tallis* — #173 RED)
