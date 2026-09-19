// @vitest-environment happy-dom
//
// #400 RED — the series-delete trigger asks the SERIES' own rights, on the
// ACTUAL agenda route (integration: real +page.svelte, real season-manage
// panel; only the data seams are mocked — same harness family as
// page.season-manage-delete.spec.ts).
//
// WHY (issue #400, epic #362 rules 1-2): the season-manage panel's gate is
// season-level (`_owner`/`_editor` on the SEASON), but Entu's entity DELETE
// checks `_owner` on the TARGET — the series itself ("Only _owner users can
// delete an entity"). A season _editor who did not create a series inherits
// _editor on it (tier-for-tier), holds no `_owner`, and every delete they were
// shown was a foreseeable 403 the app papered over with the `forbidden`
// fallback copy. Entu's grants are the only authority: the delete trigger
// renders ONLY when the caller's personId is among that series' OWN `_owner`
// refs (`ownerIds` on the list row — seasonManage.seriesOwner.spec.ts pins the
// wire side).
//
// Pinned contract (GREEN must implement):
//   - series whose ownerIds INCLUDE the caller → `season-manage-series-delete-
//     {id}` renders, as before;
//   - series whose ownerIds EXCLUDE the caller — or are [] (private bucket
//     withheld: no grant visible IS no grant) → NO delete trigger on that row,
//     while the row itself (name, event count) stays;
//   - the `forbidden` fallback copy stays in code (page.season-manage-delete.
//     spec.ts pins it) but is UNREACHABLE from a rendered control: a not-owned
//     series offers no click path to the delete write at all;
//   - every OTHER control behind the season-level gate is untouched: panel
//     entry, season delete, name/date edit, conductor chips + select,
//     add-series, add-event all render exactly as before for a season editor.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; no new strings in #400.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params === undefined ? String(key) : `${String(key)} ${JSON.stringify(params)}`
		}
	)
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
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
	getSeriesDefaultsMock,
	deleteEventMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
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
	getSeriesDefaultsMock: vi.fn(),
	deleteEventMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEvent: deleteEventMock,
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
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
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
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';
/** The viewer. A season EDITOR (the panel's gate) — deliberately NOT the
 *  creator/owner of every series inside it: that is issue #400's exact case. */
const VIEWER = 'person-p';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		// One conductor, so the chip + its × render — part of the "every other
		// control unchanged" pin below.
		conductors: ['cond-1'],
		owners: [],
		editors: [VIEWER]
	};
}

function agendaResult() {
	const season = currentSeason();
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

/** A series row as the widened data layer returns it — `ownerIds` is the
 *  series' OWN `_owner` refs, ids only (ER-26). */
interface OwnedSeriesRow {
	id: string;
	name: string;
	eventCount: number;
	ownerIds: string[];
}

/** The three #400 cases side by side, in ONE list:
 *   - mine:    the viewer IS among the series' owners (they created it) → keeps
 *              its delete trigger;
 *   - theirs:  owners visible but the viewer is NOT among them → no trigger;
 *   - opaque:  `_owner` came back absent (private bucket withheld — the caller
 *              holds no grant on that series at all) → no trigger, same as
 *              theirs: no visible grant IS no grant, fail closed. */
function threeSeries(): OwnedSeriesRow[] {
	return [
		{ id: 'series-mine', name: 'Monday rehearsals', eventCount: 12, ownerIds: [VIEWER, 'person-x'] },
		{ id: 'series-theirs', name: 'Sectionals', eventCount: 3, ownerIds: ['person-other'] },
		{ id: 'series-opaque', name: 'Concert week', eventCount: 0, ownerIds: [] }
	];
}

let seriesRows: OwnedSeriesRow[] = [];

function setAuthedWithOneCollective(): void {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: VIEWER },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: VIEWER }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

beforeEach(() => {
	seriesRows = threeSeries();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockImplementation(async () => toSeriesRead([...seriesRows]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: '',
		durationMinutes: null,
		defaultLocation: '',
		defaultDescription: ''
	});
	deleteEventMock.mockResolvedValue(undefined);
	deleteEventSeriesMock.mockResolvedValue(0);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
	deleteSeasonMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
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
	getSeriesDefaultsMock.mockReset();
	deleteEventMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
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

/** Expand the season card, wait for the panel AND the series rows. */
async function openPanelWithRows(container: HTMLElement): Promise<HTMLElement> {
	const panel = await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, `season-manage-series-${seriesRows[0].id}`)).not.toBeNull();
	});
	return panel;
}

