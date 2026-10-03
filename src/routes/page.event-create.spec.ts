// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare', {
		event_created: (p: { name: string; when: string }) => `event_created ${p.name} @ ${p.when}`,
		event_create_inherited_from_series: (p: { value: string }) =>
			`event_create_inherited_from_series ${p.value}`,
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
	})
);

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
	createEventMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: listSectionsMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
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
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllEditions: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { HOURS_24, MINUTES_5, fillDateTime, fillTime, optionValues } from '$lib/testing/timeControls';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import type { CreateEventInput } from '$lib/entity/entityCreate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';
const UPCOMING_SEASON_ID = 'season-2';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function upcomingSeason(): Season {
	return {
		id: UPCOMING_SEASON_ID,
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

function agendaResult(opts: { editor?: boolean; withUpcomingSeason?: boolean } = {}) {
	const { editor = true, withUpcomingSeason = false } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: withUpcomingSeason ? [season, upcomingSeason()] : [season]
	});
}

function lapsedOnlySeasonResult(viewerIsEditor: boolean): ReturnType<typeof agendaResult> {
	return fullAgendaResult({
		seasons: [
			{
				id: 'season-0',
				name: 'Season 2025',
				startDate: isoDate(-300),
				endDate: isoDate(-1),
				conductors: [],
				owners: [],
				editors: viewerIsEditor ? ['person-p'] : []
			}
		]
	});
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-grace',
			personId: 'p-grace',
			name: 'Grace Hopper',
			email: 'grace@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

function seriesFixture() {
	return [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0 }
	];
}

function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

function series1Defaults() {
	return {
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: 'Bring the black folder'
	};
}

function toSeriesOptions(rows: Array<{ id: string; name: string }>) {
	return rows.map(({ id, name }) => ({ id, name }));
}

function upcomingSeriesFixture() {
	return [{ id: 'series-9', name: 'Autumn sectionals', eventCount: 3 }];
}

function upcomingStandaloneFixture() {
	return [{ id: 'ev-77', name: 'Autumn concert', startDatetime: '2027-11-01T18:00:00.000Z' }];
}

function routeSeasonListsBySeason(): void {
	listEventSeriesForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) => ({
		items: seasonId === SEASON_ID ? seriesFixture() : upcomingSeriesFixture(),
		truncated: false
	}));
	listSeriesOptionsForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) =>
		toSeriesOptions(seasonId === SEASON_ID ? seriesFixture() : upcomingSeriesFixture())
	);
	listEventsForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) => {
		const items = seasonId === SEASON_ID ? standaloneFixture() : upcomingStandaloneFixture();
		return { items, total: items.length, truncated: false };
	});
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listSeriesOptionsForSeasonMock.mockResolvedValue(toSeriesOptions(seriesFixture()));
	listEventsForSeasonMock.mockResolvedValue(toListRead(standaloneFixture()));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(series1Defaults());
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	createEventMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listSeriesOptionsForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function openFormFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

function typeSelect(container: HTMLElement): HTMLSelectElement {
	const select = q(container, 'event-create-type') as HTMLSelectElement;
	expect(select).not.toBeNull();
	return select;
}

async function chooseType(container: HTMLElement, type: string): Promise<void> {
	await selectValue(container, 'event-create-type', type);
}

function conductorSelect(container: HTMLElement): HTMLSelectElement {
	const field = q(container, 'event-create-conductors-field') as HTMLElement;
	expect(field).not.toBeNull();
	const select = field.querySelector(
		'[data-testid="event-create-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'expected the native event-create-conductor-select').not.toBeNull();
	expect(select.tagName).toBe('SELECT');
	return select;
}

function promptOption(select: HTMLSelectElement): HTMLOptionElement {
	const prompt = select.querySelector('option') as HTMLOptionElement;
	expect(prompt, 'expected a first (prompt) option').not.toBeNull();
	expect(prompt.value).toBe('');
	expect(prompt.disabled).toBe(true);
	expect(prompt.hidden).toBe(true);
	return prompt;
}

async function pickConductor(container: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(container), { target: { value: personId } });
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
}

function lastCreateInput(): CreateEventInput {
	const calls = createEventMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventInput;
}

