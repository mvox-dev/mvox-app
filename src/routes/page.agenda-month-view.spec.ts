// @vitest-environment happy-dom
//
// #247 RED — INTEGRATION: the month overview of the agenda, behind a
// Nimekiri | Kuu segmented control sitting with the #214 filter chips.
//
// Real +page.svelte + real AgendaList; only the data seams are mocked (same
// harness family as page.agenda-filter.spec.ts / page.agenda-header-locale
// .spec.ts). The issue's "Ruled 2026-09-06" section + Gama's scope comment ARE
// the contract this spec pins:
//
//   - Toggle (ruling 9/10): a two-state segmented control — two native
//     buttons, one active — reading the ruled labels via NEW locale keys
//     (et "Nimekiri" | "Kuu"). It sits WITH the #214 filter chips; the day
//     list stays the DEFAULT; the choice persists per-device via the #207
//     idiom (src/lib/preferences/agendaView.ts — see agendaView.spec.ts for
//     the store's own sanitize/SSR pins).
//   - SCOPE (Gama's ruling comment): the month overview consumes `items`
//     (upcoming) ONLY. recentItems are NEVER rendered in month mode — the
//     current month deliberately shows only its remainder ("what's coming"),
//     the Recent window stays a day-list-only concern.
//   - The compact row (done-when 3 + ruling 11): EXACTLY four things —
//     short-weekday key + day-of-month number (the month is named once, in
//     the heading — no full/ISO date), event title, type badge. No time, no
//     duration, no location, no works, no RSVP, no attendance. "If a row
//     looks bare, that is the feature."
//   - Weekday letters come from NEW short-weekday locale keys (the charAt(0)
//     trap: en/lv/uk collide on first letters; et alone does not) — and from
//     the TALLINN calendar day, same timezone discipline as the day list.
//   - Months group ascending by Tallinn YYYY-MM (the seriesCreateMonthGroups
//     idiom), heading localized via the APP language (getLocale — #251's
//     rule, never the device locale).
//   - Type badges reuse #211's eventTypeBadgeClass — never a forked hue map.
//   - The #214 filter chips apply to the month overview identically (free by
//     construction: month mode consumes the same pre-filtered `items` prop).
//   - Rows link to the same event detail page as the day-list rows.
//   - Day-list mode is BYTE-UNCHANGED — the mode is additive; every
//     pre-existing agenda/AgendaList spec is the fence and stays green
//     untouched. This spec only pins that toggling away and back restores
//     the day list (Recent included).
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';
// #211's ONE scheme — the month-row badge must consume the same map the
// day-list badges and the chips do, never a second hand-typed copy.
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		// Distinct markers: every asserted string must go through paraglide,
		// never raw/hardcoded copy. Weekday letters ESPECIALLY — a charAt(0)
		// of the full-day keys, or an Intl weekday:narrow, can never produce
		// these markers.
		agenda_view_list: () => '[msg:view-list]',
		agenda_view_month: () => '[msg:view-month]',
		agenda_view_toggle_label: () => '[msg:view-toggle]',
		agenda_weekday_short_0: () => '[msg:wd-0]',
		agenda_weekday_short_1: () => '[msg:wd-1]',
		agenda_weekday_short_2: () => '[msg:wd-2]',
		agenda_weekday_short_3: () => '[msg:wd-3]',
		agenda_weekday_short_4: () => '[msg:wd-4]',
		agenda_weekday_short_5: () => '[msg:wd-5]',
		agenda_weekday_short_6: () => '[msg:wd-6]',
		agenda_filter_group_label: () => '[msg:filter-group]',
		agenda_filter_all: () => '[msg:filter-all]',
		// #214's two DIFFERENT truths, as two distinguishable markers — the whole
		// point of the review finding is that month mode was rendering the second
		// where it owed the first.
		agenda_filter_empty: () => '[msg:filter-empty]',
		agenda_empty_no_events: () => '[msg:empty-no-events]',
		agenda_duration_min: (params) => `[msg:dur:${(params as { minutes: number }).minutes}]`,
		agenda_row_link_label: (params) => `[msg:link:${(params as { event: string }).event}]`,
		agenda_row_link_label_unnamed: () => '[msg:link-unnamed]',
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		event_type_social: () => '[msg:social]'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

