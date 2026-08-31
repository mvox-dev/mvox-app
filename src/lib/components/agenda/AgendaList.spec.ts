// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';
import type { RsvpByEventId } from '$lib/rsvp/rsvpData';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params) => `${(params as { weeks: number }).weeks} weeks later`,
		// #12 — RsvpControl's keys, added here up front so this mock stays valid once
		// Byrd's GREEN wires the real RsvpControl (which imports the same module) into
		// each row.
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		// #101 — the row link's accessible name, plus its nameless-event floor
		// (review fix F2). Enumerated so the tests can tell the two apart.
		agenda_row_link_label: (params) => `View details for ${(params as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details'
	};
	return {
		// #90 TR.2 — Proxy fallback: any key NOT enumerated above resolves to a
		// `[key]` stub, so wiring RepertoireElement (which may add its own i18n
		// keys) into a row can never crash this mock. Assertions on translated
		// copy keep using the enumerated keys.
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
	it('renders agenda_empty_no_events when items is empty', () => {
		const { container } = render(AgendaList, { items: [] });
		expect(container.textContent).toContain('No upcoming events.');
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

// ── AgendaList — RsvpControl per row (#12) ──────────────────────────────────
// The wiring contract only — RsvpControl's own button/label/tap behavior is
// covered by RsvpControl.spec.ts. Not testing network here: rsvpByEventId and
// memberId are plain props, onrsvpchange is a plain callback (team-lead's
// brief: "keep write calls behind injected props/handlers so the component
// test stays unit-level").

describe('AgendaList — RsvpControl per row (#12)', () => {
	it('renders one RsvpControl per row', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
	});

	it("an event present in rsvpByEventId shows that event's status as active (aria-pressed)", () => {
		const rsvpByEventId: RsvpByEventId = { r1: { rsvpId: 'rsvp-1', status: 'maybe' } };
		const { container } = render(AgendaList, { items: itemSameDay, rsvpByEventId, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-maybe"]');
		expect(btn?.getAttribute('aria-pressed')).toBe('true');
	});

	it("an event ABSENT from rsvpByEventId shows unanswered — no button active (the #11 'not defaulted' AC, display half)", () => {
		const rsvpByEventId: RsvpByEventId = { r1: { rsvpId: 'rsvp-1', status: 'going' } }; // only r1 answered
		const { container } = render(AgendaList, { items: itemSameDay, rsvpByEventId, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r2"]'); // r2 has no entry
		const buttons = row?.querySelectorAll('[data-testid^="rsvp-btn-"]');
		// Guard against a vacuous pass: the loop below proves nothing if the control
		// isn't rendered at all yet (empty NodeList) — assert its presence first.
		expect(buttons?.length).toBe(4);
		for (const btn of buttons ?? []) {
			expect(btn.getAttribute('aria-pressed')).toBe('false');
		}
	});

	it("membership='non-member' disables every row's control (confirmed non-member)", () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'non-member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(true);
	});

	it("membership='member' enables every row's control", () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});

	it("tapping a row's control forwards (item, status) via onrsvpchange — the right item, not a different row's", async () => {
		const onrsvpchange = vi.fn();
		const { container } = render(AgendaList, {
			items: itemSameDay,
			membership: 'member',
			onrsvpchange
		});
		const row2 = container.querySelector('[data-testid="agenda-row-r2"]');
		const btn = row2?.querySelector('[data-testid="rsvp-btn-late"]');
		expect(btn).not.toBeNull();
		await fireEvent.click(btn!);
		expect(onrsvpchange).toHaveBeenCalledTimes(1);
		expect(onrsvpchange).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }), 'late');
	});
});

// ── AgendaList — per-event pending disables the WHOLE control (#15) ─────────
// Mihkel's ruling: while an event's write is in flight, that event's entire
// RsvpControl (all 4 buttons) is unclickable — re-enabled on resolve. This is
// the primary #15 fix (rsvpChangeQueue.spec.ts covers the write-orchestration
// half); here we only pin that the pending signal actually reaches the row's
// `disabled` prop, and does so per-event.

describe('AgendaList — pending event disables its whole control (#15)', () => {
	it("an event id in pendingEventIds disables ALL FOUR buttons of that row's control, even for a resolved member", () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			membership: 'member',
			pendingEventIds: new Set(['r1'])
		});
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const buttons = row?.querySelectorAll('[data-testid^="rsvp-btn-"]') as NodeListOf<HTMLButtonElement> | undefined;
		expect(buttons?.length).toBe(4);
		for (const btn of buttons ?? []) {
			expect(btn.disabled).toBe(true);
		}
	});

	it('a DIFFERENT row (not in pendingEventIds) stays fully interactive — pending is per-event, not global', () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			membership: 'member',
			pendingEventIds: new Set(['r1']) // only r1 pending
		});
		const row2 = container.querySelector('[data-testid="agenda-row-r2"]');
		const btn = row2?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});

	it('an empty pendingEventIds (nothing in flight) disables no row on account of pending — membership alone still governs', () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			membership: 'member',
			pendingEventIds: new Set<string>()
		});
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});
});

// ── AgendaList — membership 3-state passes the right REASON to each control ──
// The disable reason (not a pre-collapsed boolean) reaches RsvpControl:
//   'non-member' → disabled + hint;  'member' → enabled;  'loading' (unresolved)
//   → disabled, NO hint (fail-safe — never a false "Only members can RSVP").

describe('AgendaList — membership state (loading / member / non-member)', () => {
	it("membership='non-member' shows the non-member hint on a row", () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'non-member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.textContent).toContain('You are not an active member.');
	});

	it("membership='member' shows no non-member hint", () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.textContent).not.toContain('You are not an active member.');
	});

	it("membership='loading' (unresolved) disables the control but shows NO non-member hint", () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'loading' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(true);
		expect(row?.textContent).not.toContain('You are not an active member.');
	});
});

describe('AgendaList — per-event write-failure indicator (failedEventIds)', () => {
	it("a row whose event id is in failedEventIds surfaces the save-failed error", () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			membership: 'member',
			failedEventIds: new Set(['r1'])
		});
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
	});

	it("a row NOT in failedEventIds shows no save-failed error — the indicator is per-event", () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			membership: 'member',
			failedEventIds: new Set(['r1']) // only r1 failed
		});
		const row2 = container.querySelector('[data-testid="agenda-row-r2"]');
		expect(row2?.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
	});
});

// ── AgendaList — Works line per row (#90 TR.2) ──────────────────────────────
// Wiring contract only — the collapsed/expanded Works behavior itself is
// covered by RepertoireElement.spec.ts. Same seam as rsvpByEventId: the page
// resolves the works view model (resolveEventWorks + edition details) and
// hands it in as a plain prop, keyed by event id:
//   worksByEventId: Record<string, WorkRow[]>  (WorkRow shape pinned in
//   RepertoireElement.spec.ts)
// An event with no entry (or an empty array) renders NO works line.

describe('AgendaList — Works line per row (#90 TR.2)', () => {
	const worksByEventId = {
		r1: [
			{
				id: 'ri-1',
				kind: 'repertoire' as const,
				workId: 'work-1',
				editionId: 'ed-1',
				workName: 'Spem in alium',
				composer: 'Thomas Tallis',
				status: 'active' as const,
				editionName: '40-part original',
				ordinal: null,
				fileId: '',
				externalLinks: [],
				canBorrow: false,
				notes: ''
			}
		]
	};

	it("renders the Works line inside the row whose event id has works — and the line names that row's works", () => {
		const { container } = render(AgendaList, { items: itemSameDay, worksByEventId });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const line = row?.querySelector('[data-testid="works-line"]');
		expect(line).not.toBeNull();
		expect(line?.textContent).toContain('Spem in alium');
	});

	it('renders NO Works line for a row without works — the element is per-event, absent when empty', () => {
		const { container } = render(AgendaList, { items: itemSameDay, worksByEventId });
		const row2 = container.querySelector('[data-testid="agenda-row-r2"]'); // r2 has no entry
		expect(row2?.querySelector('[data-testid="works-line"]')).toBeNull();
	});

	it('renders NO Works line anywhere when worksByEventId is not provided at all', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		expect(container.querySelector('[data-testid="works-line"]')).toBeNull();
	});

	it('forwards onpdfclick down to the row\'s works element (the page signs the url at click time)', async () => {
		const onpdfclick = vi.fn();
		const works = { r1: [{ ...worksByEventId.r1[0], fileId: 'file-1' }] };
		const { container } = render(AgendaList, { items: itemSameDay, worksByEventId: works, onpdfclick });
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(container.querySelector('[data-testid="work-link-pdf"]')!);
		expect(onpdfclick).toHaveBeenCalledWith('file-1');
	});
});

describe('AgendaList — event detail links (#101 TE.1)', () => {
	// The issue's widget spec: every agenda row becomes tappable and navigates to
	// /event/{id}, with a ▸ tap indicator; "Row stays functionally identical
	// (RSVP stays, works line stays)" — so the RSVP buttons must NOT end up
	// nested inside the anchor (nested interactive controls: a tap on 'Going'
	// must record an RSVP, never navigate).

	it('upcoming row carries a link to /event/{id}', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]')!;
		// The link may wrap the row or sit inside it — either satisfies "tappable".
		const link = row.querySelector('a[href="/event/r1"]') ?? row.closest('a[href="/event/r1"]');
		expect(link).not.toBeNull();
	});

	it('each upcoming row links to ITS OWN event id', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		for (const id of ['r1', 'r2']) {
			const row = container.querySelector(`[data-testid="agenda-row-${id}"]`)!;
			const link =
				row.querySelector(`a[href="/event/${id}"]`) ?? row.closest(`a[href="/event/${id}"]`);
			expect(link, `link for ${id}`).not.toBeNull();
		}
	});

	it('shows a ▸ tap indicator on the row', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]')!;
		const scope = row.closest('a[href="/event/r1"]') ?? row;
		expect(scope.textContent).toContain('▸');
	});

	it('the RSVP control stays functional: its buttons are NEVER nested inside an event link', () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]')!;
		// The control itself is still there for a member…
		const rowScope = row.closest('a') ?? row;
		const host = rowScope.parentElement ?? rowScope;
		expect(host.querySelectorAll('button').length).toBeGreaterThan(0);
		// …and no event-detail anchor swallows ANY button (a button inside an <a>
		// is invalid HTML and makes an RSVP tap navigate away).
		for (const anchor of container.querySelectorAll('a[href^="/event/"]')) {
			expect(anchor.querySelector('button')).toBeNull();
		}
	});

	it('recent (past) rows link to their event detail too', () => {
		const recent = [item('p9', '2026-06-01T16:00:00.000Z')];
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: recent });
		const row = container.querySelector('[data-testid="agenda-recent-row-p9"]')!;
		const link = row.querySelector('a[href="/event/p9"]') ?? row.closest('a[href="/event/p9"]');
		expect(link).not.toBeNull();
	});

	// #101 review fix (F2) — a link with no accessible name is announced as an
	// unnamed link. `listEvents` now inherits a missing name from the parent
	// series, but an event with no name ANYWHERE must still get a generic label
	// rather than the bare "View details for ".
	it('labels the row link with the event name', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const link = container.querySelector('a[href="/event/r1"][aria-label]')!;
		expect(link.getAttribute('aria-label')).toBe('View details for Rehearsal r1');
	});

	it('a nameless event falls back to a generic label, never a dangling "for "', () => {
		const nameless = [item('n1', '2026-06-15T09:00:00.000Z', { name: '' })];
		const { container } = render(AgendaList, { items: nameless });
		const link = container.querySelector('a[href="/event/n1"][aria-label]')!;
		expect(link.getAttribute('aria-label')).toBe('View event details');
	});

	it('a whitespace-only name is treated as nameless too', () => {
		const blank = [item('n2', '2026-06-15T09:00:00.000Z', { name: '   ' })];
		const { container } = render(AgendaList, { items: blank });
		const link = container.querySelector('a[href="/event/n2"][aria-label]')!;
		expect(link.getAttribute('aria-label')).toBe('View event details');
	});

	it('recent rows get the same labelling treatment', () => {
		const recent = [item('p8', '2026-06-01T16:00:00.000Z', { name: '' })];
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: recent });
		const link = container.querySelector('a[href="/event/p8"][aria-label]')!;
		expect(link.getAttribute('aria-label')).toBe('View event details');
	});
});

// (*MVOX:Byrd*)
// (*MVOX:Tallis* — #90 TR.2 Works-line wiring RED)
// (*MVOX:Tallis* — #101 TE.1 event-detail row links RED)
// (*MVOX:Josquin* — #101 TE.1 review fix F2: row-link accessible name)
