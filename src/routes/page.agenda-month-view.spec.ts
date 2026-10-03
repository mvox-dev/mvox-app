// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgendaItem } from '$lib/agenda/types';
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
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
		agenda_filter_empty: () => '[msg:filter-empty]',
		agenda_empty_no_events: () => '[msg:empty-no-events]',
		agenda_duration_min: (params) => `[msg:dur:${(params as { minutes: number }).minutes}]`,
		agenda_row_link_label: (params) => `[msg:link:${(params as { event: string }).event}]`,
		agenda_row_link_label_unnamed: () => '[msg:link-unnamed]',
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		event_type_social: () => '[msg:social]'
	})
);

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

const { loadFullAgendaMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
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
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
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

const JUN_MON = item('jun-mon', 'Esmaspäevane proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const JUN_WED = item('jun-wed', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert', 'Kammersaal');
const JUL_BOUNDARY = item('jul-boundary', 'Ööproov', '2030-06-30T22:00:00.000Z', 'rehearsal');
const JUL_WED = item('jul-wed', 'Suvekontsert', '2030-07-03T16:00:00.000Z', 'concert');
const RECENT_SOCIAL = item('rec-soc', 'Suvepidu', '2026-05-01T18:00:00.000Z', 'social');
const RECENT_CONCERT = item('rec-con', 'Talvekontsert', '2026-04-20T18:00:00.000Z', 'concert');

const ALL_UPCOMING = [JUN_MON, JUN_WED, JUL_BOUNDARY, JUL_WED];

function viewToggle(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[role="radiogroup"][aria-label="[msg:view-toggle]"]');
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
listMyRsvpsMock.mockResolvedValue(toListRead([]));

beforeEach(() => {
	setAppLocale('et');
});

afterEach(async () => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
	const prefs = await import('$lib/preferences/agendaView').catch(() => null);
	prefs?.setAgendaView('list');
	if (typeof localStorage !== 'undefined') localStorage.clear();
});

describe('#247 — the Nimekiri|Kuu toggle (ruled: segmented control, WITH the chips, day list default)', () => {
	it('renders a two-state segmented control of native buttons; the day list is active by default', async () => {
		const container = await renderAgenda(ALL_UPCOMING, [RECENT_SOCIAL]);

		const toggle = viewToggle(container);
		expect(toggle, 'view toggle group must exist').not.toBeNull();

		const buttons = Array.from(toggle!.querySelectorAll('button'));
		expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual([
			'agenda-view-list',
			'agenda-view-month'
		]);
		for (const btn of buttons) {
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('type')).toBe('button');
			expect(btn.getAttribute('role')).toBe('radio');
			expect(btn.getAttribute('aria-checked')).not.toBeNull();
			expect(btn.getAttribute('aria-pressed')).toBeNull();
		}
		expect(buttons.map((b) => b.textContent?.trim())).toEqual([
			'[msg:view-list]',
			'[msg:view-month]'
		]);

		expect(viewButton(container, 'agenda-view-list').getAttribute('aria-checked')).toBe('true');
		expect(viewButton(container, 'agenda-view-month').getAttribute('aria-checked')).toBe('false');
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

		expect(viewButton(container, 'agenda-view-month').getAttribute('aria-checked')).toBe('true');
		expect(viewButton(container, 'agenda-view-list').getAttribute('aria-checked')).toBe('false');
		expect(monthGroups(container).length).toBeGreaterThan(0);
		expect(container.querySelector('[data-testid="agenda-day-group"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-date-header"]')).toBeNull();
		expect(dayListRowIds(container)).toEqual([]);

		await fireEvent.click(viewButton(container, 'agenda-view-list'));

		expect(viewButton(container, 'agenda-view-list').getAttribute('aria-checked')).toBe('true');
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
		expect(monthRowIds(container)).not.toContain('rec-soc');
	});

	it('the current month shows only its REMAINDER: past days live in recent and stay off-screen (deliberate, not a gap)', async () => {
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

		expect(monthHeaders(container)).toEqual(['juuni 2030', 'juuli 2030']);

		const [june, july] = monthGroups(container);
		expect(monthRowIds(june)).toEqual(['jun-mon', 'jun-wed']);
		expect(monthRowIds(july)).toEqual(['jul-boundary', 'jul-wed']);

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

		expect(text).toMatch(/\[msg:wd-3\]\s*12(?!\d)/);
		expect(text).not.toContain('2030-06-12');
		expect(text).not.toContain('2030');
		expect(text).toContain('Kevadkontsert');
		const badge = row.querySelector('[data-testid="event-type-badge-jun-wed"]');
		expect(badge, 'month row must carry the type badge').not.toBeNull();
		expect(badge?.textContent?.trim()).toBe('[msg:concert]');
		const concertClasses = eventTypeBadgeClass('concert').split(/\s+/).filter(Boolean);
		expect(concertClasses.length).toBeGreaterThan(0);
		for (const cls of concertClasses) {
			expect(badge?.classList.contains(cls), `badge must carry ${cls}`).toBe(true);
		}

		expect(text).not.toMatch(/\d{1,2}:\d{2}/); // no clock time
		expect(text).not.toContain('[msg:dur'); // no duration line
		expect(text).not.toContain('Kammersaal'); // no location (fixture has one)
		expect(row.querySelectorAll('button').length).toBe(0); // no RSVP/attendance/works controls
	});

	it('the date column is wide enough for a two-character weekday + two-digit day', async () => {
		const container = await renderAgenda(ALL_UPCOMING);

		await switchToMonth(container);

		const date = monthRow(container, 'jun-wed').querySelector<HTMLElement>(
			'[data-testid="month-row-date"]'
		);
		expect(date, 'the month row must have a date column').not.toBeNull();
		expect(date!.classList.contains('w-8'), 'w-8 (32px) cannot hold "Нд 30"').toBe(false);
		expect(date!.classList.contains('min-w-[3rem]')).toBe(true);
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

		expect(monthRowIds(container)).toEqual(['jun-wed', 'jul-wed']);

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-filter-concert"]') as HTMLElement
		);
		expect(monthRowIds(container)).toEqual(['jun-mon', 'jun-wed', 'jul-boundary', 'jul-wed']);
	});

	it('a chip that empties the upcoming set renders the FILTER-empty copy, not "no upcoming events"', async () => {
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
		expect(container.querySelector('[data-testid="agenda-empty"]')).toBeNull();
		expect(container.textContent).not.toContain('[msg:empty-no-events]');

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-filter-all"]') as HTMLElement
		);
		expect(monthRowIds(container)).toEqual(['jun-mon', 'jul-boundary']);
		expect(container.querySelector('[data-testid="agenda-filter-empty"]')).toBeNull();
	});

	it('with NO filter active, a genuinely empty upcoming set still reads "no upcoming events"', async () => {
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

		const container = await renderAgenda(ALL_UPCOMING);
		expect(viewButton(container, 'agenda-view-month').getAttribute('aria-checked')).toBe('true');
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

describe('#312 — the view toggle is ONE segmented pill (radiogroup + roving tabindex)', () => {
	function segments(container: HTMLElement): HTMLButtonElement[] {
		return [viewButton(container, 'agenda-view-list'), viewButton(container, 'agenda-view-month')];
	}
	function stops(container: HTMLElement): HTMLButtonElement[] {
		return segments(container).filter((s) => s.getAttribute('tabindex') === '0');
	}

	it('the group is a role="radiogroup" of role="radio" segments, keeping its accessible name', async () => {
		const container = await renderAgenda(ALL_UPCOMING);
		const group = viewToggle(container);
		expect(group, 'radiogroup with the localized label must exist').not.toBeNull();
		expect(container.querySelector('[role="group"][aria-label="[msg:view-toggle]"]')).toBeNull();
		for (const s of segments(container)) {
			expect(s.getAttribute('role'), s.getAttribute('data-testid') ?? '').toBe('radio');
			expect(s.closest('[role="radiogroup"]')).toBe(group);
		}
	});

	it('exactly ONE segment is the Tab stop, and it is the checked one', async () => {
		const container = await renderAgenda(ALL_UPCOMING);
		expect(stops(container)).toEqual([viewButton(container, 'agenda-view-list')]);

		await switchToMonth(container);
		expect(stops(container)).toEqual([viewButton(container, 'agenda-view-month')]);
	});

	it('ArrowRight moves focus AND selects the next segment — through the store, so it persists', async () => {
		const container = await renderAgenda(ALL_UPCOMING);
		const [list, month] = segments(container);

		list.focus();
		await fireEvent.keyDown(list, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(month.getAttribute('aria-checked')).toBe('true');
		});
		expect(document.activeElement).toBe(month);
		expect(monthGroups(container).length).toBeGreaterThan(0);
		expect(localStorage.getItem('mvox.agenda_view')).toBe('month');

		await fireEvent.keyDown(month, { key: 'ArrowRight' });
		await waitFor(() => {
			expect(viewButton(container, 'agenda-view-list').getAttribute('aria-checked')).toBe('true');
		});
	});

	it('ArrowLeft wraps backwards from the first segment to the last', async () => {
		const container = await renderAgenda(ALL_UPCOMING);
		const list = viewButton(container, 'agenda-view-list');
		list.focus();
		await fireEvent.keyDown(list, { key: 'ArrowLeft' });
		await waitFor(() => {
			expect(viewButton(container, 'agenda-view-month').getAttribute('aria-checked')).toBe('true');
		});
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus can leave and the segment still activates', async () => {
		const container = await renderAgenda(ALL_UPCOMING);
		const list = viewButton(container, 'agenda-view-list');
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(list, { key });
			fireEvent(list, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});

	it('ONE pill visually: the container carries the border and rounding; segments sit flush — no gap, no per-segment chip rounding', async () => {
		const container = await renderAgenda(ALL_UPCOMING);
		const group = viewToggle(container) as HTMLElement;
		const tokens = [...group.classList];

		expect(tokens).toContain('overflow-hidden');
		expect(tokens).toContain('border');
		expect(
			tokens.some((t) => t.startsWith('rounded')),
			'container must carry the rounding'
		).toBe(true);
		expect(
			tokens.some((t) => t.startsWith('gap-')),
			'segments sit flush — no gap on the container'
		).toBe(false);
		for (const s of segments(container)) {
			expect(
				[...s.classList],
				`${s.getAttribute('data-testid')} must not be its own fully-rounded chip`
			).not.toContain('rounded-full');
		}
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Byrd*)
