// @vitest-environment happy-dom
//
// #326 RED (list-wiring half) — the saved cue reaches each agenda row
// PER-EVENT, through a `savedEventIds` set prop that mirrors the existing
// pendingEventIds/failedEventIds shape (#15's per-event-Set pattern).
//
// Granularity pin (issue Done-when + the epic's "dangerous pair"): a cue must
// never claim more than the key that reconciled — only the row whose event id
// actually settled shows the saved announcement; every other row stays blank.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params) => `${(params as { weeks: number }).weeks} weeks later`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		rsvp_saved: () => 'Saved.',
		agenda_row_link_label: (params) => `View details for ${(params as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

afterEach(cleanup);

function item(id: string, startDatetime: string, overrides: Partial<AgendaItem> = {}): AgendaItem {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		...overrides
	};
}

const items: AgendaItem[] = [
	item('r1', '2026-06-15T09:00:00.000Z'),
	item('r2', '2026-06-15T16:00:00.000Z')
];

function row(container: HTMLElement, id: string): HTMLElement | null {
	return container.querySelector(`[data-testid="agenda-row-${id}"]`);
}

function rowSavedText(container: HTMLElement, id: string): string {
	return (
		row(container, id)
			?.querySelector('[data-testid="rsvp-saved-status"]')
			?.textContent?.trim() ?? ''
	);
}

describe('AgendaList — savedEventIds reaches the matching row and ONLY that row', () => {
	it("an event id in savedEventIds puts the saved announcement on THAT row's control", () => {
		const { container } = render(AgendaList, {
			items,
			membership: 'member',
			savedEventIds: new Set(['r1'])
		});
		expect(rowSavedText(container, 'r1')).toContain('Saved.');
	});

	it('a DIFFERENT row (not in savedEventIds) shows NO saved cue — the cue never claims more than the key that reconciled', () => {
		const { container } = render(AgendaList, {
			items,
			membership: 'member',
			savedEventIds: new Set(['r1'])
		});
		expect(rowSavedText(container, 'r2')).toBe('');
		expect(row(container, 'r2')?.textContent).not.toContain('Saved.');
	});

	it('an empty savedEventIds (nothing reconciled) shows the cue on no row at all', () => {
		const { container } = render(AgendaList, {
			items,
			membership: 'member',
			savedEventIds: new Set<string>()
		});
		expect(container.textContent).not.toContain('Saved.');
	});

	it('savedEventIds omitted (default) — same: no row carries a saved cue', () => {
		const { container } = render(AgendaList, { items, membership: 'member' });
		expect(container.textContent).not.toContain('Saved.');
	});

	it("a saved row stays fully interactive — saved is not pending, so its buttons remain enabled", () => {
		const { container } = render(AgendaList, {
			items,
			membership: 'member',
			savedEventIds: new Set(['r1'])
		});
		const btn = row(container, 'r1')?.querySelector(
			'[data-testid="rsvp-btn-going"]'
		) as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});
});

// (*MVOX:Tallis* — #326 RED)