describe('agenda — the event-creation entry point (rights gate — #213: the gear + the panel [+ Event])', () => {
	it('season editor + current season: the season CARD renders (page-level, never inside an agenda row); the page-level event-create is GONE; merely rendering writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();
		const control = q(container, 'season-card-expand') as HTMLElement;
		expect(control.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(control.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it('NON-editor: the card does NOT render — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'season-card-expand')).toBeNull();
		expect(q(container, 'event-create')).toBeNull();
	});

	it('the only season LAPSED yesterday and nothing is queued behind it: the card RENDERS — `manageableSeason` falls back to that season, and it is still where a new event belongs', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(true));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		const databaseEntityProbes = resolveManageRightsMock.mock.calls.filter(
			(c) => c[1] !== 'person-p'
		);
		expect(databaseEntityProbes).toEqual([]);
	});

	it('fail-closed on the same shape: a lapsed-only season the viewer does NOT edit (and no collective-wide grant) still hides the card', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(false));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalledWith(CFG, ORG_EFK, 'person-p');
		});
		expect(q(container, 'season-card-expand')).toBeNull();
	});

	it('an upcoming season hides NEITHER [+ Season] (#261 reopen) NOR the card — the two gates are independent, both rights-driven', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
	});

	it("the PANEL's [+ Event] (T3's season-manage-add-event) opens the SAME form with the panel's season PRE-FILLED and the series options already offered", async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		expect(season.value).toBe(SEASON_ID);

		const series = q(container, 'event-create-series') as HTMLSelectElement;
		expect(series.disabled).toBe(false);
		const values = [...series.querySelectorAll('option')].map((o) => o.value);
		expect(values).toEqual(['', 'series-1', 'series-2']);

		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fill(container, 'event-create-name', 'Doomed draft');

		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

describe('agenda — the event creation form carries every sketch-C field', () => {
	it('name (text), datetime (datetime-local), duration + capacity (number), location (text), description (TEXTAREA), a type picker (#199 canonical select) and a native conductor select (#209)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.tagName).toBe('INPUT');

		const datetime = q(container, 'event-create-datetime') as HTMLElement;
		expect(datetime).not.toBeNull();
		expect(datetime.tagName).not.toBe('INPUT');
		const dtDate = q(container, 'event-create-datetime-date') as HTMLInputElement;
		expect(dtDate).not.toBeNull();
		expect(dtDate.type).toBe('date');
		const dtHour = q(container, 'event-create-datetime-hour') as HTMLSelectElement;
		const dtMinute = q(container, 'event-create-datetime-minute') as HTMLSelectElement;
		expect(dtHour.tagName).toBe('SELECT');
		expect(dtMinute.tagName).toBe('SELECT');
		expect(optionValues(dtHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(dtMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'event-create-datetime-ampm'), '24h is the default').toBeNull();

		expect(q(container, 'event-create-duration'), '#243 removed the duration input').toBeNull();
		const end = q(container, 'event-create-end') as HTMLElement;
		expect(end, '#243: the end composite (event-create-end)').not.toBeNull();
		expect(end.tagName).not.toBe('INPUT');
		const endDate = q(container, 'event-create-end-date') as HTMLInputElement;
		expect(endDate, 'native end date input (native pickers stay, #207 Option 1)').not.toBeNull();
		expect(endDate.type).toBe('date');
		const endHour = q(container, 'event-create-end-hour') as HTMLSelectElement;
		const endMinute = q(container, 'event-create-end-minute') as HTMLSelectElement;
		expect(endHour.tagName, 'end time is the shipped TimeSelect (rule 5)').toBe('SELECT');
		expect(endMinute.tagName).toBe('SELECT');
		expect(optionValues(endHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(endMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'event-create-end-ampm'), '24h is the default').toBeNull();

		const capacity = q(container, 'event-create-capacity') as HTMLInputElement;
		expect(capacity).not.toBeNull();
		expect(capacity.type).toBe('number');

		const location = q(container, 'event-create-location') as HTMLInputElement;
		expect(location).not.toBeNull();
		expect(location.tagName).toBe('INPUT');

		const description = q(container, 'event-create-description') as HTMLElement;
		expect(description).not.toBeNull();
		expect(description.tagName).toBe('TEXTAREA');

		expect(typeSelect(container).tagName).toBe('SELECT');
		const conductors = conductorSelect(container);
		expect(
			conductors.getAttribute('aria-label'),
			'#249 — the visible label replaced the aria-label'
		).toBeNull();
		expect(
			conductors.closest('label'),
			'#249 — the conductor select is named by a wrapping visible <label>'
		).not.toBeNull();
		expect(promptOption(conductors).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
		expect(conductors.value).toBe('');
	});

	it('the season select offers EVERY known season (value = id, its NAME visible) behind a "" placeholder option', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromPanel(container);

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		const options = [...season.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', SEASON_ID, UPCOMING_SEASON_ID]);
		expect(options[1].textContent).toContain('Season 2026');
		expect(options[2].textContent).toContain('Season 2027');
	});

	it('choosing a season (agenda-opened) loads THAT season’s series — listSeriesOptionsForSeason(cfg, <the selected id>) — and enables the series select with a "" (no-series) option first', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromPanel(container);

		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID);

		await waitFor(() => {
			expect(listSeriesOptionsForSeasonMock).toHaveBeenCalledWith(CFG, UPCOMING_SEASON_ID);
		});
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(series.disabled).toBe(false);
		});
		const options = [...series.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', 'series-1', 'series-2']);
		expect(options[1].textContent).toContain('Monday rehearsals');
		expect(options[2].textContent).toContain('Sectionals');
	});

	it('opening the form makes one series read, the options-only one (#594)', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});
		const panelReads = listEventSeriesForSeasonMock.mock.calls.length;

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			const series = q(container, 'event-create-series');
			expect(series?.querySelector('[value="series-1"]')).not.toBeNull();
		});

		expect(listSeriesOptionsForSeasonMock.mock.calls).toEqual([[CFG, SEASON_ID]]);
		expect(listEventSeriesForSeasonMock.mock.calls.length).toBe(panelReads);
	});
});

