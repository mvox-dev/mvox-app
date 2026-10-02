// The library is found as a child of the database entity; librarian status follows.
import { describe, expect, it, vi } from 'vitest';
import { resolveMyLibraryId, resolveLibrarian } from './librarianStore';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');
const PERSON = 'person-ada';
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';
const LIBRARY = 'lib-1';

function makeRouter(opts: { owners?: string[]; editors?: string[] } = {}): {
	fetchImpl: typeof fetch;
	urls: string[];
} {
	const { owners = [], editors = [] } = opts;
	const urls: string[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		urls.push(url);
		if (url.includes('_type.string=database')) {
			return json({ entities: [{ _id: DB_ENTITY }], count: 1 });
		}
		if (url.includes('_type.string=library')) {
			if (!url.includes(`_parent.reference=${DB_ENTITY}`)) {
				return json({ entities: [], count: 0 });
			}
			return json({ entities: [{ _id: LIBRARY }], count: 1 });
		}
		if (url.includes(`entity/${LIBRARY}`)) {
			return json({
				entity: {
					_id: LIBRARY,
					_owner: owners.map((reference) => ({ reference })),
					_editor: editors.map((reference) => ({ reference }))
				}
			});
		}
		return json({ entities: [], count: 0 });
	}) as unknown as typeof fetch;
	return { fetchImpl, urls };
}

describe('resolveMyLibraryId — library scoped to the DATABASE entity (#161)', () => {
	it('takes exactly (cfg, fetchImpl?) — no dead personId slot', () => {
		expect(resolveMyLibraryId.length).toBe(1);
		expect(resolveLibrarian.length).toBe(2);
	});

	it('resolves the database entity, then the library via `_parent.reference=<databaseEntityId>` — no member walk, no organization query', async () => {
		const { fetchImpl, urls } = makeRouter();
		expect(await resolveMyLibraryId(cfg, fetchImpl)).toBe(LIBRARY);

		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(true);
		expect(
			urls.some(
				(u) => u.includes('_type.string=library') && u.includes(`_parent.reference=${DB_ENTITY}`)
			)
		).toBe(true);
		expect(urls.some((u) => u.includes('_type.string=member'))).toBe(false);
		expect(urls.some((u) => u.includes('organization'))).toBe(false);
	});
});

describe('resolveLibrarian — rights still read off the library entity itself (#161: only the SCOPING changed)', () => {
	it("person in the library's _owner → librarian, with the library found under the database entity", async () => {
		const { fetchImpl } = makeRouter({ owners: [PERSON] });
		expect(await resolveLibrarian(cfg, PERSON, fetchImpl)).toEqual({
			state: 'librarian',
			libraryId: LIBRARY
		});
	});

	it('person in neither list → not-librarian (the library itself resolved fine)', async () => {
		const { fetchImpl } = makeRouter({ owners: ['person-else'] });
		expect(await resolveLibrarian(cfg, PERSON, fetchImpl)).toEqual({
			state: 'not-librarian',
			libraryId: LIBRARY
		});
	});
});

// (*MVOX:Tallis* — #161 RED)
