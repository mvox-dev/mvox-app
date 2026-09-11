// #321 RED — the membership-churn read (`_type.string=member&person.reference=
// {me}&props=status&limit=50`, status-UNSCOPED so it spans a person's whole
// rejoin history — research-321 inv: bound is per-person churn count, and the
// seed table missed the site entirely).
//
// This read renders no list either — its surface is the tri-state membership
// banner, and the module's own binding already forbids false claims ("a FAILED
// lookup must NEVER produce 'inactive'"). So the class-(2) treatment here IS
// the tri-state rule extended to partial pages — the narrowed truth this spec
// pins instead of a DOM notice:
//
//   - a TRUNCATED page (server `count` > entities.length) with NO active row
//     visible proves nothing about the rows beyond the cap — the missing row
//     could be the active one. Classifying 'inactive' (or 'non-member') off it
//     is exactly the false claim the module forbids → resolve 'loading'.
//   - an active row IN the visible page is positive evidence and stands:
//     'active', truncated or not (an active membership is never overridden).
//   - a COMPLETE page keeps today's classification unchanged.
//
// Return type stays `MembershipState` — no shape change; the count is consumed
// internally on the same single request.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { resolveMembership } from './membershipStore';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

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
