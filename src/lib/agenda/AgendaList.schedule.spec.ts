// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';
import type { ScheduleItem } from '$lib/schedule/scheduleData';
import { localeMock } from '$lib/testing/mocks/session';

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
afterEach(async () => {
	setAppLocale('en');
	const { timeFormatStore } = await import('$lib/preferences/timeFormat');
	timeFormatStore.set('24h');
});

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

function sitem(id: string, name: string, datetime: string): ScheduleItem {
	return { id, name, datetime };
}

const R1 = item('r1', '2026-06-15T09:00:00.000Z');
const R2 = item('r2', '2026-06-15T16:00:00.000Z');
const P1 = item('p1', '2026-06-01T15:00:00.000Z');
const P2 = item('p2', '2026-06-02T15:00:00.000Z');

const R1_SCHEDULE: ScheduleItem[] = [
	sitem('s2', 'kontsert', '2026-06-15T10:00:00.000Z'),
	sitem('s1', 'kogunemine', '2026-06-15T06:30:00.000Z')
];
const P1_SCHEDULE: ScheduleItem[] = [sitem('s3', 'kogunemine', '2026-06-01T14:30:00.000Z')];

function line(container: HTMLElement, eventId: string): HTMLElement | null {
	return container.querySelector(`[data-testid="agenda-schedule-line-${eventId}"]`);
}

