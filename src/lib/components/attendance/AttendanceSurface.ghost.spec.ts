// @vitest-environment happy-dom
//
// #255 done-when 2 — the RSVP-comparison panel is naturally ghost-safe: its
// row set is ROSTER-DRIVEN ({#each members}), so a deactivated member's rsvp
// map entry has no row to hang on and renders nothing. Guard pin (passes
// today) so nobody later "fixes" the panel into iterating the rsvp map and
// resurrects her as a phantom row.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

import AttendanceSurface from './AttendanceSurface.svelte';
import type { AgendaItem } from '$lib/agenda/types';

afterEach(cleanup);

const item: AgendaItem = {
	id: 'past-1',
	name: 'Rehearsal past-1',
	startDatetime: '2026-06-10T16:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
} as AgendaItem;

describe('AttendanceSurface — deactivated member renders NO row (roster-driven iteration)', () => {
	it("an rsvp map entry for a member NOT in the active roster produces no attendance row and no rsvp cell", () => {
		const { container } = render(AttendanceSurface, {
			props: {
				item,
				members: [{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'a@example.com' }],
				attendanceByMemberId: {},
				rsvpByMemberId: {
					m1: { rsvpId: 'r1', status: 'going' },
					'm-gone': { rsvpId: 'r9', status: 'going' } // deactivated — her past answer exists, her row must not
				},
				loading: false,
				error: false
			}
		});
		expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="attendance-row-m-gone"]')).toBeNull();
		expect(container.querySelector('[data-testid="attendance-rsvp-m-gone"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
