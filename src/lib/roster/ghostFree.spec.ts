// #255 done-when 2 — GHOST-FREE VERIFY (guard pins). The census (issue #255,
// Palestrina's table) confirmed the two member-resolution reads are already
// status-scoped, so a deactivated member drops out of the roster and out of
// RSVP eligibility for free. These pins exist so THAT property is named and
// nailed: the day someone widens either query, this file says why it was
// narrow. (Guard tests — they pass today by design; the RED signal for #255
// lives in the sibling specs.)
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { listActiveMembers } from './rosterData';
import { findMyMemberId } from '$lib/rsvp/rsvpData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('done-when 2 — active-scoped reads drop a deactivated member for free', () => {
	it('ROSTER: listActiveMembers filters status.string=active on the wire — an archived member never reaches the roster', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listActiveMembers(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=member');
		expect(url).toContain('status.string=active');
	});

	it("RSVP ELIGIBILITY: findMyMemberId filters status.string=active — a deactivated viewer resolves null and the existing non-member degrade fires", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		const id = await findMyMemberId(cfg, 'person-deactivated', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('status.string=active');
		expect(id).toBeNull();
	});
});

// (*MVOX:Tallis*)
