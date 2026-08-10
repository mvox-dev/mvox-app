import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createLending, returnLending, type CreateLendingPayload } from './lendingActions';
import { bulkCheckout, bulkReturn, type BulkCheckoutPayload, type BulkResult, type BulkReturnResult } from './lendingActions';

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

// ── #74 bulkCheckout ─────────────────────────────────────────────────────────

describe('bulkCheckout', () => {
	function makeFetchMock(opts?: { failCopyIds?: string[] }) {
		const failSet = new Set(opts?.failCopyIds ?? []);
		let callIndex = 0;
		return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			// Type resolution call
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'lending-type-id' }] }));
			}
			// Entity create call — check the body for copy reference to determine success/failure
			const body = JSON.parse(String(init?.body)) as Array<{ type: string; reference?: string }>;
			const copyProp = body.find((p) => p.type === 'copy');
			if (copyProp && failSet.has(copyProp.reference!)) {
				return Promise.resolve(json({}, 500));
			}
			callIndex++;
			return Promise.resolve(json({ _id: `lend-created-${callIndex}` }));
		});
	}

	const basePayload: BulkCheckoutPayload = {
		copyIds: ['copy-1', 'copy-2', 'copy-3'],
		memberId: 'member-1',
		assignedAt: '2026-08-10'
	};

	it('all succeed — returns N Lendings in succeeded, empty failed', async () => {
		const fetchImpl = makeFetchMock();
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', basePayload, fetchImpl);

		expect(result.succeeded).toHaveLength(3);
		expect(result.failed).toHaveLength(0);
		expect(result.succeeded.map((l) => l.copyId)).toEqual(['copy-1', 'copy-2', 'copy-3']);
		expect(result.succeeded.every((l) => l.memberId === 'member-1')).toBe(true);
		expect(result.succeeded.every((l) => l.assignedAt === '2026-08-10')).toBe(true);
	});

	it('partial failure — some succeed, some fail (errored copyIds end up in failed)', async () => {
		const fetchImpl = makeFetchMock({ failCopyIds: ['copy-2'] });
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', basePayload, fetchImpl);

		expect(result.succeeded).toHaveLength(2);
		expect(result.succeeded.map((l) => l.copyId)).toEqual(['copy-1', 'copy-3']);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].copyId).toBe('copy-2');
		expect(result.failed[0].error).toBeTruthy();
	});

	it('all fail — empty succeeded, all in failed', async () => {
		const fetchImpl = makeFetchMock({ failCopyIds: ['copy-1', 'copy-2', 'copy-3'] });
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', basePayload, fetchImpl);

		expect(result.succeeded).toHaveLength(0);
		expect(result.failed).toHaveLength(3);
		expect(result.failed.map((f) => f.copyId).sort()).toEqual(['copy-1', 'copy-2', 'copy-3']);
		expect(result.failed.every((f) => f.error.length > 0)).toBe(true);
	});

	it('each create carries explicit _sharing (verify via mock inspection)', async () => {
		const fetchImpl = makeFetchMock();
		await bulkCheckout(cfg, 'library-1', basePayload, fetchImpl);

		// Filter calls to entity create (not type-resolution)
		const createCalls = (fetchImpl.mock.calls as Array<[string, RequestInit]>).filter(
			([url]) => !url.includes('_type.string=entity')
		);
		expect(createCalls.length).toBe(3);
		for (const [, init] of createCalls) {
			const body = JSON.parse(String(init.body)) as Array<{ type: string; string?: string }>;
			expect(body).toEqual(expect.arrayContaining([{ type: '_sharing', string: 'domain' }]));
		}
	});

	it('passes assignedUntil through to each individual createLending call', async () => {
		const fetchImpl = makeFetchMock();
		await bulkCheckout(cfg, 'library-1', { ...basePayload, assignedUntil: '2026-09-15' }, fetchImpl);

		const createCalls = (fetchImpl.mock.calls as Array<[string, RequestInit]>).filter(
			([url]) => !url.includes('_type.string=entity')
		);
		for (const [, init] of createCalls) {
			const body = JSON.parse(String(init.body)) as Array<{ type: string; date?: string }>;
			expect(body).toEqual(expect.arrayContaining([{ type: 'assigned_until', date: '2026-09-15' }]));
		}
	});
});

// ── #74 bulkReturn ───────────────────────────────────────────────────────────

describe('bulkReturn', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-10T12:34:56Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('all succeed — all IDs in succeeded, empty failed', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		const result: BulkReturnResult = await bulkReturn(cfg, ['lend-1', 'lend-2', 'lend-3'], fetchImpl);

		expect(result.succeeded).toEqual(['lend-1', 'lend-2', 'lend-3']);
		expect(result.failed).toHaveLength(0);
	});

	it('partial failure — some in succeeded, some in failed', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('entity/lend-2')) {
				return Promise.resolve(json({}, 500));
			}
			return Promise.resolve(json({}));
		});
		const result: BulkReturnResult = await bulkReturn(cfg, ['lend-1', 'lend-2', 'lend-3'], fetchImpl);

		expect(result.succeeded).toEqual(['lend-1', 'lend-3']);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].lendingId).toBe('lend-2');
		expect(result.failed[0].error).toBeTruthy();
	});

	it('all fail — empty succeeded, all in failed', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		const result: BulkReturnResult = await bulkReturn(cfg, ['lend-1', 'lend-2', 'lend-3'], fetchImpl);

		expect(result.succeeded).toHaveLength(0);
		expect(result.failed).toHaveLength(3);
		expect(result.failed.map((f) => f.lendingId).sort()).toEqual(['lend-1', 'lend-2', 'lend-3']);
		expect(result.failed.every((f) => f.error.length > 0)).toBe(true);
	});
});