describe('agenda — the conductor select (#209) is fed from the cached roster', () => {
	it('the roster loads at most ONCE (through getRoster), only when the form opens; the select offers every roster person; a picked conductor renders as a NAMED chip and the select resets to the prompt', async () => {
		const container = await renderReady();
		expect(loadRosterMock).not.toHaveBeenCalled();

		await openFormFromPanel(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		const select = conductorSelect(container);
		await waitFor(() => {
			expect(optionValues(select)).toEqual(['', 'p-ada', 'p-grace', 'person-p']);
		});
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual([
			'event_create_conductor_placeholder',
			'Ada Lovelace',
			'Grace Hopper',
			'Pete Wilson'
		]);

		await pickConductor(container, 'p-ada');

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'event-create-conductor-p-ada')?.textContent).toContain('Ada Lovelace');

		await waitFor(() => {
			expect(conductorSelect(container).value).toBe('');
		});
		expect(optionValues(conductorSelect(container))).toEqual(['', 'p-grace', 'person-p']);

		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('option order is ROSTER order — section (listSections tree order), then position within section, Unassigned last — NOT alphabetical (Gama ruling 3)', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ ...fixtureRows()[0], sectionIds: ['sec-t'] }, // Ada → Tenor
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran
			{ ...fixtureRows()[2], sectionIds: [] } // Pete → Unassigned
		]));
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(optionValues(conductorSelect(container))).toEqual([
				'',
				'p-grace',
				'p-ada',
				'person-p'
			]);
		});
	});

	it('EVERYONE picked: the select stays MOUNTED but disabled and its prompt text becomes picker_everyone_added (Gama ruling 2)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		await pickConductor(container, 'p-ada');
		await pickConductor(container, 'p-grace');
		await pickConductor(container, 'person-p');

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-person-p')).not.toBeNull();
		});
		const select = conductorSelect(container);
		await waitFor(() => {
			expect(select.disabled).toBe(true);
		});
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_everyone_added');

		await fireEvent.click(q(container, 'event-create-conductor-remove-p-ada') as HTMLElement);
		await waitFor(() => {
			expect(conductorSelect(container).disabled).toBe(false);
		});
		expect(optionValues(conductorSelect(container))).toEqual(['', 'p-ada']);
		expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
	});
});

describe('agenda — selecting a series keeps DESCRIPTIVE placeholders and shows the inherited values as "From series" secondary lines (#208)', () => {
	async function openWithSeries1(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await waitFor(() => {
			expect(getSeriesDefaultsMock).toHaveBeenCalledWith(CFG, 'series-1');
		});
	}

	function inherited(container: HTMLElement, field: string): string | null {
		const el = q(container, `event-create-${field}-inherited`);
		return el ? (el.textContent ?? '').trim() : null;
	}

	it('all four placeholders stay the DESCRIPTIVE keys, the VALUES stay empty, and each inherited value renders on its own muted line (exact strings)', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});
		expect(inherited(container, 'duration')).toEqual('event_create_inherited_from_series 90 min');
		expect(inherited(container, 'location')).toEqual(
			'event_create_inherited_from_series Main hall'
		);
		expect(inherited(container, 'description')).toEqual(
			'event_create_inherited_from_series Bring the black folder'
		);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		const location = q(container, 'event-create-location') as HTMLInputElement;
		const description = q(container, 'event-create-description') as HTMLTextAreaElement;
		expect(name.placeholder).toBe('event_create_name_placeholder');
		expect(location.placeholder).toBe('event_create_location_placeholder');
		expect(description.placeholder).toBe('event_create_description_placeholder');
		expect(name.value).toBe('');
		expect(location.value).toBe('');
		expect(description.value).toBe('');
		expect((q(container, 'event-create-end-hour') as HTMLSelectElement).value).toBe('');
		expect((q(container, 'event-create-end-minute') as HTMLSelectElement).value).toBe('');

		for (const field of ['name', 'duration', 'location', 'description']) {
			const line = q(container, `event-create-${field}-inherited`) as HTMLElement;
			expect(line.querySelector('input, select, textarea, button, a'), field).toBeNull();
		}
	});

	it('typing an OVERRIDE keeps the inherited line visible (the viewer sees what they are replacing); CLEARING it keeps the line too', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});

		await fill(container, 'event-create-name', 'Extra rehearsal');
		expect(name.value).toBe('Extra rehearsal');
		expect(inherited(container, 'name')).toEqual(
			'event_create_inherited_from_series Monday rehearsals'
		);
		expect(name.placeholder).toBe('event_create_name_placeholder');

		await fill(container, 'event-create-name', '');
		expect(name.value).toBe('');
		expect(inherited(container, 'name')).toEqual(
			'event_create_inherited_from_series Monday rehearsals'
		);
		expect(name.placeholder).toBe('event_create_name_placeholder');
	});

	it('DESELECTING the series (back to "no series") removes ALL FOUR inherited lines', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});

		await selectValue(container, 'event-create-series', '');

		await waitFor(() => {
			expect(inherited(container, 'name')).toBeNull();
		});
		expect(inherited(container, 'duration')).toBeNull();
		expect(inherited(container, 'location')).toBeNull();
		expect(inherited(container, 'description')).toBeNull();
	});

	it('a series providing ONLY name + duration renders exactly those two lines — no location/description line for values the series does not carry', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: 'Ad-hoc sectionals',
			durationMinutes: 45,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Ad-hoc sectionals'
			);
		});
		expect(inherited(container, 'duration')).toEqual('event_create_inherited_from_series 45 min');
		expect(inherited(container, 'location')).toBeNull();
		expect(inherited(container, 'description')).toBeNull();
	});
});

