// @vitest-environment happy-dom
// Offline, no enabled control on any page that writes reaches a write seam or the wire.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
	resolveManageRights: vi.fn(),
	listEventSeriesForSeason: vi.fn(),
	listSeriesOptionsForSeason: vi.fn(),
	listEventsForSeason: vi.fn(),
	listRepertoireItems: vi.fn(),
	getSeriesDefaults: vi.fn(),
	countSeriesOccurrences: vi.fn(),
	countSeasonScope: vi.fn(),
	updateSeasonField: vi.fn(),
	addSeasonConductor: vi.fn(),
	removeSeasonConductor: vi.fn(),
	deleteEventSeries: vi.fn(),
	deleteSeason: vi.fn(),
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: vi.fn(),
	createRepertoireItem: vi.fn(),
	deleteRepertoireItem: vi.fn(),
	updateRepertoireStatus: vi.fn(),
	pinEdition: vi.fn(),
	reorderProgramItems: vi.fn(),
	createProgramItem: vi.fn(),
	deleteProgramItem: vi.fn(),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn()
}));
const BS = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
const pageStub = vi.hoisted(() => ({ params: { id: 'ev1' }, url: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: H.resolveManageRights,
	createRepertoireItem: H.createRepertoireItem,
	deleteRepertoireItem: H.deleteRepertoireItem,
	updateRepertoireStatus: H.updateRepertoireStatus,
	pinEdition: H.pinEdition,
	reorderProgramItems: H.reorderProgramItems,
	createProgramItem: H.createProgramItem,
	deleteProgramItem: H.deleteProgramItem
}));
vi.mock('$lib/seasons/seasonManage', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/seasons/seasonManage')>()),
	listEventSeriesForSeason: H.listEventSeriesForSeason,
	listSeriesOptionsForSeason: H.listSeriesOptionsForSeason,
	listEventsForSeason: H.listEventsForSeason,
	updateSeasonField: H.updateSeasonField,
	addSeasonConductor: H.addSeasonConductor,
	removeSeasonConductor: H.removeSeasonConductor,
	getSeriesDefaults: H.getSeriesDefaults,
	deleteEventSeries: H.deleteEventSeries,
	countSeriesOccurrences: H.countSeriesOccurrences,
	countSeasonScope: H.countSeasonScope,
	deleteSeason: H.deleteSeason
}));
vi.mock('$lib/entity/entityCreate', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/entity/entityCreate')>()),
	createSeason: H.createSeason,
	createEventSeries: H.createEventSeries,
	createEvent: H.createEvent
}));
vi.mock('$lib/repertoire/repertoireData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/repertoireData')>()),
	listRepertoireItems: H.listRepertoireItems
}));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => BS.current }));
vi.mock('$lib/attendance/attendanceData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: H.createAttendance,
	updateAttendanceStatus: H.updateAttendanceStatus,
	deleteAttendance: H.deleteAttendance
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/rsvp/rsvpData', async (importOriginal) => {
	const handles = await import('$lib/testing/moduleHandles');
	return {
		...(await importOriginal<object>()),
		findMyMemberId: handles.findMyMemberIdMock,
		listMyRsvps: handles.listMyRsvpsMock,
		createRsvp: H.createRsvp,
		updateRsvpStatus: H.updateRsvpStatus,
		deleteRsvp: H.deleteRsvp
	};
});
vi.mock('$lib/roster/rosterData', async (importOriginal) => {
	const roster = await import('$lib/testing/mocks/roster');
	return {
		...(await roster.rosterOverRealModule(importOriginal)),
		listActiveMembers: roster.listActiveMembersMock
	};
});
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/profile/linkedIdentities', async (importOriginal) => ({
	...(await importOriginal<object>()),
	...(await import('$lib/testing/mocks/profile')).noLinkedIdentitiesModule(),
	...(await import('$lib/testing/mocks/admin')).joinStatesModule()
}));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);
vi.mock('$lib/nav/adminStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).adminStoreOverRealModule(importOriginal)
);
vi.mock('$lib/admin/roleManagement', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).roleManagementOverRealModule(importOriginal)
);
vi.mock('$lib/collectives/collectiveName', async (importOriginal) => ({
	...(await importOriginal<object>()),
	...(await import('$lib/testing/mocks/admin')).collectiveNameModule()
}));
vi.mock('$lib/invite/inviteData', async (importOriginal) => {
	const admin = await import('$lib/testing/mocks/admin');
	return {
		...(await importOriginal<object>()),
		resolvePersonParentId: admin.resolveParentMock,
		resolveInviteParentId: admin.resolveInviteParentMock,
		createInvite: admin.createInviteMock
	};
});

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	nonGetCalls,
	isWriteDisabled,
	expectVisibleReason,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { createFakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock
} from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { listAllCopiesMock, listAllEditionsMock, listWorksMock } from '$lib/testing/mocks/library';
import { resetAdmin } from '$lib/nav/adminStore';
import { resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { agendaViewStore, readStoredAgendaView } from '$lib/preferences/agendaView';
import { readStoredTimeFormat, timeFormatStore } from '$lib/preferences/timeFormat';
import {
	WRITE_PAGES,
	WRITE_PAGE_HANDLES,
	renderWritable,
	stubWriteWire,
	writingPages
} from '$lib/testing/pages/writePages';
import { SEASON_ID, isoDate } from '$lib/testing/pages/seasonPanel';
import { setAuthed } from '$lib/testing/pages/links';

const ORG = '69c7f8718489bfcb0e81b065';

function agendaResult() {
	return fullAgendaResult({
		seasonId: SEASON_ID,
		seasonConductors: ['p-grace'],
		seasonOwners: ['person-p'],
		seasonEditors: ['person-p'],
		seasons: [
			{
				id: SEASON_ID,
				name: 'Season 2026',
				startDate: isoDate(-30),
				endDate: isoDate(60),
				conductors: ['p-grace'],
				owners: ['person-p'],
				editors: ['person-p']
			}
		]
	});
}

function writeSeams(): [string, ReturnType<typeof vi.fn>][] {
	return [
		['updateSeasonField', H.updateSeasonField],
		['addSeasonConductor', H.addSeasonConductor],
		['removeSeasonConductor', H.removeSeasonConductor],
		['deleteEventSeries', H.deleteEventSeries],
		['deleteSeason', H.deleteSeason],
		['createSeason', H.createSeason],
		['createEventSeries', H.createEventSeries],
		['createEvent', H.createEvent],
		['createRepertoireItem', H.createRepertoireItem],
		['deleteRepertoireItem', H.deleteRepertoireItem],
		['updateRepertoireStatus', H.updateRepertoireStatus],
		['pinEdition', H.pinEdition],
		['reorderProgramItems', H.reorderProgramItems],
		['createProgramItem', H.createProgramItem],
		['deleteProgramItem', H.deleteProgramItem],
		['createRsvp', H.createRsvp],
		['updateRsvpStatus', H.updateRsvpStatus],
		['deleteRsvp', H.deleteRsvp],
		['createAttendance', H.createAttendance],
		['updateAttendanceStatus', H.updateAttendanceStatus],
		['deleteAttendance', H.deleteAttendance]
	];
}

let fetchStub: ReturnType<typeof vi.fn>;

beforeEach(() => {
	BS.current = createFakeByteStore();
	fetchStub = vi.fn(
		async () => new Response(JSON.stringify({ entities: [] }), { status: 200 })
	);
	vi.stubGlobal('fetch', fetchStub);
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(
		toListRead([
			{
				memberId: 'm-grace',
				personId: 'p-grace',
				name: 'Grace Hopper',
				email: 'grace@x.com',
				sectionIds: [],
				dbEntityId: ORG
			},
			{
				memberId: 'm-pete',
				personId: 'person-p',
				name: 'Pete Wilson',
				email: 'pete@x.com',
				sectionIds: [],
				dbEntityId: ORG
			}
		])
	);
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG);
	H.resolveManageRights.mockResolvedValue('editor');
	findMyMemberIdMock.mockResolvedValue('m-pete');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listWorksMock.mockResolvedValue(
		toListRead([{ id: 'work-1', name: 'Missa Brevis', composer: 'Palestrina' }])
	);
	listAllEditionsMock.mockResolvedValue(
		toListRead([{ id: 'ed-1', name: 'Carus 1998', publisher: 'Carus', workId: 'work-1' }])
	);
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	H.listEventSeriesForSeason.mockResolvedValue(
		toSeriesRead([{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] }])
	);
	H.listSeriesOptionsForSeason.mockResolvedValue([{ id: 'series-1', name: 'Monday rehearsals' }]);
	H.listEventsForSeason.mockResolvedValue(toListRead([]));
	H.listRepertoireItems.mockResolvedValue([
		{ id: 'rep-1', workId: 'work-1', name: 'Missa Brevis', status: 'active', editionId: null }
	]);
	H.getSeriesDefaults.mockResolvedValue({});
	H.countSeriesOccurrences.mockResolvedValue(12);
	H.countSeasonScope.mockResolvedValue({ series: 1, events: 0, repertoireItems: 1 });
	for (const [, mock] of writeSeams()) mock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	for (const value of Object.values(H)) value.mockReset();
	for (const handle of WRITE_PAGE_HANDLES) handle.mockReset();
	gotoMock.mockReset();
	discoverMock.mockReset();
	resetOnLine();
	resetAppState();
	resetGate();
	resetAdmin();
	resetTypeIdCache();
	localStorage.clear();
	agendaViewStore.set(readStoredAgendaView());
	timeFormatStore.set(readStoredTimeFormat());
	history.replaceState({}, '', '/');
});

