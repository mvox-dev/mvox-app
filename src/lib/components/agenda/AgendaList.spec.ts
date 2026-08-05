// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (params: { minutes: number }) => `${params.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params: { weeks: number }) => `${params.weeks} weeks later`
	}
}));

afterEach(cleanup);

function item(id: string, startDatetime: string, overrides: Partial<AgendaItem> = {}): AgendaItem {
	return { id, name: `Rehearsal ${id}`, startDatetime, durationMinutes: 90, location: '', ...overrides };
}

// Europe/Tallinn is UTC+3 in summer (EEST). These two items are on the same calendar
// date when viewed in Tallinn (2026-06-15 in Tallinn = 2026-06-14T21:00Z onward).
const itemSameDay: AgendaItem[] = [
	item('r1', '2026-06-15T09:00:00.000Z'), // 12:00 Tallinn
	item('r2', '2026-06-15T16:00:00.000Z', { location: 'Hall A' }) // 19:00 Tallinn
];

// These fall on two different Tallinn calendar dates
const itemsDifferentDays: AgendaItem[] = [
	item('r1', '2026-06-15T16:00:00.000Z'), // 19:00 Tallinn, 2026-06-15
	item('r2', '2026-06-16T16:00:00.000Z', { location: 'Studio' }) // 19:00 Tallinn, 2026-06-16
];

describe('AgendaList — date-group headers', () => {
	it('items on the same Tallinn calendar day share one header', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const headers = container.querySelectorAll('[data-testid="agenda-date-header"]');
		expect(headers.length).toBe(1);
	});

	it('items on different Tallinn calendar days each get their own header', () => {
		const { container } = render(AgendaList, { items: itemsDifferentDays });
		const headers = container.querySelectorAll('[data-testid="agenda-date-header"]');
		expect(headers.length).toBe(2);
	});

	it('headers are in chronological order (earlier date first)', () => {
		const { container } = render(AgendaList, { items: itemsDifferentDays });
		const groups = container.querySelectorAll('[data-testid="agenda-day-group"]');
		const firstRow = groups[0].querySelector('[data-testid^="agenda-row-"]');
		const secondRow = groups[1].querySelector('[data-testid^="agenda-row-"]');
		expect(firstRow?.getAttribute('data-testid')).toBe('agenda-row-r1');
		expect(secondRow?.getAttribute('data-testid')).toBe('agenda-row-r2');
	});
});

describe('AgendaList — row content', () => {
	it('renders a row per item with data-testid="agenda-row-<id>"', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		expect(container.querySelector('[data-testid="agenda-row-r1"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-row-r2"]')).not.toBeNull();
	});

	it('row contains start time in HH:MM format (Europe/Tallinn)', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const timeEl = row?.querySelector('[data-testid="row-time"]');
		// r1: 2026-06-15T09:00:00Z = 12:00 in Tallinn (EEST = UTC+3)
		expect(timeEl?.textContent?.trim()).toBe('12:00');
	});

	it('row contains duration via agenda_duration_min', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const durationEl = row?.querySelector('[data-testid="row-duration"]');
		expect(durationEl?.textContent).toContain('90 min');
	});

	it('row contains the rehearsal name', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.textContent).toContain('Rehearsal r1');
	});

	it('row contains location when present', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r2"]');
		const loc = row?.querySelector('[data-testid="row-location"]');
		expect(loc?.textContent).toContain('Hall A');
	});

	it('row omits the location element when location is empty', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		// r1 has location: ''
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const loc = row?.querySelector('[data-testid="row-location"]');
		expect(loc).toBeNull();
	});
});

