// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
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

// Layout is unmeasurable in happy-dom, so position is pinned by DOM order under one parent.
describe('AgendaList take-attendance button position', () => {
	it('a conductor sees the button in the same row as the event name link, after it', () => {
		const { container } = render(AgendaList, {
			items: [upcoming],
			recentItems: [past],
			conductorEventIds: new Set(['p1']),
			ontakeattendance: vi.fn()
		});
		const row = container.querySelector('[data-testid="agenda-recent-row-p1"]')!;
		const button = row.querySelector('[data-testid="take-attendance-btn"]')!;
		const link = row.querySelector('a[aria-label]')!;
		const head = button.parentElement!;
		expect(head.classList.contains('justify-between')).toBe(true);
		expect(head.contains(link)).toBe(true);
		const linkSide = [...head.children].find((child) => child.contains(link))!;
		expect([...head.children].indexOf(linkSide)).toBeLessThan(
			[...head.children].indexOf(button)
		);
		expect(link.contains(button)).toBe(false);
	});

	it('a non-conductor sees no button', () => {
		const { container } = render(AgendaList, { items: [upcoming], recentItems: [past] });
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});

	it('clicking the button hands the event to ontakeattendance', async () => {
		const ontakeattendance = vi.fn();
		const { container } = render(AgendaList, {
			items: [upcoming],
			recentItems: [past],
			conductorEventIds: new Set(['p1']),
			ontakeattendance
		});
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		expect(ontakeattendance).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
	});
});
