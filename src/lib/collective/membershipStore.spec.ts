// #255 done-when 6 RED — resolveMembership: the ONE status-UNSCOPED self-lookup
// that can tell "deactivated" apart from "never a member" (findMyMemberId
// returns null for both — rsvpData.ts:45). TRI-STATE FAIL-SAFE VERBATIM: a
// failed lookup resolves 'loading', NEVER 'inactive' — a failed lookup telling
// an active member she has been removed is the worst available outcome.
import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { membershipStore, resetMembership, resolveMembership } from './membershipStore';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('resolveMembership — the status-unscoped self-lookup', () => {
	it('URL: member type + person ref (encoded) + status PROJECTED, and NO status.string FILTER — unscoped is the whole point', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await resolveMembership(cfg, 'person p', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=member');
		expect(url).toContain(`person.reference=${encodeURIComponent('person p')}`);
		expect(url).toContain('status');
		// The one deliberate difference from findMyMemberId: no status filter.
		expect(url).not.toContain('status.string=');
	});

	it("no member row at all → 'non-member' (the existing zero-code degrade keeps covering this case)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await expect(resolveMembership(cfg, 'person-p', fetchImpl)).resolves.toBe('non-member');
	});

	it("an active member row → 'active'", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ _id: 'm1', status: [{ string: 'active' }] }] })
		);
		await expect(resolveMembership(cfg, 'person-p', fetchImpl)).resolves.toBe('active');
	});

	it("a row whose status is off 'active' (archived) → 'inactive' — the state the notice exists for", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ _id: 'm1', status: [{ string: 'archived' }] }] })
		);
		await expect(resolveMembership(cfg, 'person-p', fetchImpl)).resolves.toBe('inactive');
	});

	it("mixed rows where ANY is active → 'active' (an active membership is never overridden by a stale archived row)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'm1', status: [{ string: 'archived' }] },
					{ _id: 'm2', status: [{ string: 'active' }] }
				]
			})
		);
		await expect(resolveMembership(cfg, 'person-p', fetchImpl)).resolves.toBe('active');
	});

	it("a row visible but its status unreadable → 'loading' — never a claim off a half-visible row", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'm1' }] }));
		await expect(resolveMembership(cfg, 'person-p', fetchImpl)).resolves.toBe('loading');
	});

	it("FAIL-SAFE VERBATIM: a non-2xx read RESOLVES 'loading' — never 'inactive', never a rejection the layout has to remember to catch", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(resolveMembership(cfg, 'person-p', fetchImpl)).resolves.toBe('loading');
	});

	it("FAIL-SAFE VERBATIM: a thrown fetch RESOLVES 'loading' too", async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
		await expect(resolveMembership(cfg, 'person-p', fetchImpl)).resolves.toBe('loading');
	});
});

describe('membershipStore / resetMembership', () => {
	it("starts at 'loading' and resetMembership returns it there", () => {
		membershipStore.set('inactive');
		resetMembership();
		expect(get(membershipStore)).toBe('loading');
	});
});

// (*MVOX:Tallis*)
