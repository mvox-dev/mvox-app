// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';
import type { RsvpByEventId } from '$lib/rsvp/rsvpData';
import type { AttendancePanel } from '$lib/attendance/types';
import { gotoMock } from '$lib/testing/routeMocks';
import { localeMock } from '$lib/testing/mocks/session';

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params) => `${(params as { weeks: number }).weeks} weeks later`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		agenda_row_link_label: (params) => `View details for ${(params as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details'
	})
);

type AppLocale = 'en' | 'et' | 'lv' | 'uk';
vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/mocks/session')).localeRuntimeModule()
);
function setAppLocale(locale: AppLocale): void {
	localeMock.state?.set('locale', locale);
}

afterEach(cleanup);
afterEach(() => setAppLocale('en'));

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

const itemSameDay: AgendaItem[] = [
	item('r1', '2026-06-15T09:00:00.000Z'),
	item('r2', '2026-06-15T16:00:00.000Z', { location: 'Hall A' })
];

const itemsDifferentDays: AgendaItem[] = [
	item('r1', '2026-06-15T16:00:00.000Z'),
	item('r2', '2026-06-16T16:00:00.000Z', { location: 'Studio' })
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
		vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
		const items = [item('r1', '2026-06-15T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-relative-today"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-relative-tomorrow"]')).toBeNull();
	});

	it('labels the next Tallinn day as TOMORROW', () => {
		vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
		const items = [item('r1', '2026-06-16T09:00:00.000Z')];
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
		vi.setSystemTime(new Date('2026-06-14T22:00:00.000Z'));
		const items = [item('r1', '2026-06-14T23:00:00.000Z')];
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
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-06T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});

	it('shows no gap marker for a normal weekly cadence (7 days)', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-08T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});

	it('shows no gap marker for a gap just under the 13-day threshold (12 days)', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-13T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		expect(container.querySelector('[data-testid="agenda-gap-marker"]')).toBeNull();
	});

	it('shows a gap marker for a genuine multi-week gap (14+ days)', () => {
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-15T09:00:00.000Z')];
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
		const rsvpByEventId: RsvpByEventId = { r1: { rsvpId: 'rsvp-1', status: 'going' } };
		const { container } = render(AgendaList, { items: itemSameDay, rsvpByEventId, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r2"]');
		const buttons = row?.querySelectorAll('[data-testid^="rsvp-btn-"]');
		expect(buttons?.length).toBe(4);
		for (const btn of buttons ?? []) {
			expect(btn.getAttribute('aria-pressed')).toBe('false');
		}
	});

	it("membership='member' alone does NOT enable the control — canRsvp is the gate", () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(true);
	});

	it("tapping a row's control forwards (item, status) via onrsvpchange — the right item, not a different row's", async () => {
		const onrsvpchange = vi.fn();
		const { container } = render(AgendaList, {
			items: itemSameDay,
			canRsvp: 'editor',
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

describe('AgendaList — canRsvp is the RSVP gate (#372)', () => {
	it("canRsvp='editor' enables every row's control", () => {
		const { container } = render(AgendaList, { items: itemSameDay, canRsvp: 'editor' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});

	it("canRsvp='loading' (the default) renders the control disabled — never an enabled invitation ahead of the grant", () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(true);
	});

	it("canRsvp='not-editor' renders NO control at all on the row — not disabled, absent (#369)", () => {
		const { container } = render(AgendaList, { items: itemSameDay, canRsvp: 'not-editor' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});
});

describe('AgendaList — pending event disables its whole control (#15)', () => {
	it("an event id in pendingEventIds disables ALL FOUR buttons of that row's control, even with the grant in hand", () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			canRsvp: 'editor',
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
			canRsvp: 'editor',
			pendingEventIds: new Set(['r1'])
		});
		const row2 = container.querySelector('[data-testid="agenda-row-r2"]');
		const btn = row2?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});

	it('an empty pendingEventIds (nothing in flight) disables no row on account of pending — canRsvp alone still governs', () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			canRsvp: 'editor',
			pendingEventIds: new Set<string>()
		});
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		const btn = row?.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn?.disabled).toBe(false);
	});
});

describe('AgendaList — membership state (loading / member / non-member)', () => {
	it("membership='non-member' + no grant shows the hint, renders NO control", () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			membership: 'non-member',
			canRsvp: 'not-editor'
		});
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.textContent).toContain('You are not an active member.');
		expect(row?.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	it("membership='member' shows no non-member hint", () => {
		const { container } = render(AgendaList, { items: itemSameDay, membership: 'member' });
		const row = container.querySelector('[data-testid="agenda-row-r1"]');
		expect(row?.textContent).not.toContain('You are not an active member.');
	});

	it("membership='loading' (unresolved) shows NO non-member hint, regardless of canRsvp", () => {
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
			failedEventIds: new Set(['r1'])
		});
		const row2 = container.querySelector('[data-testid="agenda-row-r2"]');
		expect(row2?.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
	});
});

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
				fileName: '',
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
		const row2 = container.querySelector('[data-testid="agenda-row-r2"]');
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

	it('upcoming row carries a link to /event/{id}', () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]')!;
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
		const rowScope = row.closest('a') ?? row;
		const host = rowScope.parentElement ?? rowScope;
		expect(host.querySelectorAll('button').length).toBeGreaterThan(0);
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

describe('#207 rule 7 — ISO dates on tabular rows, narrative headers preserved', () => {
	it('recent-row date cell renders the Tallinn ISO calendar day, while the day-group header for the same date keeps weekday + month name', () => {
		const upcoming = [item('r1', '2026-06-15T09:00:00.000Z')];
		const recent = [item('p1', '2026-06-15T16:00:00.000Z')];
		const { container } = render(AgendaList, { items: upcoming, recentItems: recent });

		const cell = container.querySelector(
			'[data-testid="agenda-recent-row-p1"] [data-testid="recent-row-date"]'
		);
		expect(cell).not.toBeNull();
		expect(cell?.textContent?.trim()).toBe('2026-06-15');

		const header = container.querySelector('[data-testid="agenda-date-header"]');
		const headerText = header?.textContent ?? '';
		expect(headerText).toMatch(/Monday/i);
		expect(headerText).toMatch(/June/i);
		expect(headerText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it('DST edges: recent rows near the Tallinn transitions render the Tallinn ISO calendar day, not the UTC one', async () => {
		const recent = [
			item('spring', '2026-03-28T23:30:00.000Z'),
			item('fall', '2026-10-24T22:30:00.000Z')
		];
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: recent });

		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);

		const dateOf = (id: string) =>
			container
				.querySelector(`[data-testid="agenda-recent-row-${id}"] [data-testid="recent-row-date"]`)
				?.textContent?.trim();
		expect(dateOf('spring')).toBe('2026-03-29');
		expect(dateOf('fall')).toBe('2026-10-25');
	});
});

describe('#251 — date-group headers render in the app language', () => {
	const expectedHeader: Record<AppLocale, string> = {
		en: 'Monday, June 15',
		et: 'esmaspäev, 15. juuni',
		lv: 'pirmdiena, 15. jūnijs',
		uk: 'понеділок, 15 червня'
	};
	for (const locale of ['et', 'en', 'lv', 'uk'] as AppLocale[]) {
		it(`app language '${locale}': the header reads '${expectedHeader[locale]}' regardless of the device locale`, () => {
			setAppLocale(locale);
			const { container } = render(AgendaList, { items: itemSameDay });
			const header = container.querySelector('[data-testid="agenda-date-header"]');
			expect(header?.textContent?.trim()).toBe(expectedHeader[locale]);
		});
	}

	it('switching the app language re-renders the header WITHOUT a remount (formatter is rebuilt, not a construction-time constant)', async () => {
		setAppLocale('en');
		const { container } = render(AgendaList, { items: itemSameDay });
		const headerText = () =>
			container.querySelector('[data-testid="agenda-date-header"]')?.textContent?.trim();
		expect(headerText()).toBe('Monday, June 15');

		setAppLocale('et');
		await waitFor(() => {
			expect(headerText()).toBe('esmaspäev, 15. juuni');
		});
	});

	it("app language 'et': grouping keys stay ISO — same-day items share one header and the recent-row date cell still reads '2026-06-15'", () => {
		setAppLocale('et');
		const recent = [item('p1', '2026-06-15T16:00:00.000Z')];
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: recent });

		const headers = container.querySelectorAll('[data-testid="agenda-date-header"]');
		expect(headers.length).toBe(1);
		expect(
			container
				.querySelector('[data-testid="agenda-recent-row-p1"] [data-testid="recent-row-date"]')
				?.textContent?.trim()
		).toBe('2026-06-15');
		expect(headers[0]?.textContent ?? '').not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it("app language 'et': formatter output is natural-case ('esmaspäev…') beneath #250's untouched CSS uppercase", () => {
		setAppLocale('et');
		const { container } = render(AgendaList, { items: itemSameDay });
		const header = container.querySelector('[data-testid="agenda-date-header"]');
		expect(header?.textContent?.trim()).toMatch(/^esmaspäev/);
		expect(header?.classList.contains('uppercase')).toBe(true);
		expect(header?.classList.contains('text-base')).toBe(true);
		expect(header?.classList.contains('font-semibold')).toBe(true);
	});
});

describe('#220 — AM/PM preference on agenda times', () => {
	it("'ampm': upcoming row-time renders '12:00 PM' and a 09:30 recent row renders '9:30 AM' — dates untouched (rule 7)", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const upcoming = [item('r1', '2026-06-15T09:00:00.000Z')];
			const recent = [item('p1', '2026-06-15T06:30:00.000Z')];
			const { container } = render(AgendaList, { items: upcoming, recentItems: recent });

			const rowTime = container.querySelector(
				'[data-testid="agenda-row-r1"] [data-testid="row-time"]'
			);
			expect(rowTime?.textContent?.trim()).toBe('12:00 PM');

			const recentRow = container.querySelector('[data-testid="agenda-recent-row-p1"]');
			expect(recentRow).not.toBeNull();
			const spanTexts = [...recentRow!.querySelectorAll('span')].map((s) =>
				s.textContent?.trim()
			);
			expect(spanTexts).toContain('9:30 AM');
			expect(spanTexts).not.toContain('09:30');

			expect(
				recentRow!.querySelector('[data-testid="recent-row-date"]')?.textContent?.trim()
			).toBe('2026-06-15');
			const headerText =
				container.querySelector('[data-testid="agenda-date-header"]')?.textContent ?? '';
			expect(headerText).toMatch(/Monday/i);
			expect(headerText).toMatch(/June/i);
			expect(headerText).not.toMatch(/\b(AM|PM)\b/);
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'24h' (the unset default): the SAME fixtures render exactly today's strings — byte-identical, no AM/PM anywhere", () => {
		const upcoming = [item('r1', '2026-06-15T09:00:00.000Z')];
		const recent = [item('p1', '2026-06-15T06:30:00.000Z')];
		const { container } = render(AgendaList, { items: upcoming, recentItems: recent });
		expect(
			container
				.querySelector('[data-testid="agenda-row-r1"] [data-testid="row-time"]')
				?.textContent?.trim()
		).toBe('12:00');
		const recentRow = container.querySelector('[data-testid="agenda-recent-row-p1"]');
		const spanTexts = [...recentRow!.querySelectorAll('span')].map((s) => s.textContent?.trim());
		expect(spanTexts).toContain('09:30');
		expect(container.textContent).not.toMatch(/\b(AM|PM)\b/);
	});
});

describe('#466 whole card opens the event', () => {
	beforeEach(() => {
		gotoMock.mockClear();
	});

	const recentP9 = item('p9', '2026-06-01T16:00:00.000Z', { location: 'Old Hall' });

	it("(a) upcoming: a tap on the row div's own body calls goto('/event/r1') exactly once", async () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const row = container.querySelector('[data-testid="agenda-row-r1"]')!;
		await fireEvent.click(row);
		expect(gotoMock).toHaveBeenCalledTimes(1);
		expect(gotoMock).toHaveBeenCalledWith('/event/r1');
	});

	it("(a) upcoming: a tap on the location span (non-interactive body) opens that row's own event", async () => {
		const { container } = render(AgendaList, { items: itemSameDay });
		const loc = container.querySelector(
			'[data-testid="agenda-row-r2"] [data-testid="row-location"]'
		)!;
		await fireEvent.click(loc);
		expect(gotoMock).toHaveBeenCalledTimes(1);
		expect(gotoMock).toHaveBeenCalledWith('/event/r2');
	});

	it("(a) recent: a tap on the recent row div's own body calls goto('/event/p9') exactly once", async () => {
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: [recentP9] });
		const row = container.querySelector('[data-testid="agenda-recent-row-p9"]')!;
		await fireEvent.click(row);
		expect(gotoMock).toHaveBeenCalledTimes(1);
		expect(gotoMock).toHaveBeenCalledWith('/event/p9');
	});

	it('(b) upcoming: an RSVP tap fires onrsvpchange and does NOT navigate', async () => {
		const onrsvpchange = vi.fn();
		const { container } = render(AgendaList, {
			items: itemSameDay,
			canRsvp: 'editor',
			onrsvpchange
		});
		const btn = container.querySelector(
			'[data-testid="agenda-row-r2"] [data-testid="rsvp-btn-late"]'
		)!;
		await fireEvent.click(btn);
		expect(onrsvpchange).toHaveBeenCalledTimes(1);
		expect(onrsvpchange).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }), 'late');
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('(b) recent: the take-attendance tap fires ontakeattendance and does NOT navigate', async () => {
		const ontakeattendance = vi.fn();
		const { container } = render(AgendaList, {
			items: itemSameDay,
			recentItems: [recentP9],
			conductorEventIds: new Set(['p9']),
			ontakeattendance
		});
		const btn = container.querySelector(
			'[data-testid="agenda-recent-row-p9"] [data-testid="take-attendance-btn"]'
		)!;
		await fireEvent.click(btn);
		expect(ontakeattendance).toHaveBeenCalledTimes(1);
		expect(ontakeattendance).toHaveBeenCalledWith(expect.objectContaining({ id: 'p9' }));
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('(b) recent: attendance-panel buttons keep working, and the panel surface itself (gaps between its buttons) never navigates', async () => {
		const ontoggle = vi.fn();
		const onclose = vi.fn();
		const panel: AttendancePanel = {
			item: recentP9,
			members: [
				{ memberId: 'm1', personId: 'pp1', name: 'Alto One', email: 'alto@example.invalid' }
			],
			attendanceByMemberId: {},
			rsvpByMemberId: {},
			loading: false,
			error: false,
			pendingMemberIds: new Set(),
			failedMemberIds: new Set(),
			savedMemberIds: new Set(),
			membersPartial: false,
			ontoggle,
			onclose
		};
		const { container } = render(AgendaList, {
			items: itemSameDay,
			recentItems: [recentP9],
			attendancePanel: panel
		});
		const row = container.querySelector('[data-testid="agenda-recent-row-p9"]')!;
		await fireEvent.click(row.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		expect(ontoggle).toHaveBeenCalledTimes(1);
		await fireEvent.click(row.querySelector('[data-testid="attendance-panel"]')!);
		await fireEvent.click(row.querySelector('[data-testid="attendance-collapse-btn"]')!);
		expect(onclose).toHaveBeenCalledTimes(1);
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('(b) recent: the works-line toggle and the PDF button keep working and never navigate', async () => {
		const onpdfclick = vi.fn();
		const worksByEventId = {
			p9: [
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
					fileId: 'file-1',
					fileName: '',
					externalLinks: [],
					canBorrow: false,
					notes: ''
				}
			]
		};
		const { container } = render(AgendaList, {
			items: itemSameDay,
			recentItems: [recentP9],
			worksByEventId,
			onpdfclick
		});
		const row = container.querySelector('[data-testid="agenda-recent-row-p9"]')!;
		await fireEvent.click(row.querySelector('[data-testid="works-line"]')!);
		await fireEvent.click(row.querySelector('[data-testid="work-link-pdf"]')!);
		expect(onpdfclick).toHaveBeenCalledWith('file-1');
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('(c) a tap on the accessible name link never reaches goto — both families', async () => {
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: [recentP9] });
		for (const rowId of ['agenda-row-r1', 'agenda-recent-row-p9']) {
			const link = container.querySelector(
				`[data-testid="${rowId}"] a[href^="/event/"][aria-label]`
			)!;
			expect(link, `${rowId} accessible link`).not.toBeNull();
			await fireEvent.click(link);
		}
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('(d) exactly one focusable event link per row; the row div gains no tabindex and no role', () => {
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: [recentP9] });
		for (const rowId of ['agenda-row-r1', 'agenda-row-r2', 'agenda-recent-row-p9']) {
			const row = container.querySelector(`[data-testid="${rowId}"]`)!;
			const anchors = [...row.querySelectorAll('a[href^="/event/"]')];
			const focusable = anchors.filter((a) => a.getAttribute('tabindex') !== '-1');
			expect(focusable.length, `${rowId}: focusable event links`).toBe(1);
			expect(row.hasAttribute('tabindex'), `${rowId}: row tabindex`).toBe(false);
			expect(row.hasAttribute('role'), `${rowId}: row role`).toBe(false);
		}
	});
});

describe('#471 Recent shows one card until asked', () => {
	beforeEach(() => {
		gotoMock.mockClear();
	});

	const threeRecent = [
		item('p1', '2026-06-10T16:00:00.000Z'),
		item('p2', '2026-06-03T16:00:00.000Z'),
		item('p3', '2026-05-27T16:00:00.000Z')
	];

	const rowIds = (container: Element) =>
		[...container.querySelectorAll('[data-testid^="agenda-recent-row-"]')].map((el) =>
			el.getAttribute('data-testid')
		);

	it('three recent items → exactly one card (recentItems[0]) carrying the button; the press reveals all three in order, removes the button, and never navigates', async () => {
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: threeRecent });

		expect(rowIds(container)).toEqual(['agenda-recent-row-p1']);

		const row = container.querySelector('[data-testid="agenda-recent-row-p1"]')!;
		const button = row.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(button, 'show-more button inside the one visible card').not.toBeNull();
		expect(button!.textContent?.trim()).toBe('[agenda_recent_show_more]');

		await fireEvent.click(button!);

		expect(rowIds(container)).toEqual([
			'agenda-recent-row-p1',
			'agenda-recent-row-p2',
			'agenda-recent-row-p3'
		]);
		expect(container.querySelector('[data-testid="agenda-recent-show-more"]')).toBeNull();

		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('one past event → no button', () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			recentItems: [threeRecent[0]]
		});
		expect(rowIds(container)).toEqual(['agenda-recent-row-p1']);
		expect(container.querySelector('[data-testid="agenda-recent-show-more"]')).toBeNull();
	});

	it('zero recent items + recentEmptyState → the empty state renders unchanged, no rows, no button', () => {
		const probe = createRawSnippet(() => ({
			render: () => '<p data-testid="recent-empty-probe">nothing this season yet</p>'
		}));
		const { container } = render(AgendaList, {
			items: itemSameDay,
			recentItems: [],
			recentEmptyState: probe
		});
		expect(container.querySelector('[data-testid="recent-empty-probe"]')).not.toBeNull();
		expect(rowIds(container)).toEqual([]);
		expect(container.querySelector('[data-testid="agenda-recent-show-more"]')).toBeNull();
	});

	it('Upcoming rows are unaffected in both states (count + first id)', async () => {
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: threeRecent });
		const upcomingIds = () =>
			[...container.querySelectorAll('[data-testid^="agenda-row-"]')].map((el) =>
				el.getAttribute('data-testid')
			);

		expect(upcomingIds()).toEqual(['agenda-row-r1', 'agenda-row-r2']);

		const button = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(button, 'show-more button').not.toBeNull();
		await fireEvent.click(button!);

		expect(upcomingIds()).toEqual(['agenda-row-r1', 'agenda-row-r2']);
	});

	it('justCreatedEventId pointing at a hidden recent row opens the list (all rows render, button gone)', async () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			recentItems: threeRecent,
			justCreatedEventId: 'p3'
		});

		await waitFor(() => {
			expect(rowIds(container)).toEqual([
				'agenda-recent-row-p1',
				'agenda-recent-row-p2',
				'agenda-recent-row-p3'
			]);
		});
		expect(container.querySelector('[data-testid="agenda-recent-show-more"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="agenda-recent-row-p3"] [data-testid="agenda-row-created-mark"]')
		).not.toBeNull();
	});

	it('justCreatedEventId pointing at the VISIBLE first recent row leaves the list collapsed', async () => {
		const { container } = render(AgendaList, {
			items: itemSameDay,
			recentItems: threeRecent,
			justCreatedEventId: 'p1'
		});
		await tick();
		expect(rowIds(container)).toEqual(['agenda-recent-row-p1']);
		expect(container.querySelector('[data-testid="agenda-recent-show-more"]')).not.toBeNull();
	});

	it('pressing the button with the keyboard lands focus on the first newly revealed row, not <body>', async () => {
		const { container } = render(AgendaList, { items: itemSameDay, recentItems: threeRecent });
		const button = container.querySelector<HTMLElement>(
			'[data-testid="agenda-recent-show-more"]'
		)!;
		button.focus();
		expect(document.activeElement).toBe(button);

		await fireEvent.click(button);

		await waitFor(() => {
			const revealed = container.querySelector('[data-testid="agenda-recent-row-p2"]')!;
			expect(revealed.contains(document.activeElement), 'focus inside the revealed row').toBe(
				true
			);
		});
		expect(document.activeElement).not.toBe(document.body);
		expect((document.activeElement as HTMLElement).getAttribute('aria-hidden')).toBeNull();
		expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe(
			'View details for Rehearsal p2'
		);
	});

	it('a fresh render starts collapsed again — the expansion is never persisted', async () => {
		const first = render(AgendaList, { items: itemSameDay, recentItems: threeRecent });
		const button = first.container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(button, 'show-more button').not.toBeNull();
		await fireEvent.click(button!);
		expect(rowIds(first.container)).toHaveLength(3);
		first.unmount();

		const second = render(AgendaList, { items: itemSameDay, recentItems: threeRecent });
		expect(rowIds(second.container)).toEqual(['agenda-recent-row-p1']);
	});
});

describe('#471 i18n — agenda_recent_show_more in all four locales', () => {
	const messages = (locale: string) =>
		JSON.parse(
			readFileSync(resolvePath(process.cwd(), 'messages', `${locale}.json`), 'utf-8')
		) as Record<string, string>;

	it('en and et carry the ruled copy; lv and uk carry a non-empty translation', () => {
		expect(messages('en').agenda_recent_show_more).toBe('Show earlier');
		expect(messages('et').agenda_recent_show_more).toBe('Näita varasemaid');
		for (const locale of ['lv', 'uk']) {
			const value = messages(locale).agenda_recent_show_more;
			expect(typeof value, `${locale}.json agenda_recent_show_more`).toBe('string');
			expect(value.trim(), `${locale}.json agenda_recent_show_more is empty`).not.toBe('');
		}
	});
});
