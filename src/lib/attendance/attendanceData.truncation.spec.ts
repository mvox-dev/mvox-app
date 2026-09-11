// #321 RED — truncation detection for `listMyAttendance`, the member-LIFETIME
// attendance read (`member.reference={memberId}&limit=500`, no season
// boundary) — same reachable-bound class as `listMyRsvps` (research-321 inv:
// grows with tenure, not with choir size).
//
// Contract identical to libraryData.truncation.spec.ts / rsvpData
// counterpart: `{ items, total, truncated }`, `truncated` = server `count` >
// RAW entities.length on the SAME single request. The RAW-length rule matters
// doubly here: this module DROPS half-visible rows (missing `_parent`/status —
// the #84-review rule), and a dropped row must never read as a truncation.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyAttendance } from './attendanceData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('listMyAttendance — count-based truncation detection (#321)', () => {
	it('count > entities.length → truncated, full shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 520,
				entities: [
					{ _id: 'att-1', _parent: [{ reference: 'event-1' }], status: [{ string: 'present' }] }
				]
			})
		);
		expect(await listMyAttendance(cfg, 'member-1', fetchImpl)).toEqual({
			items: [{ attendanceId: 'att-1', eventId: 'event-1', status: 'present' }],
			total: 520,
			truncated: true
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=attendance');
		expect(url).toContain('member.reference=member-1');
		expect(url).toContain('limit=500');
		expect(url).not.toContain('skip=');
	});

	it('count === entities.length → complete', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 1,
				entities: [{ _id: 'att-1', _parent: [{ reference: 'event-1' }], status: [{ string: 'absent' }] }]
			})
		);
		expect(await listMyAttendance(cfg, 'member-1', fetchImpl)).toEqual({
			items: [{ attendanceId: 'att-1', eventId: 'event-1', status: 'absent' }],
			total: 1,
			truncated: false
		});
	});

	it('a half-visible row dropped by the #84 guard does NOT fabricate a truncation (RAW wire length, not items.length)', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 2,
				entities: [
					{ _id: 'att-1', _parent: [{ reference: 'event-1' }], status: [{ string: 'present' }] },
					{ _id: 'att-broken', _parent: [{ reference: 'event-2' }] } // no status — dropped
				]
			})
		);
		expect(await listMyAttendance(cfg, 'member-1', fetchImpl)).toEqual({
			items: [{ attendanceId: 'att-1', eventId: 'event-1', status: 'present' }],
			total: 2,
			truncated: false
		});
		warnSpy.mockRestore();
	});
});

// (*MVOX:Tallis* — RED spec, #321)