describe('AgendaList — TODAY/TOMORROW relative-day labels', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('labels the group matching the current Tallinn day as TODAY', () => {
		// "now" = 2026-06-15T10:00Z = 13:00 Tallinn -> today's Tallinn day is 2026-06-15
		vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
		const items = [item('r1', '2026-06-15T09:00:00.000Z')]; // 12:00 Tallinn, same day
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-relative-today"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-relative-tomorrow"]')).toBeNull();
	});

	it('labels the next Tallinn day as TOMORROW', () => {
		vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z')); // today = 2026-06-15 Tallinn
		const items = [item('r1', '2026-06-16T09:00:00.000Z')]; // 12:00 Tallinn on 2026-06-16
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-relative-tomorrow"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-relative-today"]')).toBeNull();
	});

	it('does not label a day further out than tomorrow', () => {
		vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
		const items = [item('r1', '2026-06-18T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-relative-today"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-relative-tomorrow"]')).toBeNull();
	});

	it('resolves TODAY by the Tallinn calendar day, not the UTC day', () => {
		// 2026-06-14T22:00Z = 2026-06-15T01:00 Tallinn (EEST) -> "today" in Tallinn is 2026-06-15,
		// even though the UTC date is still 2026-06-14.
		vi.setSystemTime(new Date('2026-06-14T22:00:00.000Z'));
		const items = [item('r1', '2026-06-14T23:00:00.000Z')]; // 2026-06-15T02:00 Tallinn — same Tallinn day as "now"
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-relative-today"]')).not.toBeNull();
	});
});

describe('AgendaList — multi-week gap marker', () => {
	it('shows no gap marker for consecutive days', () => {
		const { container } = render(AgendaList, { items: itemsDifferentDays });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});

	it('shows no gap marker for a gap under 6 days', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-06T09:00:00.000Z')]; // 5 days apart
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});

	// M4 fix: a 7-day gap is a normal weekly rehearsal cadence, not a genuine
	// multi-week break. The old `days < 6` threshold fired here ("In 1 weeks" on
	// every ordinary week) — raised to 13 days (~2 weeks) so this stays quiet.
	it('shows no gap marker for a normal weekly cadence (7 days)', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-08T09:00:00.000Z')]; // 7 days apart
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});

	it('shows no gap marker for a gap just under the 13-day threshold (12 days)', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-13T09:00:00.000Z')]; // 12 days apart
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});

	it('shows a gap marker for a genuine multi-week gap (14+ days)', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-15T09:00:00.000Z')]; // 14 days apart
		const { container } = render(AgendaList, { items });
		const marker = container.querySelector('[data-testid="agenda-gap-marker"]');
		expect(marker).not.toBeNull();
		expect(marker?.textContent).toContain('2 weeks later');
	});

	it('places the gap marker between the two day groups it separates', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-15T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		const marker = container.querySelector('[data-testid="agenda-gap-marker"]');
		const groups = container.querySelectorAll('[data-testid="agenda-day-group"]');
		expect(marker?.compareDocumentPosition(groups[0]!)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
		expect(marker?.compareDocumentPosition(groups[1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('never shows a gap marker before the first day group', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});
});

describe('AgendaList — empty state', () => {
	it('renders agenda_empty_no_rehearsals when items is empty', () => {
		const { container } = render(AgendaList, { items: [] });
		expect(container.textContent).toContain('No upcoming rehearsals.');
	});

	it('renders no rows when items is empty', () => {
		const { container } = render(AgendaList, { items: [] });
		expect(container.querySelector('[data-testid^="agenda-row-"]')).toBeNull();
	});
});

describe('AgendaList — loading state', () => {
	it('renders a three-row skeleton and no real rows when loading', () => {
		const { container } = render(AgendaList, { items: [], loading: true });
		const skeletonRows = container.querySelectorAll('[data-testid="agenda-skeleton-row"]');
		expect(skeletonRows.length).toBe(3);
		expect(container.querySelector('[data-testid^="agenda-row-"]')).toBeNull();
	});

	it('shows the skeleton instead of the empty state while loading', () => {
		const { container } = render(AgendaList, { items: [], loading: true });
		expect(container.querySelector('[data-testid="agenda-empty"]')).toBeNull();
	});

	it('prefers the skeleton over real rows if loading is true but items are already present', () => {
		const { container } = render(AgendaList, { items: itemSameDay, loading: true });
		expect(container.querySelector('[data-testid="agenda-skeleton"]')).not.toBeNull();
		expect(container.querySelector('[data-testid^="agenda-row-"]')).toBeNull();
	});
});

// (*MVOX:Byrd*)
