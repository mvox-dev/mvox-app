import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createLending, returnLending, type CreateLendingPayload } from './lendingActions';
import { bulkCheckout, type BulkCheckoutPayload, type BulkResult } from './lendingActions';

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

	it('POST body full-shape has copy/member as reference, assigned_at as date, _parent=libraryId, NO explicit _sharing (#133: inherited from the domain-tier library parent), no assigned_until when absent', async () => {
		const fetchImpl = makeFetchMock('lending-type-42');
		await createLending(cfg, 'library-1', basePayload, fetchImpl);
		const body = createCallBody(fetchImpl);

		expect(body).toEqual(
			expect.arrayContaining([
				{ type: '_type', reference: 'lending-type-42' },
				{ type: '_parent', reference: 'library-1' },
				{ type: 'copy', reference: 'copy-1' },
				{ type: 'member', reference: 'member-1' },
				{ type: 'assigned_at', date: '2026-08-10' }
			])
		);
		expect(body.map((p) => p.type)).not.toContain('assigned_until');
		expect(body.map((p) => p.type)).not.toContain('_sharing');
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

// ── #74 bulkCheckout (edition-first, member-multi) ──────────────────────────

describe('bulkCheckout', () => {
	// Mock copy resolver: returns N copies for a given edition
	function makeResolveCopies(copies: Array<{ id: string }> = [{ id: 'copy-1' }, { id: 'copy-2' }, { id: 'copy-3' }]) {
		return vi.fn().mockResolvedValue(copies);
	}

	function makeFetchMock(opts?: { failMemberIds?: string[] }) {
		const failSet = new Set(opts?.failMemberIds ?? []);
		let callIndex = 0;
		return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			// Type resolution call
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'lending-type-id' }] }));
			}
			// Entity create call — check the body for member reference to determine success/failure
			const body = JSON.parse(String(init?.body)) as Array<{ type: string; reference?: string }>;
			const memberProp = body.find((p) => p.type === 'member');
			if (memberProp && failSet.has(memberProp.reference!)) {
				return Promise.resolve(json({}, 500));
			}
			callIndex++;
			return Promise.resolve(json({ _id: `lend-created-${callIndex}` }));
		});
	}

	const basePayload: BulkCheckoutPayload = {
		editionId: 'edition-1',
		memberIds: ['member-1', 'member-2', 'member-3'],
		assignedAt: '2026-08-10'
	};

	it('all succeed — returns N Lendings in succeeded (one per member), empty failed', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies();
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', basePayload, [], fetchImpl, resolveCopies);

		expect(result.succeeded).toHaveLength(3);
		expect(result.failed).toHaveLength(0);
		expect(result.succeeded.map((l) => l.memberId)).toEqual(['member-1', 'member-2', 'member-3']);
		expect(result.succeeded.every((l) => l.assignedAt === '2026-08-10')).toBe(true);
		// Each lending got a copy from the resolved set
		expect(result.succeeded.map((l) => l.copyId)).toEqual(['copy-1', 'copy-2', 'copy-3']);
	});

	it('resolves copies for the given editionId (not raw copyIds in payload)', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies([{ id: 'copy-a' }, { id: 'copy-b' }]);
		const payload: BulkCheckoutPayload = {
			editionId: 'edition-42',
			memberIds: ['member-1', 'member-2'],
			assignedAt: '2026-08-10'
		};
		await bulkCheckout(cfg, 'library-1', payload, [], fetchImpl, resolveCopies);

		expect(resolveCopies).toHaveBeenCalledWith(cfg, 'edition-42', fetchImpl);
	});

	it('partial failure — some succeed, some fail (errored members end up in failed)', async () => {
		const fetchImpl = makeFetchMock({ failMemberIds: ['member-2'] });
		const resolveCopies = makeResolveCopies();
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', basePayload, [], fetchImpl, resolveCopies);

		expect(result.succeeded).toHaveLength(2);
		expect(result.succeeded.map((l) => l.memberId)).toEqual(['member-1', 'member-3']);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].copyId).toBe('copy-2');
		expect(result.failed[0].error).toBeTruthy();
	});

	it('all fail — empty succeeded, all in failed', async () => {
		const fetchImpl = makeFetchMock({ failMemberIds: ['member-1', 'member-2', 'member-3'] });
		const resolveCopies = makeResolveCopies();
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', basePayload, [], fetchImpl, resolveCopies);

		expect(result.succeeded).toHaveLength(0);
		expect(result.failed).toHaveLength(3);
		expect(result.failed.every((f) => f.error.length > 0)).toBe(true);
	});

	it('each create carries NO explicit _sharing (#133: inherited from the domain-tier library parent — verify via mock inspection)', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies();
		await bulkCheckout(cfg, 'library-1', basePayload, [], fetchImpl, resolveCopies);

		// Filter calls to entity create (not type-resolution)
		const createCalls = (fetchImpl.mock.calls as Array<[string, RequestInit]>).filter(
			([url]) => !url.includes('_type.string=entity')
		);
		expect(createCalls.length).toBe(3);
		for (const [, init] of createCalls) {
			const body = JSON.parse(String(init.body)) as Array<{ type: string; string?: string }>;
			expect(body.map((p) => p.type)).not.toContain('_sharing');
		}
	});

	it('passes assignedUntil through to each individual createLending call', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies();
		await bulkCheckout(cfg, 'library-1', { ...basePayload, assignedUntil: '2026-09-15' }, [], fetchImpl, resolveCopies);

		const createCalls = (fetchImpl.mock.calls as Array<[string, RequestInit]>).filter(
			([url]) => !url.includes('_type.string=entity')
		);
		for (const [, init] of createCalls) {
			const body = JSON.parse(String(init.body)) as Array<{ type: string; date?: string }>;
			expect(body).toEqual(expect.arrayContaining([{ type: 'assigned_until', date: '2026-09-15' }]));
		}
	});

	it('fails excess members when there are fewer copies than members', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies([{ id: 'copy-1' }]); // only 1 copy
		const payload: BulkCheckoutPayload = {
			editionId: 'edition-1',
			memberIds: ['member-1', 'member-2', 'member-3'],
			assignedAt: '2026-08-10'
		};
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', payload, [], fetchImpl, resolveCopies);

		// 1 succeeded (got the copy), 2 failed (no copy available)
		expect(result.succeeded).toHaveLength(1);
		expect(result.failed).toHaveLength(2);
	});

	it('excludes already-lent copies from assignment (double-lend prevention)', async () => {
		const fetchImpl = makeFetchMock();
		// 3 copies resolved, but copy-1 and copy-2 are already on loan
		const resolveCopies = makeResolveCopies([{ id: 'copy-1' }, { id: 'copy-2' }, { id: 'copy-3' }]);
		const activeLendings = [
			{ id: 'lend-existing-1', copyId: 'copy-1', memberId: 'member-x', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-existing-2', copyId: 'copy-2', memberId: 'member-y', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		];
		const payload: BulkCheckoutPayload = {
			editionId: 'edition-1',
			memberIds: ['member-1', 'member-2'],
			assignedAt: '2026-08-10'
		};
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', payload, activeLendings, fetchImpl, resolveCopies);

		// Only copy-3 is available, so 1 succeeds and 1 fails
		expect(result.succeeded).toHaveLength(1);
		expect(result.succeeded[0].copyId).toBe('copy-3');
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].error).toContain('member-2');
	});

	it('reports members already holding a copy of the edition in failed (no silent drop)', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies([{ id: 'copy-1' }, { id: 'copy-2' }, { id: 'copy-3' }]);
		// member-a already holds copy-1 of this edition (active lending)
		const activeLendings = [
			{ id: 'lend-existing', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		];
		const payload: BulkCheckoutPayload = {
			editionId: 'edition-1',
			memberIds: ['member-a', 'member-b'],
			assignedAt: '2026-08-10'
		};
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', payload, activeLendings, fetchImpl, resolveCopies);

		// member-a should be in failed (already holding), member-b should succeed
		expect(result.succeeded).toHaveLength(1);
		expect(result.succeeded[0].memberId).toBe('member-b');
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].error).toContain('member-a');
		expect(result.failed[0].error).toContain('already holds');
	});

	it('reports all already-holding members in failed when multiple members already hold copies', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies([{ id: 'copy-1' }, { id: 'copy-2' }, { id: 'copy-3' }]);
		const activeLendings = [
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' },
			{ id: 'lend-2', copyId: 'copy-2', memberId: 'member-b', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		];
		const payload: BulkCheckoutPayload = {
			editionId: 'edition-1',
			memberIds: ['member-a', 'member-b', 'member-c'],
			assignedAt: '2026-08-10'
		};
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', payload, activeLendings, fetchImpl, resolveCopies);

		expect(result.succeeded).toHaveLength(1);
		expect(result.succeeded[0].memberId).toBe('member-c');
		expect(result.failed).toHaveLength(2);
		const failedErrors = result.failed.map((f) => f.error);
		expect(failedErrors).toEqual(
			expect.arrayContaining([
				expect.stringContaining('member-a'),
				expect.stringContaining('member-b')
			])
		);
	});

	it('does not double-count a member who already holds AND has no copy available', async () => {
		const fetchImpl = makeFetchMock();
		// Only 1 copy, and it's already held by member-a
		const resolveCopies = makeResolveCopies([{ id: 'copy-1' }]);
		const activeLendings = [
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		];
		const payload: BulkCheckoutPayload = {
			editionId: 'edition-1',
			memberIds: ['member-a', 'member-b'],
			assignedAt: '2026-08-10'
		};
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', payload, activeLendings, fetchImpl, resolveCopies);

		// member-a: already holding (failed), member-b: no available copy (failed)
		expect(result.succeeded).toHaveLength(0);
		expect(result.failed).toHaveLength(2);
		expect(result.failed.find((f) => f.error.includes('member-a'))?.error).toContain('already holds');
		expect(result.failed.find((f) => f.error.includes('member-b'))?.error).toContain('No available copy');
	});

	it('ignores returned lendings when filtering available copies', async () => {
		const fetchImpl = makeFetchMock();
		const resolveCopies = makeResolveCopies([{ id: 'copy-1' }, { id: 'copy-2' }]);
		const activeLendings = [
			// copy-1 was returned, so it IS available
			{ id: 'lend-returned', copyId: 'copy-1', memberId: 'member-x', assignedAt: '2026-07-01', assignedUntil: '', returnedAt: '2026-07-15' },
			// copy-2 is still out, NOT available
			{ id: 'lend-active', copyId: 'copy-2', memberId: 'member-y', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		];
		const payload: BulkCheckoutPayload = {
			editionId: 'edition-1',
			memberIds: ['member-1'],
			assignedAt: '2026-08-10'
		};
		const result: BulkResult = await bulkCheckout(cfg, 'library-1', payload, activeLendings, fetchImpl, resolveCopies);

		expect(result.succeeded).toHaveLength(1);
		expect(result.succeeded[0].copyId).toBe('copy-1');
		expect(result.failed).toHaveLength(0);
	});
});