describe('agenda — submit calls createEvent with exactly what the viewer set', () => {
	it('STANDALONE full flow (agenda-opened): every field set → createEvent(cfg, {…}) ONCE, full shape — org from resolveDatabaseEntityId, season in extraParentIds, NO seriesId, Tallinn wall clock converted to the UTC instant', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await fillTime(container, 'event-create-end', '21:00');
		await fill(container, 'event-create-location', 'Estonia Hall');
		await fill(container, 'event-create-description', 'Doors at 18:30');
		await pickConductor(container, 'p-ada');
		await fill(container, 'event-create-capacity', '300');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventMock).toHaveBeenCalledWith(CFG, {
			name: 'Spring concert',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z',
			durationMinutes: 120,
			location: 'Estonia Hall',
			description: 'Doors at 18:30',
			conductorRefs: ['p-ada'],
			capacity: 300
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);

		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('SERIES occurrence, untouched inherited fields (panel-opened): seriesId is the picked series, the season still rides in extraParentIds, and the inherited defaults are NOT copied into the call', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1'
		});
	});

	it('SERIES occurrence with OVERRIDES: the typed name + duration are sent, the untouched location/description still are not (full shape)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await fillTime(container, 'event-create-end', '19:15');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1',
			name: 'Extra rehearsal',
			durationMinutes: 45
		});
	});

	it('SERIES occurrence, ONLY the name overridden: exactly that one extra key rides along', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1',
			name: 'Extra rehearsal'
		});
	});

	it('a PANEL-born create refreshes the panel lists too: after success the season’s series list re-reads (the new occurrence must land in the counts; #313 — there is no standalone list any more), the panel is STILL OPEN to receive them, and the agenda refreshes', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;

		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(
			(q(container, 'season-manage-name') as HTMLElement | null)?.textContent ?? ''
		).not.toBe('');
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
	});

	it('no SEASON chosen (the viewer re-picks the "" placeholder): submit refuses with event-create-error (role="alert"), createEvent is NEVER called, the form stays open — a season-less event is invisible to every agenda read', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', '');
		expect((q(container, 'event-create-series') as HTMLSelectElement).disabled).toBe(true);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Orphan event');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
	});

	it('a FAILED write: event-create-error shows (role="alert"), the form stays OPEN with the work still in it, and nothing refreshes', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'event-create-form')).not.toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).value).toBe('Spring concert');
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		createEventMock.mockResolvedValue('ev-new-1');
		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(2);
		});
	});
});

describe('agenda — event create REFUSES an incomplete form before it writes (review F1)', () => {
	it('NO datetime: refused with the DATETIME message; the input carries aria-invalid + aria-describedby', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_create_datetime_required'
		);
		expect(createEventMock).not.toHaveBeenCalled();
		const wrapper = q(container, 'event-create-datetime') as HTMLElement;
		expect(wrapper.getAttribute('role')).toBe('group');
		expect(wrapper.getAttribute('aria-label')).toBeNull();
		const startLabelledby = wrapper.getAttribute('aria-labelledby');
		expect(startLabelledby, 'the start group is named by a visible label').toBeTruthy();
		const startLabel = container.querySelector(`#${startLabelledby}`) as HTMLElement;
		expect(startLabel).not.toBeNull();
		expect(startLabel.textContent?.trim()).toBe('event_create_start_label');
		for (const testid of [
			'event-create-datetime-date',
			'event-create-datetime-hour',
			'event-create-datetime-minute'
		]) {
			const control = q(container, testid) as HTMLElement;
			expect(['INPUT', 'SELECT'], `${testid} is a real form control`).toContain(control.tagName);
			expect(control.getAttribute('aria-invalid'), testid).toBe('true');
			expect(control.getAttribute('aria-describedby'), testid).toBe('event-create-error');
		}
	});

	it('STANDALONE with no name: refused (a standalone event has no series to inherit a name from)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_create_name_required'
		);
		expect(createEventMock).not.toHaveBeenCalled();
		expect((q(container, 'event-create-name') as HTMLInputElement).getAttribute('aria-invalid')).toBe(
			'true'
		);
	});

	it('a SERIES occurrence with no name is NOT refused — the name is inherited (already pinned above, held here against the new name guard)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(q(container, 'event-create-error')).toBeNull();
	});

	it('the refusal is not sticky: editing the named field clears it, and the next submit re-decides', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});

		await fill(container, 'event-create-name', 'Spring concert');
		expect(q(container, 'event-create-error')).toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).getAttribute('aria-invalid')).toBeNull();

		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
	});
});

describe('agenda — a successful event create SAYS SO (review F3)', () => {
	it('event-create-status is mounted (empty) from first render and carries the result after the write — the form vanishing is otherwise the same signal Cancel gives', async () => {
		const container = await renderReady();
		const status = q(container, 'event-create-status') as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent?.trim()).toBe('');

		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toContain('event_created');
		});
	});

	it('#207 rule 7: the success toast renders the event start as "YYYY-MM-DD HH:MM" (ISO date + 24h time, Tallinn wall clock)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Spring concert @ 2027-04-18 19:00'
			);
		});
	});

	it('#208 guard: an untouched SERIES occurrence is announced under the SERIES name (no own name typed)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Monday rehearsals @ 2026-09-07 18:30'
			);
		});
	});

	it('#208 guard: an OWN typed name beats the series name in the announcement', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Extra rehearsal @ 2026-09-07 18:30'
			);
		});
	});

	it('#208 guard: a series with NO name of its own falls back to the TYPE value in the announcement', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: '',
			durationMinutes: 45,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created rehearsal @ 2026-09-07 18:30'
			);
		});
	});

	it('a FAILED write announces nothing — the status slot stays empty', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-status')?.textContent?.trim()).toBe('');
	});
});

describe('agenda — every event-create field keeps a VISIBLE label (review F4 + F5)', () => {
	it('#208: a series providing ONLY a name — every placeholder stays the static descriptive hint, and only the NAME gets a "From series" line', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: 'Ad-hoc sectionals',
			durationMinutes: null,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');

		await waitFor(() => {
			expect(q(container, 'event-create-name-inherited')?.textContent?.trim()).toBe(
				'event_create_inherited_from_series Ad-hoc sectionals'
			);
		});
		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
		expect(q(container, 'event-create-duration-inherited')).toBeNull();
		expect(q(container, 'event-create-location-inherited')).toBeNull();
		expect(q(container, 'event-create-description-inherited')).toBeNull();
	});

	it('capacity and description carry placeholders, not an aria-label alone — capacity sits beside a duration box that has one', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		expect((q(container, 'event-create-capacity') as HTMLInputElement).placeholder).toBe(
			'event_create_capacity_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
	});
});

