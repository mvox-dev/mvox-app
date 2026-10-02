// resolveMembership never reports inactive from a partial page of member rows.
import { describe, expect, it, vi } from 'vitest';
import { resolveMembership } from './membershipStore';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

describe('resolveMembership — a partial page never grounds a negative claim (#321)', () => {
	it("TRUNCATED page, no active row visible → 'loading' (never 'inactive' off a partial list)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 60,
				entities: [
					{ status: [{ string: 'archived' }] },
					{ status: [{ string: 'archived' }] }
				]
			})
		);
		expect(await resolveMembership(cfg, 'person-1', fetchImpl)).toBe('loading');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("TRUNCATED page with an active row IN the page → 'active' (positive evidence stands)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 60,
				entities: [{ status: [{ string: 'archived' }] }, { status: [{ string: 'active' }] }]
			})
		);
		expect(await resolveMembership(cfg, 'person-1', fetchImpl)).toBe('active');
	});

	it("count > 0 with an EMPTY entities page → 'loading', never 'non-member' (rows exist that this page did not carry)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ count: 3, entities: [] }));
		expect(await resolveMembership(cfg, 'person-1', fetchImpl)).toBe('loading');
	});

	it("COMPLETE page (count === entities.length), none active → 'inactive' (today's classification unchanged)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ count: 2, entities: [{ status: [{ string: 'archived' }] }, { status: [{ string: 'archived' }] }] })
		);
		expect(await resolveMembership(cfg, 'person-1', fetchImpl)).toBe('inactive');
	});

	it("COMPLETE empty page (count 0) → 'non-member' (unchanged)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ count: 0, entities: [] }));
		expect(await resolveMembership(cfg, 'person-1', fetchImpl)).toBe('non-member');
	});

	it("a body without count keeps today's behaviour byte-for-byte ('inactive' when rows visible, none active)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ status: [{ string: 'archived' }] }] })
		);
		expect(await resolveMembership(cfg, 'person-1', fetchImpl)).toBe('inactive');
	});
});

// (*MVOX:Tallis* — RED spec, #321)