async function renderPanelOpenOnline(): Promise<HTMLElement> {
	await goOnline();
	setAuthed();
	const { container } = render(Page);
	const panel = await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(panel.querySelector('[data-testid="season-edit-btn-name"]')).not.toBeNull();
		expect(panel.querySelector('[data-testid="season-manage-series-delete-series-1"]')).not.toBeNull();
	});
	await settle();
	return container;
}

describe('agenda — no write control reaches the wire offline (#434 slice 6 fence)', () => {
	it('offline: operating every enabled control calls no write seam and issues no non-GET', async () => {
		const container = await renderPanelOpenOnline();
		await goOffline();
		await settle();
		for (const [, mock] of writeSeams()) mock.mockClear();
		fetchStub.mockClear();

		const touched = await exerciseEveryEnabledControl(container, {
			skip: ['season-card-collapse']
		});

		expect(touched.length).toBeGreaterThan(5);
		for (const [name, mock] of writeSeams()) {
			expect(mock.mock.calls, `${name} was called while offline`).toEqual([]);
		}
		expect(nonGetCalls(fetchStub)).toEqual([]);
	});

	it('the controls the review found live are disabled offline, and say why', async () => {
		const container = await renderPanelOpenOnline();
		await goOffline();

		await waitFor(() => {
			for (const testid of [
				'season-manage-series-delete-series-1',
				'season-manage-delete-season',
				'work-manage-remove',
				'work-status-active'
			]) {
				const el = container.querySelector(`[data-testid="${testid}"]`);
				expect(el, testid).not.toBeNull();
				expect(isWriteDisabled(el!), testid).toBe(true);
			}
		});
		expect(
			container.querySelectorAll('[data-testid="season-manage-write-unavailable"]')
		).toHaveLength(1);
		expect(
			container.querySelectorAll('[data-testid="repertoire-write-unavailable"]').length
		).toBeGreaterThan(0);
	});
});

