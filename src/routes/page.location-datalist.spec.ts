// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
	createEventMock,
	createEventSeriesMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
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
	createEventSeriesMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
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
	createEventSeries: createEventSeriesMock,
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
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
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
vi.mock('$lib/schedule/scheduleData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/schedule/scheduleData')>()),
	listScheduleItemsByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import type { AgendaItem } from '$lib/agenda/types';
import type { Season } from '$lib/seasons/types';
import type { CreateEventInput, CreateEventSeriesInput } from '$lib/entity/entityCreate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';
const NEW_SERIES_ID = 'series-new-1';

const NEW_VENUE_SERIES = 'Püha Vaimu SAAL — üliuus koht nr 1!';
const NEW_VENUE_EVENT = 'Viinistu katlamaja (uus!)';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

function item(id: string, location: string, startDatetime: string): AgendaItem {
	return {
		id,
		name: `Event ${id}`,
		startDatetime,
		durationMinutes: 90,
		location,
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	};
}

function upcomingWithLocations(): AgendaItem[] {
	return [
		item('up-1', 'Hopneri Maja', '2030-06-10T16:00:00.000Z'),
		item('up-2', 'Estonia Hall', '2030-06-12T16:00:00.000Z'),
		item('up-3', '', '2030-06-14T16:00:00.000Z'),
		item('up-4', 'Hopneri Maja', '2030-06-16T16:00:00.000Z')
	];
}

function recentWithLocations(): AgendaItem[] {
	return [
		item('rec-1', 'Niguliste muuseum', '2026-05-01T18:00:00.000Z'),
		item('rec-2', 'Estonia Hall', '2026-04-01T18:00:00.000Z'),
		item('rec-3', '', '2026-03-01T18:00:00.000Z')
	];
}

const EXPECTED_SET = ['Estonia Hall', 'Hopneri Maja', 'Niguliste muuseum'];

function agendaResult(opts: { upcoming?: AgendaItem[]; recent?: AgendaItem[] } = {}) {
	const season = currentSeason();
	return fullAgendaResult({
		upcoming: opts.upcoming ?? upcomingWithLocations(),
		recent: opts.recent ?? recentWithLocations(),
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

function setAuthedWithOneCollective() {
	signIn();
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchSpy = vi.fn(async () => new Response(JSON.stringify({ entities: [] }), { status: 200 }));
	vi.stubGlobal('fetch', fetchSpy);
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	]));
	listSectionsMock.mockResolvedValue([]);
	createEventMock.mockResolvedValue('ev-new-1');
	createEventSeriesMock.mockResolvedValue(NEW_SERIES_ID);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listSeriesOptionsForSeasonMock.mockResolvedValue(
		seriesFixture().map(({ id, name }) => ({ id, name }))
	);
	listEventsForSeasonMock.mockResolvedValue(toListRead(standaloneFixture()));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(null);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	createEventMock.mockReset();
	createEventSeriesMock.mockReset();
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
		expect(q(container, 'agenda-skeleton')).toBeNull();
	});
	await waitFor(() => {
		expect(q(container, 'season-card-expand')).not.toBeNull();
	});
	return container;
}

async function openPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
}

async function openSeriesForm(container: HTMLElement): Promise<void> {
	await openPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
}

async function openEventForm(container: HTMLElement): Promise<void> {
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

function resolveDatalist(input: HTMLInputElement): HTMLElement {
	const listId = input.getAttribute('list');
	expect(listId, `input ${input.getAttribute('data-testid')} must carry list=`).toBeTruthy();
	const dl = document.querySelector(`datalist[id="${listId}"]`);
	expect(dl, `<datalist id="${listId}"> must exist in the page`).not.toBeNull();
	return dl as HTMLElement;
}

function optionSet(dl: HTMLElement): string[] {
	return [...dl.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value).sort();
}

function locationInput(container: HTMLElement, testid: string): HTMLInputElement {
	const el = q(container, testid);
	expect(el, `${testid} must render`).not.toBeNull();
	return el as HTMLInputElement;
}

function entityFetchCalls(): unknown[][] {
	return fetchSpy.mock.calls.filter(
		(c) => String(c[0]).includes('entity') && !String(c[0]).includes('entity/up-1?props=event_name')
	);
}

describe('#248 — series-create-location suggests previously used venues', () => {
	it('carries list= naming a real <datalist> whose options are the deduped, blank-dropped union of agendaItems + recentItems locations — with ZERO new fetch', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const input = locationInput(container, 'series-create-location');
		expect(input.type).toBe('text');
		const dl = resolveDatalist(input);
		expect(optionSet(dl)).toEqual(EXPECTED_SET);

		expect(entityFetchCalls()).toEqual([]);
	});

	it('stays a frictionless free-text control: not required, no pattern, no maxlength — and typing a brand-new venue raises no alert in the form', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const input = locationInput(container, 'series-create-location');
		expect(input.required).toBe(false);
		expect(input.getAttribute('pattern')).toBeNull();
		expect(input.getAttribute('maxlength')).toBeNull();
		expect(input.getAttribute('aria-invalid')).not.toBe('true');

		await fill(container, 'series-create-location', NEW_VENUE_SERIES);
		expect(input.getAttribute('aria-invalid')).not.toBe('true');
		expect(
			(q(container, 'series-create-form') as HTMLElement).querySelector('[role="alert"]')
		).toBeNull();
	});
});

