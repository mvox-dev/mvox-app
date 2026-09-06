// @vitest-environment happy-dom
//
// #262 RED — the agenda's compact schedule times line (surface B; Mihkel
// 2026-09-06 11:12: "it would be great, if subevent times are shown on
// agenda"; Gama's amendment + row-family ruling 5558026158).
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   AgendaList.svelte grows ONE new prop (mirror worksByEventId,
//   AgendaList.svelte:106/149 — the shared AgendaItem type is NOT extended,
//   that would put schedule data one naive edit away from the month view):
//
//     scheduleItemsByEventId?: Record<string, ScheduleItem[]>
//
//   A day-list row whose event has schedule items additionally shows ONE
//   compact chronological line, data-testid="agenda-schedule-line-{eventId}":
//   each item as time + name, '·'-separated (the event-detail tally-line
//   precedent), in the row's secondary text style (the row-duration
//   treatment: text-[10px] text-ink-2). Times render via the ONE legal combo
//   formatTime(tallinnHHMM(new Date(iso)), $timeFormatStore).
//
//   CRITICAL span shape: the line is one span (or one span per 'time name'
//   PAIR) — NEVER a bare clock-only span. AgendaList.spec.ts:775/:807 run
//   containment checks over ALL row spans with negative pins like
//   not.toContain('09:30'); a bare time span is one fixture away from
//   breaking them.
//
//   Row families (PO ruling 5558026158): BOTH — upcoming rows AND the Recent
//   section's rows (its separate template, AgendaList.svelte:347-424). The
//   Recent line inherits the family's dimmer tone — NO special styling.
//   No-item rows in BOTH families stay byte-unchanged (negative pins below).
//
//   event.start_datetime remains the row's primary time, sort key and
//   day-grouping basis — schedule items are display-additive and never move
//   a row or its group (#246 formula disqualification carries).
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';
// The #262 data-layer type — the line's row shape comes from the ONE schedule
// module, never a fork local to the component.
import type { ScheduleItem } from '$lib/schedule/scheduleData';

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
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		agenda_row_link_label: (params) => `View details for ${(params as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

// #251 — app-language seam (same construction as AgendaList.spec.ts): headers
// follow getLocale(); the times line must be locale-INDEPENDENT (formatTime
// takes no locale), pinned below by rendering under all four app languages.
type AppLocale = 'en' | 'et' | 'lv' | 'uk';
const localeMock = vi.hoisted(() => ({
	state: null as { get(k: string): string | undefined; set(k: string, v: string): unknown } | null
}));
vi.mock('$lib/paraglide/runtime.js', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	localeMock.state ??= new SvelteMap<string, string>([['locale', 'en']]);
	return {
		getLocale: () => localeMock.state!.get('locale'),
		setLocale: vi.fn(),
		locales: ['en', 'et', 'lv', 'uk'],
		overwriteGetLocale: vi.fn()
	};
});
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

// Europe/Tallinn is UTC+3 (EEST) on these June dates.
// r1: 2026-06-15T09:00Z = 12:00 Tallinn, Monday June 15.
const R1 = item('r1', '2026-06-15T09:00:00.000Z');
const R2 = item('r2', '2026-06-15T16:00:00.000Z'); // 19:00 Tallinn, same day
// p1 (recent): 2026-06-01T15:00Z = 18:00 Tallinn.
const P1 = item('p1', '2026-06-01T15:00:00.000Z');
const P2 = item('p2', '2026-06-02T15:00:00.000Z');

// r1's schedule: 06:30Z = 09:30 Tallinn, 10:00Z = 13:00 Tallinn — wire order
// deliberately reversed so the line itself must sort chronologically.
const R1_SCHEDULE: ScheduleItem[] = [
	sitem('s2', 'kontsert', '2026-06-15T10:00:00.000Z'),
	sitem('s1', 'kogunemine', '2026-06-15T06:30:00.000Z')
];
// p1's schedule: 14:30Z = 17:30 Tallinn.
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
		// Chronological — never wire order.
		expect(text.indexOf('kogunemine')).toBeLessThan(text.indexOf('kontsert'));
	});

	it('CRITICAL span shape: never a bare clock-only span — every span carrying a schedule time also carries its name', () => {
		// AgendaList.spec.ts:775/:807 run containment checks over ALL row spans
		// (negative pins like not.toContain('09:30')); a separate time-span
		// would be one fixture away from breaking them.
		const { container } = render(AgendaList, {
			items: [R1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		// Positive first (RED trips here): the line must exist at all…
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
		// Positive first (RED trips here) — the fence is only meaningful once
		// the with-items sibling actually renders its line.
		expect(line(container as HTMLElement, 'r1')).not.toBeNull();
		expect(line(container as HTMLElement, 'r2')).toBeNull();
		// An event id mapped to an EMPTY array is 'no items' too.
		const { container: c2 } = render(AgendaList, {
			items: [R2],
			scheduleItemsByEventId: { r2: [] }
		});
		expect(line(c2 as HTMLElement, 'r2')).toBeNull();
	});

	it('the prop omitted entirely → zero times lines anywhere (the pre-#262 agenda)', () => {
		// Positive control first (RED trips here): given the prop, lines render…
		const { container: withProp } = render(AgendaList, {
			items: [R1],
			scheduleItemsByEventId: { r1: R1_SCHEDULE }
		});
		expect(
			withProp.querySelectorAll('[data-testid^="agenda-schedule-line-"]').length
		).toBeGreaterThan(0);
		// …without it, none do.
		const { container } = render(AgendaList, { items: [R1, R2], recentItems: [P1] });
		expect(container.querySelectorAll('[data-testid^="agenda-schedule-line-"]')).toHaveLength(0);
	});
});

describe('#262 — Recent rows carry the SAME line (PO ruling 5558026158: both families)', () => {
	it("a recent row with items shows the times line inside the Recent template's row", () => {
		const { container } = render(AgendaList, {
			items: [R1],
			recentItems: [P1, P2],
			scheduleItemsByEventId: { p1: P1_SCHEDULE }
		});
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

	it('recent rows with no items stay line-free (the other half of the both-families fence)', () => {
		const { container } = render(AgendaList, {
			items: [],
			recentItems: [P1, P2],
			scheduleItemsByEventId: { p1: P1_SCHEDULE }
		});
		// Positive first (RED trips here): p1's line renders…
		expect(line(container as HTMLElement, 'p1')).not.toBeNull();
		// …p2's bare row stays byte-unchanged.
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
		// The schedule time reaches the row ONLY inside its pair — never bare,
		// in either clock mode.
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
		// rA starts 10:00 Tallinn, rB 12:00 — but rB carries a 07:00 item.
		// Row order must stay rA, rB (start_datetime, never min(schedule)).
		const rA = item('rA', '2026-06-15T07:00:00.000Z'); // 10:00 Tallinn
		const rB = item('rB', '2026-06-15T09:00:00.000Z'); // 12:00 Tallinn
		const { container } = render(AgendaList, {
			items: [rA, rB],
			scheduleItemsByEventId: { rB: [sitem('sx', 'kogunemine', '2026-06-15T04:00:00.000Z')] }
		});
		// The line renders (RED trips here) — the pin below is about ORDER.
		expect(line(container as HTMLElement, 'rB')).not.toBeNull();
		const rowIds = [...container.querySelectorAll('[data-testid^="agenda-row-"]')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(rowIds).toEqual(['agenda-row-rA', 'agenda-row-rB']);
	});

	it("a schedule item on the PREVIOUS Tallinn calendar day does not move the row's day group or spawn a new header", () => {
		// Item at 2026-06-14T18:00Z = 21:00 Tallinn June 14; the event itself is
		// June 15. Exactly ONE header, and it is June 15's.
		const { container } = render(AgendaList, {
			items: [R2],
			scheduleItemsByEventId: { r2: [sitem('sy', 'kogunemine', '2026-06-14T18:00:00.000Z')] }
		});
		// The line renders (RED trips here) — the pin below is about GROUPING.
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
			// The line: pure data (clock digits + item names), same in every language.
			expect(line(container as HTMLElement, 'r1')!.textContent?.trim()).toContain(
				'09:30 kogunemine'
			);
			// The header keeps its #251 localization, untouched by the new line.
			expect(
				container.querySelector('[data-testid="agenda-date-header"]')?.textContent?.trim()
			).toBe(expectedHeader[locale]);
		});
	}
});

// (*MVOX:Tallis* — #262 RED: agenda compact times line, both row families)
