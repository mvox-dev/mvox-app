import { describe, expect, it, vi } from 'vitest';
import { resolveMyLibraryId, resolveLibrarian } from './librarianStore';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// #161 RED — collective = database: the library entity is found as a child of
// the DATABASE entity (`_type.string=library&_parent.reference=<databaseEntityId>`),
// never via the retired person → member → organization walk (`resolveMyOrgId`;
// #159 deleted every organization instance, so the old chain answers null and
// every librarian would read as not-librarian).
//
// #161 review fix round 2 — `resolveMyLibraryId` is `(cfg, fetchImpl?)`: the
// lookup is entirely db-scoped and never read the person. `resolveLibrarian`
// keeps `(cfg, personId, fetchImpl?)` — personId is what the library's
// `_owner`/`_editor` lists are matched against there.

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const PERSON = 'person-ada';
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';
const LIBRARY = 'lib-1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

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
			// Only a DATABASE-scoped library lookup finds the library.
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
		// The retired member/organization walk lands here — empty, never useful.
		return json({ entities: [], count: 0 });
	}) as unknown as typeof fetch;
	return { fetchImpl, urls };
}

describe('resolveMyLibraryId — library scoped to the DATABASE entity (#161)', () => {
	// #161 review fix round 2 — arity guard. A dead `personId` in position 2 of 3
	// meant a caller that correctly dropped it slid `fetchImpl` into the person
	// slot and silently fell back to the global `fetch`. Pin the shape.
	it('takes exactly (cfg, fetchImpl?) — no dead personId slot', () => {
		expect(resolveMyLibraryId.length).toBe(1);
		// `resolveLibrarian` genuinely needs the person (rights match), so it keeps it.
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