describe("agenda — a panel-born create refreshes the PANEL's season, not the form's (2nd-pass F2)", () => {
	it('the form’s season switched away: the panel keeps showing ITS OWN season’s series and events', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ withUpcomingSeason: true }));
		routeSeasonListsBySeason();
		const container = await renderReady();
		await openFormFromPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});

		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Autumn opener');
		await fillDateTime(container, 'event-create-datetime', '2027-10-04', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().extraParentIds).toEqual([UPCOMING_SEASON_ID]);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await flush();

		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-9')).toBeNull();
	});
});

describe('agenda — the event-create form drops async replies that no longer belong to it (2nd-pass F3)', () => {
	it('the season switched while its series read is in flight: the select never offers the PREVIOUS season’s series', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ withUpcomingSeason: true }));
		let releaseSlow: (list: unknown) => void = () => {};
		listSeriesOptionsForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId === SEASON_ID) {
				return new Promise((resolve) => {
					releaseSlow = resolve;
				});
			}
			return Promise.resolve(toSeriesOptions(upcomingSeriesFixture()));
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID); // …hangs
		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID); // …answers

		const select = () => q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(select().querySelector('option[value="series-9"]')).not.toBeNull();
		});

		releaseSlow(toSeriesOptions(seriesFixture()));
		await flush();
		expect(select().querySelector('option[value="series-1"]')).toBeNull();
		expect(select().querySelector('option[value="series-9"]')).not.toBeNull();
	});

	it('the form dismissed and REOPENED while a series-defaults read is in flight: the fresh form shows the static hints, not the dead form’s inherited ones', async () => {
		let releaseDefaults: (defaults: unknown) => void = () => {};
		getSeriesDefaultsMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseDefaults = resolve;
				})
		);
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');

		await fireEvent.keyDown(q(container, 'event-create-form') as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});

		releaseDefaults(series1Defaults());
		await flush();
		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect(q(container, 'event-create-name-inherited')).toBeNull();
		expect(q(container, 'event-create-duration-inherited')).toBeNull();
		expect(q(container, 'event-create-location-inherited')).toBeNull();
		expect(q(container, 'event-create-description-inherited')).toBeNull();
	});
});

describe('agenda — the inheritance preview covers DESCRIPTION too (2nd-pass F4, #208 secondary line)', () => {
	it('a series carrying a default_description shows it on the description "From series" line — the placeholder stays descriptive', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'event-create-description-inherited')?.textContent?.trim()).toBe(
				'event_create_inherited_from_series Bring the black folder'
			);
		});
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().description).toBeUndefined();
	});
});

describe('#208 — locale coverage for the "From series" secondary line', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('event_create_inherited_from_series exists in en/et/lv/uk, is non-empty, and carries the {value} slot', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['event_create_inherited_from_series'];
			expect(msg, `${locale}.json is missing event_create_inherited_from_series`).toBeDefined();
			expect(msg, `${locale}.json event_create_inherited_from_series is empty`).toMatch(/\S/);
			expect(msg, `${locale}.json event_create_inherited_from_series lacks {value}`).toContain(
				'{value}'
			);
		}
	});

	it('the en/et copy is the ruled wording (Gama, #208): "From series: {value}" / "Seeriast: {value}"', () => {
		expect(messages('en')['event_create_inherited_from_series']).toBe('From series: {value}');
		expect(messages('et')['event_create_inherited_from_series']).toBe('Seeriast: {value}');
	});

	it('guard: agenda_duration_min (the inherited-duration unit) already exists in all four locales with {minutes}', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['agenda_duration_min'];
			expect(msg, `${locale}.json is missing agenda_duration_min`).toBeDefined();
			expect(msg, `${locale}.json agenda_duration_min lacks {minutes}`).toContain('{minutes}');
		}
	});
});

describe('agenda — the event-create conductor select tells its empties apart (#209 review F1)', () => {
	it('roster read STILL IN FLIGHT: disabled with the LOADING prompt, never picker_everyone_added', async () => {
		loadRosterMock.mockReturnValue(new Promise<never>(() => {})); // never settles

		const container = await renderReady();
		await openFormFromPanel(container);

		const select = conductorSelect(container);
		expect(select.disabled).toBe(true);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE, permanently visible rather than reading as "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
				'picker_roster_unavailable'
			);
		});
		expect(conductorSelect(container).disabled).toBe(true);
	});

	it('SECTION read failed: the select stays usable in the roster’s own name order and says so', async () => {
		listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-order-note')).not.toBeNull();
		});
		const select = conductorSelect(container);
		expect(select.disabled).toBe(false);
		expect(promptOption(select).textContent?.trim()).toBe('event_create_conductor_placeholder');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina*)
// (*MVOX:Tallis*)

async function fillDateTimeAmpm(
	container: HTMLElement,
	prefix: string,
	date: string,
	hour12: string,
	minute: string,
	ampm: 'AM' | 'PM'
): Promise<void> {
	await fireEvent.input(q(container, `${prefix}-date`) as HTMLElement, { target: { value: date } });
	await fireEvent.change(q(container, `${prefix}-hour`) as HTMLElement, {
		target: { value: hour12 }
	});
	await fireEvent.change(q(container, `${prefix}-minute`) as HTMLElement, {
		target: { value: minute }
	});
	await fireEvent.change(q(container, `${prefix}-ampm`) as HTMLElement, { target: { value: ampm } });
}

