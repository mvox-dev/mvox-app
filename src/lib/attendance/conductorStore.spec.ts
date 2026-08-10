// @vitest-environment happy-dom
//
// #83 TA.2 — conductor seat: determination + agenda surface (RED).
//
// Two halves in one file (team-lead's brief pins both to this path):
//
// A. `determineConductor(personId, seasonConductors, eventConductors)` from
//    ./conductorStore (GREEN creates it) — collapses resolveConductors' active
//    list into the seat verdict: 'conductor' | 'not-conductor'. Deliberately NO
//    loading/error states — unlike the librarian rights-read (librarianStore's
//    4-state), this is a pure comparison on already-loaded event/season data
//    (issue #83 "Surface gating").
//
// B. AgendaList's 'Recent' section + per-row 'Take attendance' gating — new
//    props pinned here (GREEN wires them into AgendaList.svelte):
//      - `recentItems: AgendaItem[]` (default []) — past events of the current
//        season, already reverse-chron (ordering computed by recentEvents, see
//        conductorLogic.spec.ts; the component renders in the order given).
//        Rendered under [data-testid="agenda-recent"] as
//        [data-testid="agenda-recent-row-<id>"] rows — ALL of them, no cap.
//      - `conductorEventIds: Set<string>` (default empty) — events where the
//        signed-in person holds the conductor seat (per-event, because an
//        event-level override can differ row by row — same per-event-Set shape
//        as pendingEventIds/failedEventIds). A recent row whose id is in the
//        set shows [data-testid="take-attendance-btn"]; otherwise hidden.
//        Upcoming rows NEVER show it — attendance is taken after the fact.
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from '$lib/agenda/types';
import { determineConductor } from './conductorStore';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (params: { minutes: number }) => `${params.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params: { weeks: number }) => `${params.weeks} weeks later`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		// #83 — the two new keys this slice introduces.
		agenda_recent: () => 'Recent',
		agenda_take_attendance: () => 'Take attendance',
		agenda_take_attendance_label: (p: { event: string }) => `Take attendance for ${p.event}`,
		// #85 TA.4 — every RECENT row now carries an attendance badge, so this
		// direct AgendaList-level test needs the 4 badge-label keys even though
		// it never passes myAttendanceByEventId (default {} -> every row reads
		// as 'not-recorded').
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_toggle_aria_label: (p: { name: string; status: string }) => `Mark ${p.name} as ${p.status}`
	}
}));

import AgendaList from '$lib/components/agenda/AgendaList.svelte';

// ── A. determineConductor — the seat verdict ────────────────────────────────

describe('determineConductor — 2-state verdict on already-loaded data (#83 AC-1)', () => {
	it('inherit: person in seasonConductors, eventConductors empty → conductor', () => {
		expect(determineConductor('p-anna', ['p-anna', 'p-bert'], [])).toBe('conductor');
	});

	it('inherit: person NOT in seasonConductors, eventConductors empty → not-conductor', () => {
		expect(determineConductor('p-zoe', ['p-anna'], [])).toBe('not-conductor');
	});

	it('merge (guest, no overlap): season conductor keeps the seat', () => {
		expect(determineConductor('p-anna', ['p-anna'], ['p-carl'])).toBe('conductor');
	});

	it('merge (guest, no overlap): the guest event conductor also holds the seat', () => {
		expect(determineConductor('p-carl', ['p-anna'], ['p-carl'])).toBe('conductor');
	});

	it('override (overlap): a season conductor NOT re-listed on the event loses the seat', () => {
		// season [anna, bert], event [bert, carl] — overlap on bert ⇒ event list wins:
		// anna is overridden OUT for this event.
		expect(determineConductor('p-anna', ['p-anna', 'p-bert'], ['p-bert', 'p-carl'])).toBe(
			'not-conductor'
		);
	});

	it('override (overlap): an event-listed conductor holds the seat', () => {
		expect(determineConductor('p-carl', ['p-anna', 'p-bert'], ['p-bert', 'p-carl'])).toBe(
			'conductor'
		);
	});

	it('both lists empty → not-conductor', () => {
		expect(determineConductor('p-anna', [], [])).toBe('not-conductor');
	});
});

// ── B. AgendaList — 'Recent' section + 'Take attendance' gating ─────────────

afterEach(cleanup);

function item(id: string, startDatetime: string): AgendaItem {
	return { id, name: `Rehearsal ${id}`, startDatetime, durationMinutes: 90, location: '', conductors: [], owners: [], editors: [] };
}

// Already reverse-chron — the order recentEvents() hands over.
const recentItems: AgendaItem[] = [
	item('past-new', '2026-06-14T16:00:00.000Z'),
	item('past-old', '2026-06-01T16:00:00.000Z')
];

const upcomingItems: AgendaItem[] = [item('up-1', '2026-06-20T16:00:00.000Z')];

describe("AgendaList — 'Recent' section (#83: ALL past events of the current season)", () => {
	it('renders the Recent section when recentItems is non-empty, headed via agenda_recent', () => {
		const { container } = render(AgendaList, { items: upcomingItems, recentItems });
		const section = container.querySelector('[data-testid="agenda-recent"]');
		expect(section).not.toBeNull();
		expect(section?.textContent).toContain('Recent');
	});

	it('renders one recent row per item, data-testid="agenda-recent-row-<id>"', () => {
		const { container } = render(AgendaList, { items: upcomingItems, recentItems });
		expect(container.querySelector('[data-testid="agenda-recent-row-past-new"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent-row-past-old"]')).not.toBeNull();
	});

	it('renders ALL recent rows — no cap (25 in → 25 rows)', () => {
		const many = Array.from({ length: 25 }, (_, i) =>
			item(`r${i + 1}`, `2026-05-${String(25 - i).padStart(2, '0')}T16:00:00.000Z`)
		);
		const { container } = render(AgendaList, { items: [], recentItems: many });
		const rows = container.querySelectorAll('[data-testid^="agenda-recent-row-"]');
		expect(rows.length).toBe(25);
	});

	it('preserves the given (reverse-chronological) order — most recent row first in the DOM', () => {
		const { container } = render(AgendaList, { items: [], recentItems });
		const rows = container.querySelectorAll('[data-testid^="agenda-recent-row-"]');
		expect(rows[0]?.getAttribute('data-testid')).toBe('agenda-recent-row-past-new');
		expect(rows[1]?.getAttribute('data-testid')).toBe('agenda-recent-row-past-old');
	});

	it('renders NO Recent section when recentItems is empty', () => {
		const { container } = render(AgendaList, { items: upcomingItems, recentItems: [] });
		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
	});

	it('renders NO Recent section when recentItems is omitted (default)', () => {
		const { container } = render(AgendaList, { items: upcomingItems });
		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
	});
});

describe("AgendaList — 'Take attendance' gating (#83: conductor-only, past events only)", () => {
	it('a recent row whose event id is in conductorEventIds shows the Take attendance button (when handler is wired)', () => {
		const { container } = render(AgendaList, {
			items: [],
			recentItems,
			conductorEventIds: new Set(['past-new', 'past-old']),
			ontakeattendance: vi.fn()
		});
		const row = container.querySelector('[data-testid="agenda-recent-row-past-new"]');
		expect(row).not.toBeNull(); // guard against a vacuous pass on a missing row
		const btn = row?.querySelector('[data-testid="take-attendance-btn"]');
		expect(btn).not.toBeNull();
		expect(btn?.textContent).toContain('Take attendance');
	});

	it('a recent row NOT in conductorEventIds shows no button — gating is per-event (row-level override)', () => {
		const { container } = render(AgendaList, {
			items: [],
			recentItems,
			conductorEventIds: new Set(['past-new']), // seat on past-new only
			ontakeattendance: vi.fn()
		});
		const rowWithout = container.querySelector('[data-testid="agenda-recent-row-past-old"]');
		expect(rowWithout).not.toBeNull();
		expect(rowWithout?.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
		// ...and the granted row DOES show it — proves the absence above is gating,
		// not an unimplemented button.
		const rowWith = container.querySelector('[data-testid="agenda-recent-row-past-new"]');
		expect(rowWith?.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
	});

	it('non-conductor (conductorEventIds omitted) sees NO Take attendance button anywhere', () => {
		const { container } = render(AgendaList, { items: upcomingItems, recentItems, ontakeattendance: vi.fn() });
		expect(container.querySelector('[data-testid="agenda-recent-row-past-new"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});

	it('button is hidden when no ontakeattendance handler is wired, even for a conductor event (no dead-end affordance)', () => {
		const { container } = render(AgendaList, {
			items: [],
			recentItems,
			conductorEventIds: new Set(['past-new', 'past-old'])
			// ontakeattendance deliberately omitted
		});
		expect(container.querySelector('[data-testid="agenda-recent-row-past-new"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});

	it('clicking the Take attendance button fires ontakeattendance with the correct item', async () => {
		const handler = vi.fn();
		const { container } = render(AgendaList, {
			items: [],
			recentItems,
			conductorEventIds: new Set(['past-new']),
			ontakeattendance: handler
		});
		const btn = container.querySelector('[data-testid="take-attendance-btn"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'past-new' }));
	});

	it('an UPCOMING row never shows the button, even when its id is in conductorEventIds', () => {
		const { container } = render(AgendaList, {
			items: upcomingItems,
			recentItems,
			conductorEventIds: new Set(['up-1', 'past-new']),
			ontakeattendance: vi.fn()
		});
		const upcomingRow = container.querySelector('[data-testid="agenda-row-up-1"]');
		expect(upcomingRow).not.toBeNull();
		expect(upcomingRow?.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