// The APP-language seam (#251): month headings must follow getLocale(), never
// the device locale — happy-dom's device locale is en-US, so every Estonian
// heading assertion below proves app-locale wiring by construction. Same
// SvelteMap-backed mock as page.agenda-header-locale.spec.ts.
type AppLocale = 'en' | 'et' | 'lv' | 'uk';
const localeMock = vi.hoisted(() => ({
	state: null as { get(k: string): string | undefined; set(k: string, v: string): unknown } | null
}));
vi.mock('$lib/paraglide/runtime.js', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	localeMock.state ??= new SvelteMap<string, string>([['locale', 'et']]);
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

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p1' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function item(
	id: string,
	name: string,
	startDatetime: string,
	eventType: string,
	location = ''
): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location,
		conductors: [],
		owners: [],
		editors: [],
		eventType
	} as AgendaItem;
}

// Far-future fixtures with VERIFIED Tallinn calendar facts (Europe/Tallinn,
// EEST +3 on these dates):
//   2030-06-10T16:00Z → Tallinn 2030-06-10, Monday    → weekday key _1
//   2030-06-12T18:00Z → Tallinn 2030-06-12, Wednesday → weekday key _3
//   2030-06-30T22:00Z → Tallinn 2030-07-01 01:00, Monday — the MONTH-BOUNDARY
//     pin: in UTC this instant is still Sunday, June 30. A naive
//     startDatetime.slice(0, 7) (or a UTC getDay()) files it under June with
//     weekday key _0; the Tallinn calendar files it under JULY, Monday (_1) —
//     exactly the day-list's own timezone discipline (groupKeyFmt).
//   2030-07-03T16:00Z → Tallinn 2030-07-03, Wednesday → weekday key _3
const JUN_MON = item('jun-mon', 'Esmaspäevane proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const JUN_WED = item('jun-wed', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert', 'Kammersaal');
const JUL_BOUNDARY = item('jul-boundary', 'Ööproov', '2030-06-30T22:00:00.000Z', 'rehearsal');
const JUL_WED = item('jul-wed', 'Suvekontsert', '2030-07-03T16:00:00.000Z', 'concert');
const RECENT_SOCIAL = item('rec-soc', 'Suvepidu', '2026-05-01T18:00:00.000Z', 'social');
// A PAST concert: it puts the concert chip on screen (chips derive from the
// whole agenda, recent included) while leaving the UPCOMING set concert-free —
// the exact reachable shape of the #214-in-month-mode finding.
const RECENT_CONCERT = item('rec-con', 'Talvekontsert', '2026-04-20T18:00:00.000Z', 'concert');

const ALL_UPCOMING = [JUN_MON, JUN_WED, JUL_BOUNDARY, JUL_WED];

/** The view toggle GROUP — pinned as a native role="group" whose accessible
 *  name is the localized agenda_view_toggle_label (the #214 chip-group idiom;
 *  standing rules 1/2 — native controls, no hand-rolled widget). */
function viewToggle(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[role="group"][aria-label="[msg:view-toggle]"]');
}

function viewButton(container: HTMLElement, testid: string): HTMLButtonElement {
	const el = container.querySelector(`[data-testid="${testid}"]`);
	expect(el, `toggle button ${testid} must exist`).not.toBeNull();
	return el as HTMLButtonElement;
}

function chipGroup(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[role="group"][aria-label="[msg:filter-group]"]');
}

function monthGroups(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid="agenda-month-group"]'));
}

function monthHeaders(container: HTMLElement): (string | undefined)[] {
	return Array.from(container.querySelectorAll('[data-testid="agenda-month-header"]')).map((el) =>
		el.textContent?.trim()
	);
}