describe('#220 — AM/PM preference on the event-created toast (and NOT on the wire)', () => {
	it("'ampm': the toast renders 'event_created Spring concert @ 2027-04-18 7:00 PM' — ISO date half untouched (rule 7), time half through the shared formatter", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			await submit(container);

			await waitFor(() => {
				expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
					'event_created Spring concert @ 2027-04-18 7:00 PM'
				);
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'ampm' wire guard: createEvent STILL receives the untouched UTC instant — the preference is display-only, stored/submitted values never change", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			await submit(container);

			await waitFor(() => {
				expect(createEventMock).toHaveBeenCalledTimes(1);
			});
			expect(createEventMock).toHaveBeenCalledWith(CFG, {
				name: 'Spring concert',
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'concert',
				startDatetime: '2027-04-18T16:00:00.000Z'
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});
});

// (*MVOX:Tallis*)

describe('#243 — visible labels on the start/end pair (Gama on-issue addition, #239 idiom)', () => {
	it('the END group: role="group", named by a VISIBLE label via aria-labelledby, NO aria-label on the wrapper; inner per-control labels name the parts', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const end = q(container, 'event-create-end') as HTMLElement;
		expect(end.getAttribute('role')).toBe('group');
		expect(end.getAttribute('aria-label'), 'no aria-label on the group — #205 F1 trap').toBeNull();
		const labelledby = end.getAttribute('aria-labelledby');
		expect(labelledby, 'named by a visible label').toBeTruthy();
		const label = container.querySelector(`#${labelledby}`) as HTMLElement;
		expect(label, 'the aria-labelledby target exists').not.toBeNull();
		expect(label.textContent?.trim()).toBe('event_create_end_label');
		expect(label.classList.contains('sr-only')).toBe(false);
		expect(
			(q(container, 'event-create-end-date') as HTMLElement).getAttribute('aria-label')
		).toBe('time_select_date_label');
	});

	it('the START group flips to the same idiom: visible label, no aria-label', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const start = q(container, 'event-create-datetime') as HTMLElement;
		expect(start.getAttribute('role')).toBe('group');
		expect(start.getAttribute('aria-label')).toBeNull();
		const labelledby = start.getAttribute('aria-labelledby');
		expect(labelledby).toBeTruthy();
		const label = container.querySelector(`#${labelledby}`) as HTMLElement;
		expect(label).not.toBeNull();
		expect(label.textContent?.trim()).toBe('event_create_start_label');
		expect(label.classList.contains('sr-only')).toBe(false);
	});
});

describe('#243 — the end date MIRRORS the start date until touched (Done-when 4)', () => {
	it('filling/changing the start date writes the end date too — until the viewer touches the end date, after which it stays put', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const endDate = q(container, 'event-create-end-date') as HTMLInputElement;
		await fill(container, 'event-create-datetime-date', '2027-04-18');
		expect(endDate.value, 'end date mirrors the start date').toBe('2027-04-18');

		await fill(container, 'event-create-datetime-date', '2027-04-19');
		expect(endDate.value, 'the mirror keeps following').toBe('2027-04-19');

		await fill(container, 'event-create-end-date', '2027-04-20');
		await fill(container, 'event-create-datetime-date', '2027-04-21');
		expect(endDate.value, 'a touched end date is never silently overwritten').toBe('2027-04-20');
	});

	it('cancel + reopen re-arms the mirror (the latch resets with the rest of the form)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fill(container, 'event-create-end-date', '2027-04-20');
		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect((q(container, 'event-create-end-date') as HTMLInputElement).value).toBe('');
		await fill(container, 'event-create-datetime-date', '2027-05-01');
		expect((q(container, 'event-create-end-date') as HTMLInputElement).value).toBe('2027-05-01');
	});
});

describe('#243 — duration_minutes is DERIVED, DST-safe (two independent UTC conversions)', () => {
	async function standaloneReady(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Autumn camp');
	}

	it('October FALL-BACK camp: 2026-10-24 10:00 → 2026-10-25 15:00 = 1800 real minutes (naive wall-clock says 1740) — FULL wire shape, and NO end prop of any spelling', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-10-24', '10:00');
		await fill(container, 'event-create-end-date', '2026-10-25');
		await fillTime(container, 'event-create-end', '15:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-10-24T07:00:00.000Z',
			durationMinutes: 1800
		});
		expect(Object.keys(lastCreateInput()).filter((k) => /end/i.test(k))).toEqual([]);
	});

	it('March SPRING-FORWARD camp: 2026-03-28 10:00 → 2026-03-29 15:00 = 1680 real minutes (naive says 1740)', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-03-28', '10:00');
		await fill(container, 'event-create-end-date', '2026-03-29');
		await fillTime(container, 'event-create-end', '15:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-03-28T08:00:00.000Z',
			durationMinutes: 1680
		});
	});

	it('the 25-HOUR DAY itself: 2026-10-25 00:00 → 2026-10-26 00:00 = 1500 min, exactly', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-10-25', '00:00');
		await fill(container, 'event-create-end-date', '2026-10-26');
		await fillTime(container, 'event-create-end', '00:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-10-24T21:00:00.000Z',
			durationMinutes: 1500
		});
	});

	it('a BLANK end time sends NO durationMinutes key at all — the optionality that carries series inheritance survives (full shape, phantom-key scan)', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z'
		});
		expect(Object.keys(lastCreateInput()).filter((k) => /end|duration/i.test(k))).toEqual([]);
	});
});

