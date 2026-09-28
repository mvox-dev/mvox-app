// @vitest-environment happy-dom
//
// #434 slice 6/6 RED (agenda integration) — season management and event
// creation are gated while offline, on the REAL agenda +page.svelte (harness:
// page.season-manage.spec.ts — the write seams seasonManage/entityCreate are
// module-mocked with named handles, so "no write" is observable).
//
// CONTRACT — with the signal ($lib/net/online) offline:
//   SEASON MANAGE (season-manage-panel, opened by an editor):
//     • every season-edit-btn-* (name / start_date / end_date), the
//       season-manage-conductor-select, every
//       season-manage-conductor-remove-*, and season-manage-delete-season are
//       disabled;
//     • ONE visible sentence [data-testid="season-manage-write-unavailable"]
//       = m.write_unavailable_no_signal() inside the panel;
//     • a click / change writes nothing: no input opens, updateSeasonField /
//       addSeasonConductor / removeSeasonConductor / deleteSeason are never
//       called and no delete confirm arms;
//     • back online: enabled again, the sentence gone.
//   EVENT CREATE (event-create-form, opened from the panel's [+ Event]):
//     • event-create-submit is disabled and
//       [data-testid="event-create-write-unavailable"] =
//       m.write_unavailable_no_signal() is visible inside the form;
//     • a submit click never calls createEvent; the typed work stays in the
//       form (nothing lost, nothing queued);
//     • back online: submit enabled, sentence gone, the same form submits.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
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
	deleteSeasonMock,
	createEventMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
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
	deleteSeasonMock: vi.fn(),
	createEventMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// T3's data layer — the ONE seam the panel may read/write seasons through.
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	// #277 — the delete-arm race pin drives the title-row trashcan, whose arming
	// fires the live scope read; the rest complete the module so the page never
	// imports `undefined` under this wholesale mock.
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
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock,
	// #277 review 2 F1 — the panel's repertoire WRITE seam, needed by the
	// rollback-after-switch pin. `createRepertoireWriteQueue` stays REAL (the
	// spread above): the guard under test lives in the hooks the page hands it.
	deleteRepertoireItem: deleteRepertoireItemMock,
	updateRepertoireStatus: updateRepertoireStatusMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
// #209 — only the NETWORK read is stubbed; groupBySection (the pure roster-order
// helper the roster page uses) stays real, so option order is computed by the
// same code path the roster page renders with.
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: listSectionsMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Supplementary page data, irrelevant here — mocked so no real fetch fires.
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
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
// The viewer IS a season editor in most cases here, so the page's
// loadManagePickers fires — stub its reads or they hit the network.
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllEditions: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
}));
// #277 — a named handle: the per-season pins assert WHICH season the panel's
// repertoire read targets.
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: listRepertoireItemsMock
}));
// #483 — the page's load path (file presence + the session-wide retention
// sweep, both pre-existing #367/#410 duties unrelated to conductors) reaches
// persistence only through getAppByteStore(); under happy-dom (no IndexedDB)
// that throws, and every render past the file's first logs it. Harmless noise
// none of this file's OTHER tests spy on — but the #483 block below silences
// console.error to keep its own run clean, so the same in-memory double
// layout.retention.spec.ts already uses stands in here too.
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
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = { db: 'sampledb', token: 'jwt-abc' };
const SEASON_ID = 'season-1';

/** ISO calendar date `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

/** The CURRENT season: running now, Grace conducting. */
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

/** An UPCOMING season — since the #261 reopen it does NOT close T2's
 *  [+ Season] gate (rights-only); the CURRENT season stays fully manageable
 *  (the two affordances gate independently). */
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

/**
 * The collective's ONLY season ended yesterday, with nothing queued behind it.
 *
 * Not a "no season" shape: `currentSeason` ignores `end_date` by design and
 * answers `season-0`, and `manageableSeason` has no not-yet-started successor
 * to prefer, so it falls back to that same season (step 3). The builder derives
 * both from the season list, so this is a shape `listFullAgenda` can genuinely
 * return — unlike the earlier hand-pinned version, which claimed
 * `seasonId: null` AND `manageableSeasonId: null` for this very list and so
 * pinned the OPPOSITE of production behaviour (#167 review round 2, F3).
 */
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

/** The season's event series, as the panel lists them: name + event count.
 *  #400 — `ownerIds` includes the viewer ('person-p'): this suite pins panel
 *  mechanics unrelated to the #400 rights gate, so every delete trigger it
 *  exercises must still render. */
function seriesFixture() {
	return [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0, ownerIds: ['person-p'] }
	];
}

/** The season's STANDALONE events (direct children, no series). */
function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

function setAuthedWithOneCollective() {
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

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	// [] = no sections → roster order degrades to the roster's own order.
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
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

/** #261 — expand the season card (the gear is gone), wait for the panel.
 *  Returns the panel element. Routed through the ONE shared helper. */
async function openPanel(container: HTMLElement): Promise<HTMLElement> {
	return await openSeasonCardPanel(container);
}

/** #209 — the panel's NATIVE conductor <select> (rule 1), asserted present. */
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

	// ── review F2 ──────────────────────────────────────────────────────────────
	// The first cut delegated the offline confirm to `cancelSeasonFieldEdit`, so
	// a signal drop mid-edit closed the editor and threw the retyped name away.
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

		// Nothing saves by itself when the signal returns — no queue, no retry.
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

// (*MVOX:Tallis* — #434 slice 6 RED)
