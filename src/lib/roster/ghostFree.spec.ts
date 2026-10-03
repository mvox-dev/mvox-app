// Deactivated members drop out of the roster and RSVP reads by status scope.
import { describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { listActiveMembers } from './rosterData';
import { findMyMemberId } from '$lib/rsvp/rsvpData';

const cfg = testCfg('testdb');

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
