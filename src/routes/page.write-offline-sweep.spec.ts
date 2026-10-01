// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const H = vi.hoisted(() => ({
	loadFullAgenda: vi.fn(),
	loadRoster: vi.fn(),
	listSections: vi.fn(),
	resolveDatabaseEntityId: vi.fn(),
	resolveManageRights: vi.fn(),
	discover: vi.fn(),
	goto: vi.fn(),
	findMyMemberId: vi.fn(),
	listMyRsvps: vi.fn(),
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

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: H.loadFullAgenda }));
vi.mock('$lib/seasons/seasonManage', () => ({
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
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: H.createSeason,
	createEventSeries: H.createEventSeries,
	createEvent: H.createEvent
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: H.resolveDatabaseEntityId
}));
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: H.loadRoster }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: H.listSections
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: H.discover }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: H.goto }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: H.findMyMemberId,
	listMyRsvps: H.listMyRsvps,
	rsvpsByEventId: () => ({}),
	createRsvp: H.createRsvp,
	updateRsvpStatus: H.updateRsvpStatus,
	deleteRsvp: H.deleteRsvp
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: H.createAttendance,
	updateAttendanceStatus: H.updateAttendanceStatus,
	deleteAttendance: H.deleteAttendance,
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue({
		items: [{ id: 'work-1', name: 'Missa Brevis', composer: 'Palestrina' }],
		total: 1,
		truncated: false
	}),
	listAllEditions: vi.fn().mockResolvedValue({
		items: [{ id: 'ed-1', name: 'Carus 1998', publisher: 'Carus', workId: 'work-1' }],
		total: 1,
		truncated: false
	}),
	listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
}));
vi.mock('$lib/repertoire/repertoireData', () => ({ listRepertoireItems: H.listRepertoireItems }));
const BS = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => BS.current }));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	nonGetCalls,
	isWriteDisabled,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { createFakeByteStore } from '$lib/testing/byteStoreFakes';

const ORG = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

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
	H.loadFullAgenda.mockResolvedValue(agendaResult());
	H.loadRoster.mockResolvedValue(
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
	H.listSections.mockResolvedValue([]);
	H.resolveDatabaseEntityId.mockResolvedValue(ORG);
	H.resolveManageRights.mockResolvedValue('editor');
	H.findMyMemberId.mockResolvedValue('m-pete');
	H.listMyRsvps.mockResolvedValue(toListRead([]));
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
	resetOnLine();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function setAuthed(): void {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

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

// (*MVOX:Josquin*)
