import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createLending, returnLending, type CreateLendingPayload } from './lendingActions';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── createLending ───────────────────────────────────────────────────────────

describe('createLending', () => {
	/** Type-resolution GET (`_type.string=entity`) + entity-create POST. */
	function makeFetchMock(resolvedTypeId = 'lending-type-id', createdId = 'lend-new-1') {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: resolvedTypeId }] }));
			}
			return Promise.resolve(json({ _id: createdId }));
		});
	}

	function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
		const call = (fetchImpl.mock.calls as Array<[string, RequestInit]>).find(
			([url]) => !url.includes('_type.string=entity')
		)!;
		return JSON.parse(String(call[1].body)) as Array<{ type: string; reference?: string; string?: string; date?: string }>;
	}

	const basePayload: CreateLendingPayload = {
		copyId: 'copy-1',
		memberId: 'member-1',
		assignedAt: '2026-08-10'
	};

	it('POST body full-shape has copy/member as reference, assigned_at as date, _parent=libraryId, _sharing=domain (no assigned_until when absent)', async () => {
		const fetchImpl = makeFetchMock('lending-type-42');
		await createLending(cfg, 'library-1', basePayload, fetchImpl);
		const body = createCallBody(fetchImpl);

		expect(body).toEqual(
			expect.arrayContaining([
				{ type: '_type', reference: 'lending-type-42' },
				{ type: '_parent', reference: 'library-1' },
				{ type: 'copy', reference: 'copy-1' },
				{ type: 'member', reference: 'member-1' },
				{ type: 'assigned_at', date: '2026-08-10' },
				{ type: '_sharing', string: 'domain' }
			])
		);
		expect(body.map((p) => p.type)).not.toContain('assigned_until');
	});

	it('returns the created Lending, mapping the POST response onto the Lending shape', async () => {
		const fetchImpl = makeFetchMock('lending-type-id', 'lend-created-9');
		const result = await createLending(cfg, 'library-1', basePayload, fetchImpl);
		expect(result).toEqual({
			id: 'lend-created-9',
			copyId: 'copy-1',
			memberId: 'member-1',
			assignedAt: '2026-08-10',
			assignedUntil: '',
			returnedAt: ''
		});
	});

	it('includes assigned_until in the POST body when provided', async () => {
		const fetchImpl = makeFetchMock();
		await createLending(cfg, 'library-1', { ...basePayload, assignedUntil: '2026-09-01' }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body).toEqual(expect.arrayContaining([{ type: 'assigned_until', date: '2026-09-01' }]));
	});

	it('the returned Lending carries assignedUntil when provided', async () => {
		const fetchImpl = makeFetchMock('lending-type-id', 'lend-created-9');
		const result = await createLending(cfg, 'library-1', { ...basePayload, assignedUntil: '2026-09-01' }, fetchImpl);
		expect(result.assignedUntil).toBe('2026-09-01');
	});

	it('omits assigned_until from the POST body when not provided', async () => {
		const fetchImpl = makeFetchMock();
		await createLending(cfg, 'library-1', basePayload, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body.map((p) => p.type)).not.toContain('assigned_until');
	});

	it('throws on HTTP error from the create POST', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'lending-type-id' }] }));
			}
			return Promise.resolve(json({}, 500));
		});
		await expect(createLending(cfg, 'library-1', basePayload, fetchImpl)).rejects.toThrow(/500/);
	});

	it('throws on network exception', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'lending-type-id' }] }));
			}
			return Promise.reject(new Error('network error'));
		});
		await expect(createLending(cfg, 'library-1', basePayload, fetchImpl)).rejects.toThrow('network error');
	});
});

// ── returnLending ─────────────────────────────────────────────────────────────

describe('returnLending', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-10T12:34:56Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('POSTs to the lending entity with returned_at set to today (date-only)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await returnLending(cfg, 'lend-1', fetchImpl);

		const call = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(String(call[0])).toContain('entity/lend-1');
		expect(call[1].method).toBe('POST');
		const body = JSON.parse(String(call[1].body)) as Array<{ type: string; date?: string }>;
		expect(body).toEqual([{ type: 'returned_at', date: '2026-08-10' }]);
	});

	it('throws on HTTP error', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(returnLending(cfg, 'lend-1', fetchImpl)).rejects.toThrow(/500/);
	});

	it('throws on network exception', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));
		await expect(returnLending(cfg, 'lend-1', fetchImpl)).rejects.toThrow('network error');
	});
});