describe('#243 — an end at or before the start is refused BEFORE any write (Done-when 5)', () => {
	async function readySameDay(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Inverted event');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
	}

	it('end time EARLIER the same day: refused with event_end_before_start, createEvent never called, the end controls carry aria-invalid + aria-describedby', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '18:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
		for (const testid of [
			'event-create-end-date',
			'event-create-end-hour',
			'event-create-end-minute'
		]) {
			const control = q(container, testid) as HTMLElement;
			expect(control.getAttribute('aria-invalid'), testid).toBe('true');
			expect(control.getAttribute('aria-describedby'), testid).toBe('event-create-error');
		}
	});

	it('end EQUAL to start: refused too — the rule is end <= start on DATETIMES, which is why the date-flavoured copy could not be reused', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('end DATE before the start date (a touched mirror the viewer then out-ran): refused, loud — never a silent fix-up of the end date', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fill(container, 'event-create-end-date', '2027-04-17');
		await fillTime(container, 'event-create-end', '20:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the refusal is not sticky: editing the end time clears it, and the corrected submit writes', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '18:00');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});

		await fillTime(container, 'event-create-end', '21:00');
		expect(q(container, 'event-create-error')).toBeNull();
		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().durationMinutes).toBe(120);
	});
});

describe('#243 — the end time honours the AM/PM preference (rule 5, shipped TimeSelect)', () => {
	it("'ampm': the end composite grows its -ampm select; 7:00 PM → 9:00 PM writes durationMinutes 120 on an unchanged wire", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			expect(q(container, 'event-create-end-ampm'), 'end TimeSelect in ampm mode').not.toBeNull();
			await fireEvent.change(q(container, 'event-create-end-hour') as HTMLElement, {
				target: { value: '9' }
			});
			await fireEvent.change(q(container, 'event-create-end-minute') as HTMLElement, {
				target: { value: '00' }
			});
			await fireEvent.change(q(container, 'event-create-end-ampm') as HTMLElement, {
				target: { value: 'PM' }
			});
			await submit(container);

			await waitFor(() => {
				expect(createEventMock).toHaveBeenCalledTimes(1);
			});
			expect(createEventMock).toHaveBeenCalledWith(CFG, {
				name: 'Spring concert',
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'concert',
				startDatetime: '2027-04-18T16:00:00.000Z',
				durationMinutes: 120
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});
});

describe('#243 — locale coverage for the start/end labels and the range error', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('event_create_start_label / event_create_end_label / event_end_before_start exist in en/et/lv/uk and are non-empty', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			for (const key of [
				'event_create_start_label',
				'event_create_end_label',
				'event_end_before_start'
			]) {
				const msg = messages(locale)[key];
				expect(msg, `${locale}.json is missing ${key}`).toBeDefined();
				expect(msg, `${locale}.json ${key} is empty`).toMatch(/\S/);
			}
		}
	});

	it('the detail editor’s field name follows the field: event_edit_duration_minutes_aria_label no longer says "Edit duration" (the KEY stays — a rename would break the derived-key a11y suite)', () => {
		expect(messages('en')['event_edit_duration_minutes_aria_label']).not.toBe('Edit duration');
		expect(messages('et')['event_edit_duration_minutes_aria_label']).not.toBe('Muuda kestust');
	});

	it('event_end_before_start is its OWN copy, not a byte-copy of the date-flavoured keys it deliberately does not reuse', () => {
		for (const locale of ['en', 'et']) {
			const msgs = messages(locale);
			expect(msgs['event_end_before_start']).not.toBe(msgs['season_date_range_invalid']);
			expect(msgs['event_end_before_start']).not.toBe(msgs['series_create_until_before_from']);
			expect(msgs['event_end_before_start']).not.toBe(msgs['event_convert_end_before_start']);
		}
	});
});

// (*MVOX:Tallis*)

