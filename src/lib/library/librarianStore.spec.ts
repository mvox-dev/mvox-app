// src/lib/library/librarianStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { librarianStore, resetLibrarian, resolveLibrarian, type LibrarianState } from './librarianStore';

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

	it('returns librarian when personId is in _owner', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1', _owner: [{ reference: personId }] }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toBe('librarian');
	});

	it('returns librarian when personId is in _editor', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1', _editor: [{ reference: personId }] }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toBe('librarian');
	});

	it('returns not-librarian when personId is absent from _owner and _editor', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1', _owner: [{ reference: 'other' }] }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toBe('not-librarian');
	});

	it('returns not-librarian when _owner and _editor are absent (no rights to see private bucket)', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'library-1' }],
		});
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toBe('not-librarian');
	});

	it('returns not-librarian when no library entity is returned', async () => {
		const fetchImpl = mockFetch({ entities: [] });
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toBe('not-librarian');
	});

	it('returns error on HTTP failure', async () => {
		const fetchImpl = mockFetch({}, 500);
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toBe('error');
	});

	it('returns error on network exception', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(
			new Error('network error')
		) as unknown as typeof fetch;
		const result = await resolveLibrarian(cfg, personId, fetchImpl);
		expect(result).toBe('error');
	});
});

describe('librarianStore', () => {
	it('starts at loading', () => {
		resetLibrarian();
		expect(get(librarianStore)).toBe('loading');
	});

	it('resetLibrarian sets to loading', () => {
		librarianStore.set('librarian');
		resetLibrarian();
		expect(get(librarianStore)).toBe('loading');
	});
});
