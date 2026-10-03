// @vitest-environment happy-dom
// The RSVP panel iterates the roster, not the rsvp map, so a deactivated member's
// rsvp entry renders no phantom row.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

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
