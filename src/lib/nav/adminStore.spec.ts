// src/lib/nav/adminStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { adminStore, resetAdmin, resolveAdmin, type AdminState } from './adminStore';

function mockFetch(body: unknown, status = 200): typeof fetch {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	}) as unknown as typeof fetch;
}

const cfg = { db: 'polyphony', token: 'test-token' };
const personId = 'person-123';

describe('resolveAdmin', () => {
	beforeEach(() => {
		resetAdmin();
	});

	it('returns admin when personId is in _owner', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'org-1', _owner: [{ reference: personId }] }],
		});
		const result = await resolveAdmin(cfg, personId, fetchImpl);
		expect(result).toBe('admin');
	});

	it('returns admin when personId is in _editor', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'org-1', _editor: [{ reference: personId }] }],
		});
		const result = await resolveAdmin(cfg, personId, fetchImpl);
		expect(result).toBe('admin');
	});

	it('returns not-admin when personId is absent from _owner and _editor', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'org-1', _owner: [{ reference: 'other' }] }],
		});
		const result = await resolveAdmin(cfg, personId, fetchImpl);
		expect(result).toBe('not-admin');
	});

	it('returns not-admin when _owner and _editor are absent (no rights to see private bucket)', async () => {
		const fetchImpl = mockFetch({
			entities: [{ _id: 'org-1' }],
		});
		const result = await resolveAdmin(cfg, personId, fetchImpl);
		expect(result).toBe('not-admin');
	});

	it('returns not-admin when no organization entity is returned', async () => {
		const fetchImpl = mockFetch({ entities: [] });
		const result = await resolveAdmin(cfg, personId, fetchImpl);
		expect(result).toBe('not-admin');
	});

	it('returns error on HTTP failure', async () => {
		const fetchImpl = mockFetch({}, 500);
		const result = await resolveAdmin(cfg, personId, fetchImpl);
		expect(result).toBe('error');
	});

	it('returns error on network exception', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(
			new Error('network error')
		) as unknown as typeof fetch;
		const result = await resolveAdmin(cfg, personId, fetchImpl);
		expect(result).toBe('error');
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
