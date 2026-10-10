// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		attendance_status_present: () => 'Present'
	})
);

vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/mocks/session')).localeRuntimeModule()
);

afterEach(cleanup);

function item(id: string, startDatetime: string): AgendaItem {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

const past = item('p1', '2026-06-01T16:00:00.000Z');
const upcoming = item('u1', '2026-06-15T16:00:00.000Z');

describe('AgendaList past event line', () => {
	it('a past row shows the attendance badge with the lower-cased answer in brackets, and no RSVP pill', () => {
		const { container } = render(AgendaList, {
			items: [upcoming],
			recentItems: [past],
			membership: 'member',
			rsvpByEventId: { p1: { rsvpId: 'rs1', status: 'going' } },
			myAttendanceByEventId: { p1: 'present' }
		});
		const row = container.querySelector('[data-testid="agenda-recent-row-p1"]')!;
		expect(row.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(row.querySelector('[data-testid="attendance-badge-p1"]')?.textContent?.trim()).toBe(
			'Present'
		);
		expect(row.querySelector('[data-testid="attendance-answer-p1"]')?.textContent?.trim()).toBe(
			'(going)'
		);
	});

	it('a past row without an answer shows no answer bracket', () => {
		const { container } = render(AgendaList, {
			items: [upcoming],
			recentItems: [past],
			membership: 'member',
			myAttendanceByEventId: { p1: 'present' }
		});
		const row = container.querySelector('[data-testid="agenda-recent-row-p1"]')!;
		expect(row.querySelector('[data-testid="attendance-badge-p1"]')).not.toBeNull();
		expect(row.querySelector('[data-testid^="attendance-answer-"]')).toBeNull();
	});

	it('an upcoming row keeps its RSVP pill', () => {
		const { container } = render(AgendaList, {
			items: [upcoming],
			recentItems: [past],
			membership: 'member'
		});
		const row = container.querySelector('[data-testid="agenda-row-u1"]')!;
		expect(row.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
	});
});
