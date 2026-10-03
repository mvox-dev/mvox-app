// @vitest-environment happy-dom
// Season-manage conductor add/remove holds a pending state until the write lands.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);

const {
	loadRosterMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	listRepertoireItemsMock,
	deleteRepertoireItemMock,
	updateRepertoireStatusMock,
	getSeriesDefaultsMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	listRepertoireItemsMock: vi.fn(),
	deleteRepertoireItemMock: vi.fn(),
	updateRepertoireStatusMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
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
	createEvent: vi.fn()
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock,
	deleteRepertoireItem: deleteRepertoireItemMock,
	updateRepertoireStatus: updateRepertoireStatusMock
}));
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
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
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

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, loadFullAgendaMock } from '$lib/testing/moduleHandles';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';
const SEASON_B_ID = 'season-2';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: ['p-grace'],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function upcomingSeason(): Season {
	return {
		id: SEASON_B_ID,
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

function agendaResult() {
	const season = currentSeason(true);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function twoSeasonResult() {
	return fullAgendaResult({ seasons: [currentSeason(true), upcomingSeason()] });
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
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
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
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

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

function conductorSelect(container: HTMLElement): HTMLSelectElement {
	const select = q(container, 'season-manage-conductor-select') as HTMLSelectElement | null;
	expect(select, 'expected the native season-manage-conductor-select').not.toBeNull();
	return select!;
}

async function pickConductor(container: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(container), { target: { value: personId } });
}

function expandButtons(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll('[data-testid="season-card-expand"]')
	) as HTMLElement[];
}

function expandFor(container: HTMLElement, seasonName: string): HTMLElement | null {
	return expandButtons(container).find((b) => b.textContent?.includes(seasonName)) ?? null;
}

async function openPanelForSeason(container: HTMLElement, seasonName: string): Promise<void> {
	await waitFor(() => {
		expect(expandFor(container, seasonName), `an entry for ${seasonName}`).not.toBeNull();
	});
	await fireEvent.click(expandFor(container, seasonName) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe(seasonName);
	});
}

describe('#325 conductor — four states at rest (not yet attempted)', () => {
	it('open panel: PERSISTENT empty role="status" region (season-manage-conductor-status, #267 same-node shape), NO pending notice, NO error, select enabled', async () => {
		const container = await renderReady();
		await openPanel(container);

		const status = q(container, 'season-manage-conductor-status');
		expect(status, 'expected the persistent season-manage-conductor-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-error')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

describe('#325 conductor — a write in flight disables the surface (duplicate/lost-remove race closed)', () => {
	it('add in flight: select AND every chip remove button disable; the visible saving notice (caveat-slot paragraph, role="status") shows; a second pick fires NO second POST (a duplicate POST would APPEND a second conductor value); settle → re-enabled, notice gone, saved announced', async () => {
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(1);
		expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');

		await waitFor(() => {
			const notice = q(container, 'season-manage-conductor-pending-notice');
			expect(notice, 'expected the visible pending notice while the write is in flight').not.toBeNull();
			expect(notice!.getAttribute('role')).toBe('status');
			expect(notice!.textContent).toContain('season_manage_conductor_saving');
		});

		expect(conductorSelect(container).disabled).toBe(true);
		expect(
			(q(container, 'season-manage-conductor-remove-p-grace') as HTMLButtonElement).disabled
		).toBe(true);
		const optimisticRemove = q(container, 'season-manage-conductor-remove-p-ada');
		if (optimisticRemove !== null) {
			expect((optimisticRemove as HTMLButtonElement).disabled).toBe(true);
		}

		await pickConductor(container, 'person-p');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		});
		expect(conductorSelect(container).disabled).toBe(false);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-status')?.textContent).toContain(
				'season_manage_conductor_saved'
			);
		});

		await pickConductor(container, 'person-p');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(2);
	});

	it('remove in flight: the select disables and a re-add pick fires NO POST (a re-add the in-flight remove could then delete = the lost-remove race); pending notice shows; settle → saved announced, exactly one DELETE-side call', async () => {
		const d = deferred<undefined>();
		removeSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		expect(removeSeasonConductorMock).toHaveBeenCalledTimes(1);
		expect(removeSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-grace');

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});
		expect(conductorSelect(container).disabled).toBe(true);

		await pickConductor(container, 'p-grace');
		expect(addSeasonConductorMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		});
		expect(removeSeasonConductorMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-status')?.textContent).toContain(
				'season_manage_conductor_saved'
			);
		});
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

describe('#325 conductor — failure text kept, controls re-enabled for retry', () => {
	it('a rejected add keeps the EXISTING season-manage-conductor-error role="alert" (season_manage_save_error), reverts the optimistic chip, drops the pending notice, announces NO saved, and re-enables the select — a retry write fires', async () => {
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValueOnce(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await pickConductor(container, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});

		d.reject(new Error('conductor write rejected'));
		await waitFor(() => {
			const alert = q(container, 'season-manage-conductor-error');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('season_manage_save_error');
		});
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-status')?.textContent ?? '').not.toContain(
			'season_manage_conductor_saved'
		);
		expect(conductorSelect(container).disabled).toBe(false);

		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(2);
	});
});

describe('#325 conductor — the pending flag does not leak across a season switch', () => {
	it('an add on A still in flight when the admin switches to B: B’s panel shows NO pending notice and an ENABLED select; A’s write settling late announces NOTHING and re-raises NO pending on B (seasonManageSwitchGeneration gates the settle path)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
		expect(q(container, 'season-manage-conductor-status')?.textContent?.trim() ?? '').toBe('');

		d.resolve(undefined);
		await flush();

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-status')?.textContent?.trim() ?? '').toBe('');
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

// (*MVOX:Tallis*)
