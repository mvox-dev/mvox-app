// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	loadRosterMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	listRepertoireItemsMock,
	getSeriesDefaultsMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock,
	createEventMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	listRepertoireItemsMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn(),
	createEventMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock,
	countSeasonScope: countSeasonScopeMock,
	deleteSeason: deleteSeasonMock
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal(), { writes: true })
);
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: listRepertoireItemsMock
}));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	isWriteDisabled
} from '$lib/testing/networkSignal';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';
import {
	deleteRepertoireItemMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	updateRepertoireStatusMock
} from '$lib/testing/moduleHandles';

let fakeByteStore: FakeByteStore;

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: ['p-grace'],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function upcomingSeason(): Season {
	return {
		id: 'season-2',
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
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0, ownerIds: ['person-p'] }
	];
}

function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
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
	listRepertoireItemsMock.mockResolvedValue([]);
	deleteRepertoireItemMock.mockResolvedValue(undefined);
	updateRepertoireStatusMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({});
	deleteEventSeriesMock.mockResolvedValue(undefined);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 0, events: 0, repertoireItems: 0 });
	deleteSeasonMock.mockResolvedValue(undefined);
	createEventMock.mockResolvedValue('ev-new-1');
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
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
	listRepertoireItemsMock.mockReset();
	deleteRepertoireItemMock.mockReset();
	updateRepertoireStatusMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
	createEventMock.mockReset();
	resetOnLine();
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

async function openPanel(container: HTMLElement): Promise<HTMLElement> {
	return await openSeasonCardPanel(container);
}

function conductorSelect(panel: HTMLElement): HTMLSelectElement {
	const select = panel.querySelector(
		'[data-testid="season-manage-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'expected the native season-manage-conductor-select').not.toBeNull();
	expect(select.tagName).toBe('SELECT');
	return select;
}

const REASON = '[write_unavailable_no_signal]';

async function renderPanelOnline(): Promise<{ container: HTMLElement; panel: HTMLElement }> {
	await goOnline();
	const container = await renderReady();
	const panel = await openPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-edit-btn-name')).not.toBeNull();
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		expect(conductorSelect(panel)).not.toBeNull();
		expect(q(container, 'season-manage-conductor-remove-p-grace')).not.toBeNull();
	});
	return { container, panel };
}

function seasonWriteControls(container: HTMLElement): HTMLElement[] {
	return [
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="season-edit-btn-"]')),
		...Array.from(
			container.querySelectorAll<HTMLElement>('[data-testid^="season-manage-conductor-remove-"]')
		),
		q(container, 'season-manage-conductor-select') as HTMLElement,
		q(container, 'season-manage-delete-season') as HTMLElement
	];
}

describe('agenda — season management while offline (#434 slice 6)', () => {
	it('offline: every season write control is disabled and the reason is visible in the panel', async () => {
		const { container, panel } = await renderPanelOnline();
		expect(seasonWriteControls(container).length).toBeGreaterThanOrEqual(6);
		await goOffline();

		await waitFor(() => {
			for (const c of seasonWriteControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(true);
			}
		});
		expectVisibleReason(panel, 'season-manage-write-unavailable', REASON);
		expect(panel.querySelectorAll('[data-testid="season-manage-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: edit, conductor add/remove and delete write nothing', async () => {
		const { container, panel } = await renderPanelOnline();
		await goOffline();

		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await settle();
		expect(q(container, 'season-edit-input-name'), 'no edit input opens').toBeNull();

		await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
		await settle();
		expect(q(container, 'season-manage-delete-season-confirm'), 'no delete arms').toBeNull();

		await fireEvent.change(conductorSelect(panel), { target: { value: 'p-ada' } });
		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		await settle();

		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(addSeasonConductorMock).not.toHaveBeenCalled();
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('a signal drop mid-edit KEEPS the typed season name — the draft is not discarded', async () => {
		const { container, panel } = await renderPanelOnline();
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		const input = await waitFor(() => {
			const el = q(container, 'season-edit-input-name') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Season of Rain' } });
		await goOffline();

		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();

		const still = q(container, 'season-edit-input-name') as HTMLInputElement | null;
		expect(still, 'the editor stays open on her text').not.toBeNull();
		expect(still!.value).toBe('Season of Rain');
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expectVisibleReason(panel, 'season-edit-held-offline', '[write_held_no_signal]');
	});

	it('the held season draft commits on one more Enter once the signal is back', async () => {
		const { container } = await renderPanelOnline();
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		const input = await waitFor(() => {
			const el = q(container, 'season-edit-input-name') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Season of Rain' } });
		await goOffline();
		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();

		await goOnline();
		await settle();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(q(container, 'season-edit-held-offline')).toBeNull();

		const held = q(container, 'season-edit-input-name') as HTMLInputElement;
		expect(held.value).toBe('Season of Rain');
		await fireEvent.keyDown(held, { key: 'Enter' });

		await waitFor(() => expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1));
		expect(JSON.stringify(updateSeasonFieldMock.mock.calls[0])).toContain('Season of Rain');
	});

	it('back online: the controls enable again and the reason is gone', async () => {
		const { container } = await renderPanelOnline();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			for (const c of seasonWriteControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(false);
			}
		});
		expect(q(container, 'season-manage-write-unavailable')).toBeNull();
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => expect(q(container, 'season-edit-input-name')).not.toBeNull());
	});
});

async function openFilledEventForm(container: HTMLElement): Promise<void> {
	await waitFor(() => expect(q(container, 'season-manage-add-event')).not.toBeNull());
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => expect(q(container, 'event-create-form')).not.toBeNull());
	await fireEvent.change(q(container, 'event-create-season') as HTMLElement, {
		target: { value: SEASON_ID }
	});
	await fireEvent.change(q(container, 'event-create-type') as HTMLElement, {
		target: { value: 'concert' }
	});
	await fireEvent.input(q(container, 'event-create-name') as HTMLElement, {
		target: { value: 'Spring concert' }
	});
	await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
	await fillTime(container, 'event-create-end', '21:00');
}

describe('agenda — event creation while offline (#434 slice 6)', () => {
	it('offline: submit is disabled and the reason is visible inside the form', async () => {
		const { container } = await renderPanelOnline();
		await openFilledEventForm(container);
		await goOffline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'event-create-submit') as HTMLElement)).toBe(true);
		});
		expectVisibleReason(
			q(container, 'event-create-form') as HTMLElement,
			'event-create-write-unavailable',
			REASON
		);
	});

	it('offline: a submit click never calls createEvent and the typed work stays in the form', async () => {
		const { container } = await renderPanelOnline();
		await openFilledEventForm(container);
		await goOffline();

		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
		await settle();

		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).value).toBe('Spring concert');
	});

	it('back online: submit enabled, reason gone, and the same form submits', async () => {
		const { container } = await renderPanelOnline();
		await openFilledEventForm(container);
		await goOffline();
		await goOnline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'event-create-submit') as HTMLElement)).toBe(false);
		});
		expect(q(container, 'event-create-write-unavailable')).toBeNull();
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
		await waitFor(() => expect(createEventMock).toHaveBeenCalledTimes(1));
	});
});

// (*MVOX:Tallis*)
