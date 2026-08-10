// src/lib/library/librarianStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { librarianStore, libraryEntityIdStore, resetLibrarian, resolveLibrarian, type LibrarianState } from './librarianStore';

function mockFetch(body: unknown, status = 200): typeof fetch {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	}) as unknown as typeof fetch;
}

const cfg = { db: 'polyphony', token: 'test-token' };
const personId = 'person-123';

describe('resolveLibrarian', () => {
	beforeEach(() => {
		resetLibrarian();
	});

	it('returns librarian state and libraryId when personId is in _owner', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1', _owner: [{ reference: personId }] }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'librarian', libraryId: 'library-1' });
	});

	it('returns librarian state and libraryId when personId is in _editor', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1', _editor: [{ reference: personId }] }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'librarian', libraryId: 'library-1' });
	});

	it('returns not-librarian with libraryId when personId is absent from _owner and _editor', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1', _owner: [{ reference: 'other' }] }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'not-librarian', libraryId: 'library-1' });
	});

	it('returns not-librarian with libraryId when _owner and _editor are absent (no rights to see private bucket)', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1' }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'not-librarian', libraryId: 'library-1' });
	});

	it('returns not-librarian with null libraryId when no library entity is returned', async () => {
		const fetchImpl = mockFetch({ entities: [] });
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toEqual({ state: 'not-librarian', libraryId: null });
	});

	it('returns error with null libraryId on HTTP failure', async () => {
		const fetchImpl = mockFetch({}, 500);
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