describe('#262 — upcoming rows: the compact times line', () => {
	it("renders time + name pairs, '·'-separated, chronological, INSIDE the event's row", () => {
		const { container } = render(AgendaList, {
			items: [R1, R2],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		const row = container.querySelector('[data-testid="agenda-row-r1"]')!;
		const timesLine = line(container as HTMLElement, 'r1');
		expect(timesLine, 'the times line must exist on the with-items row').not.toBeNull();
		expect(row.contains(timesLine)).toBe(true);
		const text = timesLine!.textContent ?? '';
		expect(text).toContain('09:30 kogunemine');
		expect(text).toContain('13:00 kontsert');
		expect(text).toContain('·');
		expect(text.indexOf('kogunemine')).toBeLessThan(text.indexOf('kontsert'));
	});

	it('CRITICAL span shape: never a bare clock-only span — every span carrying a schedule time also carries its name', () => {
		const { container } = render(AgendaList, {
			items: [R1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		expect(line(container as HTMLElement, 'r1')).not.toBeNull();
		const row = container.querySelector('[data-testid="agenda-row-r1"]')!;
		const spanTexts = [...row.querySelectorAll('span')].map((s) => s.textContent?.trim() ?? '');
		expect(spanTexts).not.toContain('09:30');
		expect(spanTexts).not.toContain('13:00');
		for (const text of spanTexts) {
			if (text.includes('09:30')) expect(text).toContain('kogunemine');
		}
	});

	it("the line wears the row's secondary text style (the row-duration treatment: text-[10px] text-ink-2)", () => {
		const { container } = render(AgendaList, {
			items: [R1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		const timesLine = line(container as HTMLElement, 'r1')!;
		expect(timesLine.className).toContain('text-[10px]');
		expect(timesLine.className).toContain('text-ink-2');
	});

	it('rows for events with NO schedule items render no times line at all (byte-unchanged fence, made testable)', () => {
		const { container } = render(AgendaList, {
			items: [R1, R2],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		expect(line(container as HTMLElement, 'r1')).not.toBeNull();
		expect(line(container as HTMLElement, 'r2')).toBeNull();
		const { container: c2 } = render(AgendaList, {
			items: [R2],
			scheduleItemsByEventId: { r2: [] }
		});
		expect(line(c2 as HTMLElement, 'r2')).toBeNull();
	});

	it('the prop omitted entirely → zero times lines anywhere (the pre-#262 agenda)', () => {
		const { container: withProp } = render(AgendaList, {
			items: [R1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		expect(
			withProp.querySelectorAll('[data-testid^="agenda-schedule-line-"]').length
		).toBeGreaterThan(0);
		const { container } = render(AgendaList, { items: [R1, R2], recentItems: [P1] });
		expect(container.querySelectorAll('[data-testid^="agenda-schedule-line-"]')).toHaveLength(0);
	});
});

describe('#262 — Recent rows carry the SAME line (PO ruling 5558026158: both families)', () => {
	it("a recent row with items shows the times line inside the Recent template's row", async () => {
		const { container } = render(AgendaList, {
			items: [R1],
			recentItems: [P1, P2],
			scheduleItemsByEventId: { p1: P1_SCHEDULE }
		});
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		const recentRow = container.querySelector('[data-testid="agenda-recent-row-p1"]')!;
		const timesLine = line(container as HTMLElement, 'p1');
		expect(timesLine, 'the Recent row must carry the times line').not.toBeNull();
		expect(recentRow.contains(timesLine)).toBe(true);
		expect(timesLine!.textContent).toContain('17:30 kogunemine');
	});

	it("NO special styling — the Recent line's classes are IDENTICAL to the upcoming line's (it just inherits the family's tone)", () => {
		const { container } = render(AgendaList, {
			items: [R1],
			recentItems: [P1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE, p1: P1_SCHEDULE }
		});
		const upcomingLine = line(container as HTMLElement, 'r1')!;
		const recentLine = line(container as HTMLElement, 'p1')!;
		expect(recentLine.className).toBe(upcomingLine.className);
	});

	it('recent rows with no items stay line-free (the other half of the both-families fence)', async () => {
		const { container } = render(AgendaList, {
			items: [],
			recentItems: [P1, P2],
			scheduleItemsByEventId: { p1: P1_SCHEDULE }
		});
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		expect(line(container as HTMLElement, 'p1')).not.toBeNull();
		expect(line(container as HTMLElement, 'p2')).toBeNull();
	});

	it("span-shape pin holds in the Recent family too, in AM/PM mode — the exact AgendaList.spec.ts:807 check pattern must stay satisfiable", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		const { container } = render(AgendaList, {
			items: [],
			recentItems: [P1],
			scheduleItemsByEventId: { p1: P1_SCHEDULE }
		});
		const recentRow = container.querySelector('[data-testid="agenda-recent-row-p1"]')!;
		const spanTexts = [...recentRow.querySelectorAll('span')].map(
			(s) => s.textContent?.trim() ?? ''
		);
		expect(spanTexts).not.toContain('17:30');
		expect(spanTexts).not.toContain('5:30 PM');
		expect(recentRow.textContent).toContain('5:30 PM kogunemine');
	});
});

describe('#262 — times follow the #207/#220 preference', () => {
	it("'ampm': the line renders '9:30 AM kogunemine · 1:00 PM kontsert' — no 24h digits left", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		const { container } = render(AgendaList, {
			items: [R1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		const text = line(container as HTMLElement, 'r1')!.textContent ?? '';
		expect(text).toContain('9:30 AM kogunemine');
		expect(text).toContain('1:00 PM kontsert');
		expect(text).not.toContain('09:30');
		expect(text).not.toContain('13:00');
	});

	it("'24h' (the unset default): 24h digits, no AM/PM anywhere in the line", () => {
		const { container } = render(AgendaList, {
			items: [R1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		const text = line(container as HTMLElement, 'r1')!.textContent ?? '';
		expect(text).toContain('09:30 kogunemine');
		expect(text).not.toMatch(/\b(AM|PM)\b/);
	});
});

describe('#262 — start_datetime stays the sort key and day-grouping basis', () => {
	it('a schedule item EARLIER than another event does not reorder the rows', () => {
		const rA = item('rA', '2026-06-15T07:00:00.000Z');
		const rB = item('rB', '2026-06-15T09:00:00.000Z');
		const { container } = render(AgendaList, {
			items: [rA, rB],
			scheduleItemsByEventId: { rB: [sitem('sx', 'kogunemine', '2026-06-15T04:00:00.000Z')] }
		});
		expect(line(container as HTMLElement, 'rB')).not.toBeNull();
		const rowIds = [...container.querySelectorAll('[data-testid^="agenda-row-"]')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(rowIds).toEqual(['agenda-row-rA', 'agenda-row-rB']);
	});

	it("a schedule item on the PREVIOUS Tallinn calendar day does not move the row's day group or spawn a new header", () => {
		const { container } = render(AgendaList, {
			items: [R2],
			scheduleItemsByEventId: { r2: [sitem('sy', 'kogunemine', '2026-06-14T18:00:00.000Z')] }
		});
		expect(line(container as HTMLElement, 'r2')).not.toBeNull();
		const headers = container.querySelectorAll('[data-testid="agenda-date-header"]');
		expect(headers).toHaveLength(1);
		expect(headers[0].textContent?.trim()).toBe('Monday, June 15');
	});
});

describe('#262 — the line is locale-INDEPENDENT (formatTime takes no locale; day headers untouched)', () => {
	const expectedHeader: Record<AppLocale, string> = {
		en: 'Monday, June 15',
		et: 'esmaspäev, 15. juuni',
		lv: 'pirmdiena, 15. jūnijs',
		uk: 'понеділок, 15 червня'
	};
	for (const locale of ['et', 'en', 'lv', 'uk'] as AppLocale[]) {
		it(`app language '${locale}': the times line is byte-identical while the day header localizes`, () => {
			setAppLocale(locale);
			const { container } = render(AgendaList, {
				items: [R1],
				scheduleItemsByEventId: { r1: R1_SCHEDULE }
			});
			expect(line(container as HTMLElement, 'r1')!.textContent?.trim()).toContain(
				'09:30 kogunemine'
			);
			expect(
				container.querySelector('[data-testid="agenda-date-header"]')?.textContent?.trim()
			).toBe(expectedHeader[locale]);
		});
	}
});