describe('#248 — event-create-location suggests previously used venues', () => {
	it('carries list= naming a real <datalist> with the SAME derived set (one shared derivation — both forms are siblings on this page); still zero fetch', async () => {
		const container = await renderReady();
		await openPanel(container);
		await openEventForm(container);

		const input = locationInput(container, 'event-create-location');
		expect(input.type).toBe('text');
		const dl = resolveDatalist(input);
		expect(optionSet(dl)).toEqual(EXPECTED_SET);
		expect(entityFetchCalls()).toEqual([]);
	});

	it('both inputs resolve to the SAME suggestion set (opened in sequence — the season-manage panel is single-action-context per #132/T6: opening one create form closes the other, so the two are never mounted simultaneously; captured per-input, set equality pinned)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesSet = optionSet(resolveDatalist(locationInput(container, 'series-create-location')));

		await openEventForm(container);
		const eventSet = optionSet(resolveDatalist(locationInput(container, 'event-create-location')));

		expect(seriesSet).toEqual(EXPECTED_SET);
		expect(eventSet).toEqual(EXPECTED_SET);
	});

	it('no locations anywhere in the agenda → the resolved datalist offers NOTHING (no invented options), and the input still renders as plain free text', async () => {
		loadFullAgendaMock.mockResolvedValue(
			agendaResult({
				upcoming: [item('up-b1', '', '2030-06-10T16:00:00.000Z')],
				recent: [item('rec-b1', '', '2026-05-01T18:00:00.000Z')]
			})
		);
		const container = await renderReady();
		await openPanel(container);
		await openEventForm(container);

		const input = locationInput(container, 'event-create-location');
		expect(input.type).toBe('text');
		const dl = resolveDatalist(input);
		expect(optionSet(dl)).toEqual([]);
	});
});

describe('#248 — a brand-new venue saves exactly as typed (wire unchanged)', () => {
	it('series submit: the mismatching venue arrives at createEventSeries as defaultLocation, byte-identical, inside the unchanged full input shape', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-21');
		await selectValue(container, 'series-create-day', '1');
		await fill(container, 'series-create-location', NEW_VENUE_SERIES);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		const input = createEventSeriesMock.mock.calls[0][1] as CreateEventSeriesInput;
		expect(input.defaultLocation).toBe(NEW_VENUE_SERIES);
		const { defaultDescription, ...rest } = input;
		expect(rest).toEqual({
			name: 'Monday rehearsals',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			intervalDays: 7,
			startTime: '19:00',
			durationMinutes: 90,
			startDate: '2026-09-07',
			endDate: '2026-09-21',
			defaultLocation: NEW_VENUE_SERIES
		});
		expect(defaultDescription ?? '').toBe('');
		expect(createEventSeriesMock).toHaveBeenCalledWith(CFG, input);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
	});

	it('event submit: the mismatching venue arrives at createEvent as location, byte-identical, inside the unchanged full input shape', async () => {
		const container = await renderReady();
		await openPanel(container);
		await openEventForm(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await selectValue(container, 'event-create-type', 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await fillTime(container, 'event-create-end', '21:00');
		await fill(container, 'event-create-location', NEW_VENUE_EVENT);
		await fill(container, 'event-create-description', 'Doors at 18:30');
		await fireEvent.change(
			(q(container, 'event-create-conductors-field') as HTMLElement).querySelector(
				'[data-testid="event-create-conductor-select"]'
			) as HTMLSelectElement,
			{ target: { value: 'p-ada' } }
		);
		await fill(container, 'event-create-capacity', '300');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		const input = createEventMock.mock.calls[0][1] as CreateEventInput;
		expect(input.location).toBe(NEW_VENUE_EVENT);
		expect(input).toEqual({
			name: 'Spring concert',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z',
			durationMinutes: 120,
			location: NEW_VENUE_EVENT,
			description: 'Doors at 18:30',
			conductorRefs: ['p-ada'],
			capacity: 300
		});
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
	});
});

// (*MVOX:Tallis*)