function monthRowIds(root: ParentNode): string[] {
	return Array.from(root.querySelectorAll('[data-testid^="agenda-month-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-month-row-', '')
	);
}

function monthRow(container: HTMLElement, id: string): HTMLElement {
	const el = container.querySelector(`[data-testid="agenda-month-row-${id}"]`);
	expect(el, `month row for ${id} must exist`).not.toBeNull();
	return el as HTMLElement;
}

function dayListRowIds(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-row-"]')).map((el) =>
		(el.getAttribute('data-testid') as string).replace('agenda-row-', '')
	);
}

async function renderAgenda(
	upcoming: AgendaItem[],
	recent: AgendaItem[] = []
): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ upcoming, recent }));
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
	});
	return container as HTMLElement;
}

async function switchToMonth(container: HTMLElement): Promise<void> {
	await fireEvent.click(viewButton(container, 'agenda-view-month'));
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

beforeEach(() => {
	setAppLocale('et');
});

afterEach(async () => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	// The view-mode preference is module-level state (the #207 idiom): reset it
	// to the default so one test's Kuu choice never leaks into the next.
	// Dynamic import + catch: pre-GREEN the module does not exist yet, and this
	// afterEach must not turn every RED failure into an import crash.
	const prefs = await import('$lib/preferences/agendaView').catch(() => null);
	prefs?.setAgendaView('list');
	if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('#247 — the Nimekiri|Kuu toggle (ruled: segmented control, WITH the chips, day list default)', () => {
	it('renders a two-state segmented control of native buttons; the day list is active by default', async () => {
		const container = await renderAgenda(ALL_UPCOMING, [RECENT_SOCIAL]);

		const toggle = viewToggle(container);
		expect(toggle, 'view toggle group must exist').not.toBeNull();

		// Exactly two buttons — a two-state control, not a widget family.
		const buttons = Array.from(toggle!.querySelectorAll('button'));
		expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual([
			'agenda-view-list',
			'agenda-view-month'
		]);
		for (const btn of buttons) {
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
			expect(btn.getAttribute('aria-pressed')).not.toBeNull();
		}
		// The ruled labels arrive via the NEW keys, never hardcoded copy.
		expect(buttons.map((b) => b.textContent?.trim())).toEqual([
			'[msg:view-list]',
			'[msg:view-month]'
		]);

		// Default = the day list (ruling 9), month not pressed.
		expect(viewButton(container, 'agenda-view-list').getAttribute('aria-pressed')).toBe('true');
		expect(viewButton(container, 'agenda-view-month').getAttribute('aria-pressed')).toBe('false');
		expect(container.querySelector('[data-testid="agenda-day-group"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent"]')).not.toBeNull();
		expect(monthGroups(container)).toEqual([]);
	});

	it('sits WITH the #214 filter chips: same parent element, above the agenda list', async () => {
		const container = await renderAgenda(ALL_UPCOMING, [RECENT_SOCIAL]);

		const toggle = viewToggle(container) as HTMLElement;
		const chips = chipGroup(container) as HTMLElement;
		expect(toggle).not.toBeNull();
		expect(chips).not.toBeNull();
		// "A small view toggle sitting with the #214 filter chips" (ruling 9) —
		// one control strip, not a toggle exiled to some other corner of the page.
		expect(toggle.parentElement).toBe(chips.parentElement);

		const agendaList = container.querySelector('[data-testid="agenda-list"]') as HTMLElement;
		expect(
			// eslint-disable-next-line no-bitwise
			toggle.compareDocumentPosition(agendaList) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('tap Kuu → month overview replaces the day list; tap Nimekiri → the day list (Recent included) is back', async () => {
		const container = await renderAgenda(ALL_UPCOMING, [RECENT_SOCIAL]);

		await switchToMonth(container);

		expect(viewButton(container, 'agenda-view-month').getAttribute('aria-pressed')).toBe('true');
		expect(viewButton(container, 'agenda-view-list').getAttribute('aria-pressed')).toBe('false');
		expect(monthGroups(container).length).toBeGreaterThan(0);
		// The day-grouped list is fully gone in month mode — groups, headers, rows.
		expect(container.querySelector('[data-testid="agenda-day-group"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-date-header"]')).toBeNull();
		expect(dayListRowIds(container)).toEqual([]);

		await fireEvent.click(viewButton(container, 'agenda-view-list'));

		// Back exactly as it was — the mode is additive, the day list untouched.
		expect(viewButton(container, 'agenda-view-list').getAttribute('aria-pressed')).toBe('true');
		expect(monthGroups(container)).toEqual([]);
		expect(container.querySelector('[data-testid="agenda-day-group"]')).not.toBeNull();
		expect(dayListRowIds(container)).toEqual(['jun-mon', 'jun-wed', 'jul-boundary', 'jul-wed']);
		expect(container.querySelector('[data-testid="agenda-recent"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent-row-rec-soc"]')).not.toBeNull();
	});
});

describe('#247 — SCOPE (Gama ruling): month mode consumes `items` ONLY, never recentItems', () => {
	it('recentItems are absent from month mode even when supplied — no Recent section, no recent rows', async () => {
		const container = await renderAgenda(ALL_UPCOMING, [RECENT_SOCIAL]);

		await switchToMonth(container);

		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent-header"]')).toBeNull();
		expect(container.querySelectorAll('[data-testid^="agenda-recent-row-"]').length).toBe(0);
		// The recent event's id never leaks into the month rows either.
		expect(monthRowIds(container)).not.toContain('rec-soc');
	});

	it('the current month shows only its REMAINDER: past days live in recent and stay off-screen (deliberate, not a gap)', async () => {
		// A fixture spanning past + future of the CURRENT month, delivered the
		// way the real producer delivers it: the past day arrives in `recent`,
		// the future day in `upcoming`. The pinned behaviour is Gama's ruling —
		// the month view answers "what is coming", so it renders EXACTLY the
		// upcoming set and the past day of the very same month is absent.
		const now = Date.now();
		const upNear = item(
			'up-near',
			'Homne proov',
			new Date(now + 26 * 60 * 60 * 1000).toISOString(),
			'rehearsal'
		);
		const recNear = item(
			'rec-near',
			'Eilne proov',
			new Date(now - 26 * 60 * 60 * 1000).toISOString(),
			'rehearsal'
		);
		const container = await renderAgenda([upNear, JUN_MON], [recNear, RECENT_SOCIAL]);

		await switchToMonth(container);

		expect(monthRowIds(container)).toEqual(['up-near', 'jun-mon']);
		expect(container.querySelector('[data-testid="agenda-month-row-rec-near"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
	});
});

describe('#247 — month grouping: ascending Tallinn YYYY-MM, app-locale headings', () => {
	it('groups ascending with one localized heading per month — Estonian headings while the device locale is en-US (#251 rule)', async () => {
		const container = await renderAgenda(ALL_UPCOMING);

		await switchToMonth(container);

		// Two months, ascending, named once each in the APP language (device
		// locale is en-US — an Intl call without getLocale() cannot produce
		// these strings).
		expect(monthHeaders(container)).toEqual(['juuni 2030', 'juuli 2030']);

		// Group membership pins the Tallinn month boundary: 2030-06-30T22:00Z is
		// July 1 in Tallinn — a UTC (or string-slice) grouping would file it
		// under June.
		const [june, july] = monthGroups(container);
		expect(monthRowIds(june)).toEqual(['jun-mon', 'jun-wed']);
		expect(monthRowIds(july)).toEqual(['jul-boundary', 'jul-wed']);

		// Overall row order = the upcoming list's own chronological order.
		expect(monthRowIds(container)).toEqual(['jun-mon', 'jun-wed', 'jul-boundary', 'jul-wed']);
	});

	it('the heading follows the app language: en renders "June 2030"', async () => {
		setAppLocale('en');
		const container = await renderAgenda([JUN_MON, JUN_WED]);

		await switchToMonth(container);

		expect(monthHeaders(container)).toEqual(['June 2030']);
	});
});

describe('#247 — the compact row: EXACTLY weekday key + day number + title + type badge', () => {
	it('renders short-weekday key + day-of-month + title + #211 badge — and nothing else', async () => {
		const container = await renderAgenda(ALL_UPCOMING);

		await switchToMonth(container);

		const row = monthRow(container, 'jun-wed');
		const text = row.textContent ?? '';

		// Ruling 11: short weekday key + day-of-month number (e.g. "N 15") —
		// Wednesday = key _3, day 12. The weekday precedes the day number.
		expect(text).toMatch(/\[msg:wd-3\]\s*12(?!\d)/);
		// The month is named once, in the heading: no full/ISO date in the row.
		expect(text).not.toContain('2030-06-12');
		expect(text).not.toContain('2030');
		// Title.
		expect(text).toContain('Kevadkontsert');
		// Type badge: the SHARED #211 classes, verbatim, and the localized label.
		const badge = row.querySelector('[data-testid="event-type-badge-jun-wed"]');
		expect(badge, 'month row must carry the type badge').not.toBeNull();
		expect(badge?.textContent?.trim()).toBe('[msg:concert]');
		const concertClasses = eventTypeBadgeClass('concert').split(/\s+/).filter(Boolean);
		expect(concertClasses.length).toBeGreaterThan(0);
		for (const cls of concertClasses) {
			expect(badge?.classList.contains(cls), `badge must carry ${cls}`).toBe(true);
		}

		// NOTHING ELSE (done-when 3 — "if a row looks bare, that is the
		// feature"): no time, no duration, no location, no interactive controls.
		expect(text).not.toMatch(/\d{1,2}:\d{2}/); // no clock time
		expect(text).not.toContain('[msg:dur'); // no duration line
		expect(text).not.toContain('Kammersaal'); // no location (fixture has one)
		expect(row.querySelectorAll('button').length).toBe(0); // no RSVP/attendance/works controls
	});

	// #247 review F2 — the date column must FIT its worst case. Content is up to
	// five characters ('Нд 30' in uk, 'Se 28' in lv, 'Su 30' in en; et's single
	// letters are the narrow case), which at text-xs monospace runs ~36px — past
	// the old w-8 (32px). The span is `shrink-0` with no clipping, so an
	// undersized column does not truncate, it OVERRUNS the title beside it.
	// Class-token assertions (the #250 typography-spec idiom), since happy-dom
	// does no layout: the contract is "no fixed 32px cap on the date column".
	it('the date column is wide enough for a two-character weekday + two-digit day', async () => {
		const container = await renderAgenda(ALL_UPCOMING);

		await switchToMonth(container);

		const date = monthRow(container, 'jun-wed').querySelector<HTMLElement>(
			'[data-testid="month-row-date"]'
		);
		expect(date, 'the month row must have a date column').not.toBeNull();
		expect(date!.classList.contains('w-8'), 'w-8 (32px) cannot hold "Нд 30"').toBe(false);
		expect(date!.classList.contains('min-w-[3rem]')).toBe(true);
		// It still may not shrink — the column aligns down the whole list.
		expect(date!.classList.contains('shrink-0')).toBe(true);
	});

	it('the weekday key is the TALLINN weekday: the boundary event renders as Monday the 1st, not UTC Sunday the 30th', async () => {
		const container = await renderAgenda(ALL_UPCOMING);

		await switchToMonth(container);

		const row = monthRow(container, 'jul-boundary');
		const text = row.textContent ?? '';
		expect(text).toMatch(/\[msg:wd-1\]\s*0?1(?!\d)/); // Tallinn: Monday, July 1 (padding unpinned)
		expect(text).not.toContain('[msg:wd-0]'); // UTC would say Sunday...
		expect(text).not.toContain('30'); // ...June 30
	});

	it('rows link to the same event detail page as the day list, with the localized accessible name', async () => {
		const container = await renderAgenda(ALL_UPCOMING);

		await switchToMonth(container);

		for (const fixture of ALL_UPCOMING) {
			const row = monthRow(container, fixture.id);
			expect(
				row.querySelector(`a[href="/event/${fixture.id}"]`),
				`month row ${fixture.id} must link to its event detail`
			).not.toBeNull();
		}
		expect(
			monthRow(container, 'jun-wed').querySelector('a[aria-label="[msg:link:Kevadkontsert]"]')
		).not.toBeNull();
	});
});

describe('#247 — the #214 filter chips govern the month overview identically', () => {
	it('chips stay visible in month mode; toggling a type shrinks the month rows and back', async () => {
		const container = await renderAgenda(ALL_UPCOMING, [RECENT_SOCIAL]);

		await switchToMonth(container);
		expect(chipGroup(container), 'chips must stay with the month view').not.toBeNull();
		expect(monthRowIds(container)).toEqual(['jun-mon', 'jun-wed', 'jul-boundary', 'jul-wed']);

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-filter-concert"]') as HTMLElement
		);

		// Same upstream mechanism as the day list: only concert rows remain,
		// in both months.
		expect(monthRowIds(container)).toEqual(['jun-wed', 'jul-wed']);

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-filter-concert"]') as HTMLElement
		);
		expect(monthRowIds(container)).toEqual(['jun-mon', 'jun-wed', 'jul-boundary', 'jul-wed']);
	});

	// #247 review F1 — #214's rule is about the AGENDA, not about one of its two
	// views. A filter that empties the upcoming set is a different truth than an
	// agenda with nothing coming: the collective HAS events, the filter hid them.
	// Month mode used to render the flat "no upcoming events" line here, with no
	// cue that the tapped chip caused it.
	it('a chip that empties the upcoming set renders the FILTER-empty copy, not "no upcoming events"', async () => {
		// Upcoming is all rehearsals; the only concert is a PAST one, so the
		// concert chip is on screen and tapping it empties the month view.
		const container = await renderAgenda([JUN_MON, JUL_BOUNDARY], [RECENT_CONCERT]);

		await switchToMonth(container);
		expect(monthRowIds(container)).toEqual(['jun-mon', 'jul-boundary']);

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-filter-concert"]') as HTMLElement
		);

		expect(monthRowIds(container)).toEqual([]);
		const filterEmpty = container.querySelector('[data-testid="agenda-filter-empty"]');
		expect(filterEmpty, 'month mode must honour #214s filtered-empty override').not.toBeNull();
		expect(filterEmpty?.textContent).toContain('[msg:filter-empty]');
		// ...and must NOT claim the agenda itself is empty.
		expect(container.querySelector('[data-testid="agenda-empty"]')).toBeNull();
		expect(container.textContent).not.toContain('[msg:empty-no-events]');

		// Clearing the filter brings the rows back — the override is scoped to an
		// active filter, it does not become the month view's permanent empty state.
		await fireEvent.click(
			container.querySelector('[data-testid="agenda-filter-all"]') as HTMLElement
		);
		expect(monthRowIds(container)).toEqual(['jun-mon', 'jul-boundary']);
		expect(container.querySelector('[data-testid="agenda-filter-empty"]')).toBeNull();
	});

	it('with NO filter active, a genuinely empty upcoming set still reads "no upcoming events"', async () => {
		// The other half of the same fence: the override must not leak into the
		// unfiltered case. Recent-only agenda → chips (and the toggle) exist, the
		// filter is 'all', upcoming is genuinely empty.
		const container = await renderAgenda([], [RECENT_CONCERT]);

		await switchToMonth(container);

		const empty = container.querySelector('[data-testid="agenda-empty"]');
		expect(empty, 'unfiltered empty month view keeps its own default copy').not.toBeNull();
		expect(empty?.textContent).toContain('[msg:empty-no-events]');
		expect(container.querySelector('[data-testid="agenda-filter-empty"]')).toBeNull();
	});
});

describe('#247 — per-device persistence (the #207 idiom, ruling 9)', () => {
	it("tapping Kuu persists 'month' to localStorage; tapping Nimekiri persists 'list'", async () => {
		const container = await renderAgenda(ALL_UPCOMING);

		await switchToMonth(container);
		expect(localStorage.getItem('mvox.agenda_view')).toBe('month');

		await fireEvent.click(viewButton(container, 'agenda-view-list'));
		expect(localStorage.getItem('mvox.agenda_view')).toBe('list');
	});

	it('the choice survives a re-mount: a fresh render opens straight in month mode, no click', async () => {
		const first = await renderAgenda(ALL_UPCOMING);
		await switchToMonth(first);
		cleanup();

		// Fresh mount of the whole page — the preference store (not component
		// state) must carry the choice. agendaView.spec.ts pins the other half:
		// the store itself initializes from a sanitized, SSR-safe localStorage
		// read, so together this closes the reload loop.
		const container = await renderAgenda(ALL_UPCOMING);
		expect(viewButton(container, 'agenda-view-month').getAttribute('aria-pressed')).toBe('true');
		expect(monthGroups(container).length).toBeGreaterThan(0);
		expect(container.querySelector('[data-testid="agenda-day-group"]')).toBeNull();
	});
});

describe('#247 — the new locale keys exist in all four locales', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const WEEKDAY_KEYS = [0, 1, 2, 3, 4, 5, 6].map((day) => `agenda_weekday_short_${day}`);
	const TOGGLE_KEYS = ['agenda_view_list', 'agenda_view_month', 'agenda_view_toggle_label'];

	function messages(locale: (typeof LOCALES)[number]): Record<string, unknown> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, unknown>;
	}

	it.each(LOCALES)('%s defines the toggle keys, non-empty', (locale) => {
		const file = messages(locale);
		for (const key of TOGGLE_KEYS) {
			expect(file[key], `${locale}.json must define ${key}`).toBeDefined();
			expect(typeof file[key]).toBe('string');
			expect((file[key] as string).trim().length).toBeGreaterThan(0);
		}
	});

	it("the Estonian toggle labels are the RULED copy verbatim: 'Nimekiri' | 'Kuu'", () => {
		expect(messages('et').agenda_view_list).toBe('Nimekiri');
		expect(messages('et').agenda_view_month).toBe('Kuu');
	});

	it.each(LOCALES)('%s defines all 7 short-weekday keys, non-empty and DISTINCT', (locale) => {
		// Distinctness is the whole point of the key set: charAt(0) of the full
		// day names collides in en/lv/uk (the issue's table) — seven identical-
		// or-colliding strings would rebuild the trap behind new keys.
		const file = messages(locale);
		const values = WEEKDAY_KEYS.map((key) => {
			expect(file[key], `${locale}.json must define ${key}`).toBeDefined();
			expect(typeof file[key]).toBe('string');
			const value = (file[key] as string).trim();
			expect(value.length, `${locale}.${key} must be non-empty`).toBeGreaterThan(0);
			return value;
		});
		expect(new Set(values).size, `${locale} weekday strings must be 7 distinct values`).toBe(7);
	});

	it.each(['en', 'lv', 'uk'] as const)(
		'%s (a first-letter-collision locale) uses ≥2-character weekday strings — never down to one character',
		(locale) => {
			// The issue's rule: Estonian alone is collision-free at one character;
			// en/lv/uk need two (their example sets — en Su..Sa, lv Sv..Se, uk
			// Нд..Сб — are refinable copy, so no verbatim pin, only the length
			// floor the ruling sets).
			const file = messages(locale);
			for (const key of WEEKDAY_KEYS) {
				expect(
					((file[key] as string) ?? '').trim().length,
					`${locale}.${key} must be at least two characters`
				).toBeGreaterThanOrEqual(2);
			}
		}
	);
});

// (*MVOX:Tallis* — #247 RED)
// (*MVOX:Byrd* — #247 review fixes: filter-empty in month mode + date-column width)