describe('every page that writes — offline, no enabled control reaches the wire', () => {
	it('the table covers every page whose components read the write gate', () => {
		expect(Object.keys(WRITE_PAGES).sort()).toEqual(writingPages());
	});

	it.each(Object.keys(WRITE_PAGES))('%s: operating every enabled control offline writes nothing', async (route) => {
		const sweepFetch = stubWriteWire(WRITE_PAGES[route]);
		await goOnline();
		const { container } = await renderWritable(WRITE_PAGES[route], pageStub);
		await goOffline();
		await settle();
		for (const [, mock] of writeSeams()) mock.mockClear();
		sweepFetch.mockClear();

		await exerciseEveryEnabledControl(container);

		for (const [name, mock] of writeSeams()) {
			expect(mock.mock.calls, `${name} was called while offline`).toEqual([]);
		}
		expect(nonGetCalls(sweepFetch)).toEqual([]);
	});

	it.each(Object.keys(WRITE_PAGES))('%s: offline says why in visible text, and back online the reason goes', async (route) => {
		stubWriteWire(WRITE_PAGES[route]);
		await goOnline();
		const { container } = await renderWritable(WRITE_PAGES[route], pageStub);
		const reasons = () => [...container.querySelectorAll<HTMLElement>('[data-testid$="-write-unavailable"]')];
		expect(reasons()).toEqual([]);

		await goOffline();
		await waitFor(() => expect(reasons().length).toBeGreaterThan(0));
		for (const reason of reasons()) {
			expectVisibleReason(container, reason.dataset.testid!, '[write_unavailable_no_signal]');
		}

		await goOnline();
		await waitFor(() => expect(reasons()).toEqual([]));
	});
});

// (*MVOX:Josquin*)