/** Every rendered series-delete AFFORDANCE on the page — trigger and armed
 *  confirm alike (both share the `season-manage-series-delete-` prefix), so
 *  "no affordance" means no click path to the delete write at all. */
function allSeriesDeleteAffordances(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid^="season-manage-series-delete-"]'));
}

// ── #400: the trigger derives from the SERIES' own _owner ───────────────────────

describe('agenda — #400 series-delete renders only with _owner on the series itself (integration: real route)', () => {
	it('a series whose _owner includes the caller keeps its delete trigger', async () => {
		const container = await renderReady();
		const panel = await openPanelWithRows(container);

		const btn = q(container, 'season-manage-series-delete-series-mine') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.tagName).toBe('BUTTON');
		expect(btn.getAttribute('aria-label') || btn.textContent?.trim()).toBeTruthy();
		expect(panel.contains(btn)).toBe(true);
	});

	it('a series whose _owner EXCLUDES the caller renders NO delete trigger — while the row itself (name, event count) stays', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		// The row is readable data — never hidden behind an app predicate.
		const row = q(container, 'season-manage-series-series-theirs') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.textContent).toContain('Sectionals');
		// The event-count sentence survives too (a control left, not the row).
		expect(row.textContent).toContain('season_manage_series_event_count');

		// The write's grant is not in hand → the write's control does not render.
		expect(q(container, 'season-manage-series-delete-series-theirs')).toBeNull();
	});

	it('a series whose _owner came back ABSENT (private bucket withheld — no visible grant) renders NO delete trigger: fail closed', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		expect(q(container, 'season-manage-series-series-opaque')).not.toBeNull();
		expect(q(container, 'season-manage-series-delete-series-opaque')).toBeNull();
	});

	it('mixed list: EXACTLY one delete trigger on the page, inside the owned series’ own row', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		const affordances = allSeriesDeleteAffordances(container);
		expect(affordances).toHaveLength(1);
		expect(affordances[0].getAttribute('data-testid')).toBe(
			'season-manage-series-delete-series-mine'
		);
		expect(
			affordances[0].closest('[data-testid="season-manage-series-series-mine"]')
		).not.toBeNull();
	});
});

// ── #400: the forbidden fallback stays, but no rendered control reaches it ──────

describe('agenda — #400 the forbidden fallback is unreachable from a rendered control', () => {
	it('with only NOT-owned series in the list there is NO series-delete affordance anywhere, and the delete write is never called', async () => {
		seriesRows = [
			{ id: 'series-theirs', name: 'Sectionals', eventCount: 3, ownerIds: ['person-other'] },
			{ id: 'series-opaque', name: 'Concert week', eventCount: 0, ownerIds: [] }
		];
		const container = await renderReady();
		await openPanelWithRows(container);

		// No trigger, no armed confirm — no click path to the cascade at all.
		// (The `season_manage_delete_forbidden` copy itself stays in code as the
		// backstop for a grant revoked mid-session; its rendering contract is
		// pinned in page.season-manage-delete.spec.ts and does not move.)
		expect(allSeriesDeleteAffordances(container)).toHaveLength(0);
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(countSeriesOccurrencesMock).not.toHaveBeenCalled();
	});
});

// ── #400: everything ELSE behind the season-level gate is untouched ─────────────

describe('agenda — #400 the season-level gate still wraps every other control unchanged', () => {
	it('a season editor with NO grant on any listed series still gets: panel entry, season delete, name/date edit, conductor chip + × + select, add-series, add-event', async () => {
		seriesRows = [
			{ id: 'series-theirs', name: 'Sectionals', eventCount: 3, ownerIds: ['person-other'] }
		];
		const container = await renderReady();
		await openPanelWithRows(container);

		// Panel entry (the card) opened above; the panel is standing.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		// The season's own delete — the SEASON gate's control, not the series'.
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		// Field edit activators: name + both date bounds.
		expect(q(container, 'season-edit-btn-name')).not.toBeNull();
		expect(q(container, 'season-edit-btn-start_date')).not.toBeNull();
		expect(q(container, 'season-edit-btn-end_date')).not.toBeNull();
		// Conductor management: the chip, its remove ×, and the add select.
		expect(q(container, 'season-manage-conductor-cond-1')).not.toBeNull();
		expect(q(container, 'season-manage-conductor-remove-cond-1')).not.toBeNull();
		expect(q(container, 'season-manage-conductor-select')).not.toBeNull();
		// Creation entry points.
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
});

// (*MVOX:Tallis* — #400 RED)
