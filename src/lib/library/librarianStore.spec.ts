// src/lib/library/librarianStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	librarianStore,
	libraryEntityIdStore,
	resetLibrarian,
	resolveLibrarian,
	resolveMyLibraryId
} from './librarianStore';

// #143 review — `resolveLibrarian` now derives the library entity from the
// PERSON'S OWN collective org (mirroring the TU.1/#109 `resolveAdmin` fix)
// instead of `entity?_type.string=library&limit=1`, which live-verifiably picks
// an arbitrary library entity once more than one is visible to a reader. The
// routed mock below stands in for THREE calls: the member lookup
// (`resolveMyOrgId`), the org-scoped library list (`resolveMyLibraryId`), and
// the library GET by id (rights read).

const cfg = { db: 'polyphony', token: 'test-token' };
const personId = 'person-123';
const ORG_EFK = '69c7f8718489bfcb0e81b065';

function json(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body)
	} as unknown as Response;
}

/** An active member row parented to `orgId` (plus a section parent, live shape). */
function memberBody(orgId: string | null) {
	return {
		entities: [
			{
				_id: 'm-1',
				_parent: [
					{ reference: 'sec-sop', entity_type: 'section' },
					...(orgId ? [{ reference: orgId, entity_type: 'organization' }] : [])
				]
			}
		],
		count: 1
	};
}

/** Routed mock: member lookup, then org-scoped library list, then library GET by id. */
function mockFetch(opts: {
	member?: unknown;
	memberStatus?: number;
	libraryByOrg?: unknown;
	libraryByOrgStatus?: number;
	libraryById?: Record<string, unknown>;
	libraryByIdStatus?: number;
}) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=member')) {
			return Promise.resolve(
				json(opts.member ?? { entities: [], count: 0 }, opts.memberStatus ?? 200)
			);
		}
		if (u.includes('_type.string=library')) {
			return Promise.resolve(
				json(opts.libraryByOrg ?? { entities: [] }, opts.libraryByOrgStatus ?? 200)
			);
		}
		// entity/<id>?props=_owner,_editor
		const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
		return Promise.resolve(
			json({ entity: opts.libraryById?.[id] ?? undefined }, opts.libraryByIdStatus ?? 200)
		);
	}) as unknown as typeof fetch;
}

describe('resolveMyLibraryId', () => {
	it('resolves the library scoped to the person\'s own org', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			libraryByOrg: { entities: [{ _id: 'library-1' }] }
		});
		expect(await resolveMyLibraryId(cfg, personId, fetchImpl)).toBe('library-1');

		const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
			String(c[0])
		);
		expect(urls.some((u) => u.includes(`_type.string=library`) && u.includes(`_parent.reference=${ORG_EFK}`))).toBe(
			true
		);
	});

	it('returns null when the person has no visible active membership', async () => {
		const fetchImpl = mockFetch({ member: { entities: [], count: 0 } });
		expect(await resolveMyLibraryId(cfg, personId, fetchImpl)).toBeNull();
	});

	it('returns null when no library entity is parented under the own org', async () => {
		const fetchImpl = mockFetch({ member: memberBody(ORG_EFK), libraryByOrg: { entities: [] } });
		expect(await resolveMyLibraryId(cfg, personId, fetchImpl)).toBeNull();
	});

	// #143 review F4 — a failed read must NEVER be answerable as `null`: that is
	// the same value the genuine "this collective has no library" case returns,
	// and `admin/+page.svelte` branches on `state === 'error'` precisely to keep
	// a transient 500 from rendering as the factual claim "no library here".
	it('THROWS on HTTP failure of the library lookup (never null — null is the "no library" FACT)', async () => {
		const fetchImpl = mockFetch({ member: memberBody(ORG_EFK), libraryByOrgStatus: 500 });
		await expect(resolveMyLibraryId(cfg, personId, fetchImpl)).rejects.toThrow(/HTTP 500/);
	});
});

describe('resolveLibrarian', () => {
	beforeEach(() => {
		resetLibrarian();
	});

	it('returns librarian state and libraryId when personId is in _owner', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			libraryByOrg: { entities: [{ _id: 'library-1' }] },
			libraryById: { 'library-1': { _owner: [{ reference: personId }] } }
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'librarian', libraryId: 'library-1' });
	});

	it('returns librarian state and libraryId when personId is in _editor', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			libraryByOrg: { entities: [{ _id: 'library-1' }] },
			libraryById: { 'library-1': { _editor: [{ reference: personId }] } }
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'librarian', libraryId: 'library-1' });
	});

	it('returns not-librarian with libraryId when personId is absent from _owner and _editor', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			libraryByOrg: { entities: [{ _id: 'library-1' }] },
			libraryById: { 'library-1': { _owner: [{ reference: 'other' }] } }
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'not-librarian', libraryId: 'library-1' });
	});

	it('returns not-librarian with libraryId when _owner and _editor are absent (no rights to see private bucket)', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			libraryByOrg: { entities: [{ _id: 'library-1' }] },
			libraryById: { 'library-1': {} }
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'not-librarian', libraryId: 'library-1' });
	});

	it('returns not-librarian with null libraryId when no library entity is parented under the own org', async () => {
		const fetchImpl = mockFetch({ member: memberBody(ORG_EFK), libraryByOrg: { entities: [] } });
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'not-librarian', libraryId: null });
	});

	it('returns not-librarian with null libraryId when the person has no visible active membership', async () => {
		const fetchImpl = mockFetch({ member: { entities: [], count: 0 } });
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'not-librarian', libraryId: null });
	});

	// #143 review F4 — the regression this pins: a non-2xx on the library LIST
	// used to come back as `not-librarian` (via a `null` libraryId), which
	// `admin/+page.svelte` renders as "this collective has no library" — no
	// error, no retry, `refreshLibrarians` skipped — for a real librarian.
	it('returns error (NOT not-librarian) on HTTP failure of the org-scoped library list', async () => {
		const fetchImpl = mockFetch({ member: memberBody(ORG_EFK), libraryByOrgStatus: 500 });
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'error', libraryId: null });
	});

	it('returns error with null libraryId on HTTP failure of the library rights read', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			libraryByOrg: { entities: [{ _id: 'library-1' }] },
			libraryByIdStatus: 500
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'error', libraryId: null });
	});

	it('returns error with null libraryId when the membership is ambiguous (two active member rows in one db)', async () => {
		const fetchImpl = mockFetch({ member: { ...memberBody(ORG_EFK), count: 2 } });
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'error', libraryId: null });
	});

	it('returns error with null libraryId on network exception', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(
			new Error('network error')
		) as unknown as typeof fetch;
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'error', libraryId: null });
	});
});

describe('librarianStore', () => {
	it('starts at loading', () => {
		resetLibrarian();
		expect(get(librarianStore)).toBe('loading');
	});

	it('resetLibrarian sets to loading and clears libraryEntityIdStore', () => {
		librarianStore.set('librarian');
		libraryEntityIdStore.set('lib-1');
		resetLibrarian();
		expect(get(librarianStore)).toBe('loading');
		expect(get(libraryEntityIdStore)).toBeNull();
	});
});