describe('#249 — every event-create control carries a visible label that IS its accessible name', () => {
	function labelElementOf(container: HTMLElement, el: HTMLElement): HTMLLabelElement | null {
		const id = el.getAttribute('id');
		if (id) {
			const forLabel = container.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
			if (forLabel) return forLabel;
		}
		return el.closest('label');
	}

	function labelText(label: HTMLElement): string {
		const clone = label.cloneNode(true) as HTMLElement;
		for (const embedded of clone.querySelectorAll('input, select, textarea')) embedded.remove();
		return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	}

	function computedName(container: HTMLElement, el: HTMLElement): string {
		const labelledby = el.getAttribute('aria-labelledby');
		if (labelledby) {
			return labelledby
				.split(/\s+/)
				.map((id) => container.querySelector(`[id="${id}"]`)?.textContent?.trim() ?? '')
				.join(' ')
				.trim();
		}
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel !== null) return ariaLabel.trim();
		const label = labelElementOf(container, el);
		return label ? labelText(label) : '';
	}

	function expectVisibleText(el: HTMLElement, what: string): void {
		expect(el.hasAttribute('hidden'), `${what} must not be [hidden]`).toBe(false);
		expect(el.getAttribute('aria-hidden'), `${what} must not be aria-hidden`).not.toBe('true');
		expect(
			Array.from(el.classList),
			`${what} must be visibly rendered, not screen-reader-only`
		).not.toContain('sr-only');
	}

	const FIELD_LABEL_KEYS: ReadonlyArray<readonly [testid: string, key: string]> = [
		['event-create-season', 'event_create_season_label'],
		['event-create-series', 'event_create_series_label'],
		['event-create-name', 'event_create_name_label'],
		['event-create-capacity', 'event_create_capacity_label'],
		['event-create-location', 'event_create_location_label'],
		['event-create-description', 'event_create_description_label'],
		['event-create-conductor-select', 'event_create_conductor_label']
	];

	async function openReadyForm(): Promise<HTMLElement> {
		const container = await renderReady();
		await openFormFromPanel(container);
		return container;
	}

	it('all seven aria-only controls: a visible <label> (for= or wrapping) computes as the accessible name, and the old aria-label is GONE — never a placeholder as the only name', async () => {
		const container = await openReadyForm();

		for (const [testid, key] of FIELD_LABEL_KEYS) {
			const control = q(container, testid) as HTMLElement;
			expect(control, testid).not.toBeNull();

			expect(
				control.getAttribute('aria-label'),
				`${testid}: aria-label must be dropped once the visible label names it`
			).toBeNull();

			const label = labelElementOf(container, control);
			expect(label, `${testid}: needs a label[for] or wrapping <label>`).not.toBeNull();
			expectVisibleText(label as HTMLElement, `${testid}'s label`);

			expect(
				computedName(container, control),
				`${testid}: computed accessible name must be the visible label's text`
			).toBe(key);
		}
	});

	it("event-create-type sheds its redundant aria-label (the #205 F1 double-naming shape, Gama's scope note on #242): the visible label STAYS and is the only authored name", async () => {
		const container = await openReadyForm();

		const type = q(container, 'event-create-type') as HTMLSelectElement;
		expect(type).not.toBeNull();
		expect(
			type.getAttribute('aria-label'),
			'the wrapping label already names the select — the same-key aria-label is redundant'
		).toBeNull();

		const caption = q(container, 'event-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('event_create_type_label');
		expectVisibleText(caption, "event-create-type's label");
		expect(type.closest('label')).toBe(caption.closest('label'));
		expect(computedName(container, type)).toBe('event_create_type_label');
	});

	it('the already-labeled start/end groups are UNTOUCHED: still named by their visible spans via aria-labelledby, still no aria-label (done-when 7)', async () => {
		const container = await openReadyForm();

		for (const [testid, key] of [
			['event-create-datetime', 'event_create_start_label'],
			['event-create-end', 'event_create_end_label']
		] as const) {
			const group = q(container, testid) as HTMLElement;
			expect(group, testid).not.toBeNull();
			expect(group.getAttribute('role'), testid).toBe('group');
			expect(group.getAttribute('aria-label'), `${testid}: #205 F1 trap stays fixed`).toBeNull();
			expect(computedName(container, group), testid).toBe(key);
		}
	});

	it('labels are ADDITIVE (rule 4): every placeholder/prompt survives exactly as it was', async () => {
		const container = await openReadyForm();

		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-capacity') as HTMLInputElement).placeholder).toBe(
			'event_create_capacity_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		expect(season.querySelector('option[value=""]')?.textContent?.trim()).toBe(
			'event_create_season_placeholder'
		);
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		expect(series.querySelector('option[value=""]')?.textContent?.trim()).toBe(
			'event_create_series_none'
		);
		const conductors = conductorSelect(container);
		expect(promptOption(conductors).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
	});

	it("#248's location datalist wiring is untouched: the location input keeps list= resolving to a real <datalist>, INSIDE its new label", async () => {
		const container = await openReadyForm();

		const location = q(container, 'event-create-location') as HTMLInputElement;
		const listId = location.getAttribute('list');
		expect(listId, 'the location input must keep its list= attribute').toBeTruthy();
		expect(
			document.querySelector(`datalist[id="${listId}"]`),
			`<datalist id="${listId}"> must still exist in the page`
		).not.toBeNull();
	});

	it('NO fieldsets/legends: grouping is explicitly deferred (done-when 5) — labels ship alone', async () => {
		const container = await openReadyForm();

		const form = q(container, 'event-create-form') as HTMLElement;
		expect(form).not.toBeNull();
		expect(
			form.querySelectorAll('fieldset').length,
			"#239's four legends must NOT be copied across mechanically"
		).toBe(0);
		expect(form.querySelectorAll('legend').length).toBe(0);
	});
});

// (*MVOX:Tallis*)

describe('the event-create conductor picker (#321 review F2)', () => {
	const NOTICE = '[data-testid="event-create-conductor-partial-notice"]';

	it('a truncated roster read renders the shared role="status" notice beside the picker', async () => {
		loadRosterMock.mockResolvedValue({ items: fixtureRows(), total: 500, truncated: true });
		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(container.querySelector(NOTICE)).not.toBeNull();
		});
		const notice = container.querySelector(NOTICE)!;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
	});

	it('a complete roster read leaves it ABSENT from the DOM', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await waitFor(() => {
			expect(conductorSelect(container).options.length).toBeGreaterThan(1);
		});

		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

describe('#361 — event-create conductor chip: the member name is marked', () => {
	it('a picked conductor chip renders the name through PersonName — marked, and marked once', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await waitFor(() => {
			expect(optionValues(conductorSelect(container))).toContain('p-ada');
		});
		await pickConductor(container, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'event-create-conductor-p-ada')).not.toBeNull();
		});
		expectNameMarkedOnce(
			q(container, 'event-create-conductor-p-ada') as HTMLElement,
			'Ada Lovelace',
			'in the event-create conductor chip'
		);
	});
});

// (*MVOX:Tallis*)
