// @vitest-environment happy-dom
//
// #167 RED — event/series creation controls after season create, on the ACTUAL
// agenda route (integration: real +page.svelte, real AgendaList, real
// manageRightsFrom; only the data seams are mocked — same harness family as
// page.event-create.spec.ts / page.season-create.spec.ts).
//
// THE BUG (Mihkel, 2026-08-21): create a season via "Loo hooaeg" with a future
// start date → the page reloads to "Eelseisvaid proove ei ole" and NOTHING
// else. No [+ Event], no gear, no way to put a rehearsal into the season just
// created. Two causes: (1) `showEventCreate` gates on `currentSeasonId`, and
// `currentSeason()` refuses future-dated seasons; (2) the admin's rights may
// ride on the DATABASE entity (`_owner`), not visibly on the season read.
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA
//     - `loadFullAgenda` now also returns `manageableSeasonId` /
//       `manageableSeasonOwners` / `manageableSeasonEditors` (see
//       agendaData.spec.ts #167 block): the current season when one runs,
//       else the SOONEST-starting future season. These fixtures return the
//       new shape; the page must GATE ON IT.
//     - `showEventCreate` and the season-manage gear derive from the
//       MANAGEABLE season: manageableSeasonId !== null AND the viewer holds
//       manage rights on it (manageRightsFrom over its owners/editors —
//       ownership subsumes editing). The season-manage panel's season-scoped
//       reads (listEventSeriesForSeason / listEventsForSeason) target the
//       manageable season's id.
//     - RIGHTS FALLBACK (#167 cause 2): when the manageable season's VISIBLE
//       owners+editors are BOTH empty, the page resolves rights from the
//       DATABASE entity instead — `resolveDatabaseEntityId(cfg)` then
//       `resolveManageRights(cfg, orgId, personId)` (the exact seams the
//       season-create org fallback already uses). 'editor' → controls show;
//       anything else (incl. 'error') → fail-closed, controls hidden.
//     - VIEWER semantics unchanged: `seasonId`/recent keep meaning the CURRENT
//       season; a future-only collective still shows the empty agenda list.
//
//   TESTIDS (all pre-existing)
//     event-create             the page-level [+ Event] button
//     event-create-form        the inline creation form; its season <select>
//                              (event-create-season) must OFFER the future season
//     season-manage-gear       opens the season-manage panel for the MANAGEABLE season
//     season-manage-panel      the panel; carries season-manage-add-event and
//                              season-manage-add-series (the series entry point)
//     season-create[-*]        the #132/T2 season-create flow (used by the repro test)
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	createSeasonMock,
	createEventMock,
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
	listEventTypesMock,
	loadWorksByEventIdMock,
	listWorksMock,
	listAllEditionsMock,
	listRepertoireItemsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createSeasonMock: vi.fn(),
	createEventMock: vi.fn(),
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
	listEventTypesMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn(),
	listWorksMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listRepertoireItemsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// T1's write layer — the ONE create seam this page may use.
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
// T3's data layer — the season/series read seams.
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
vi.mock('$lib/events/eventTypes', () => ({ listEventTypes: listEventTypesMock }));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
// `manageRightsFrom` stays REAL — the rights derivation is exactly what #167
// exercises; only the network-touching single-entity probe is mocked.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
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
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
// Named (not anonymous) so the review-F2 tests can assert that the repertoire
// management reads actually re-run once the database-entity answer lands.
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: loadWorksByEventIdMock }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', () => ({
	listWorks: listWorksMock,
	listAllEditions: listAllEditionsMock,
	listAllCopies: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: listRepertoireItemsMock
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { Season } from '$lib/seasons/types';
import type { WorkRow } from '$lib/repertoire/types';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const FUTURE_SEASON_ID = 'season-future-1';

/** ISO calendar date `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** A season that starts strictly in the FUTURE — the just-created #167 shape. */
function futureSeason(rights: { owners?: string[]; editors?: string[] } = {}): Season {
	return {
		id: FUTURE_SEASON_ID,
		name: 'Season 2027',
		startDate: isoDate(14),
		endDate: isoDate(200),
		conductors: [],
		owners: rights.owners ?? [],
		editors: rights.editors ?? []
	};
}

/** The #167 agenda shape: NOTHING is current (viewer fields empty/null — those
 *  semantics are pinned in agendaData.spec.ts and stay), but the future season
 *  is MANAGEABLE. */
function futureOnlyAgenda(season: Season) {
	return fullAgendaResult({
		seasons: [season],
		manageableSeasonId: season.id,
		manageableSeasonOwners: season.owners,
		manageableSeasonEditors: season.editors
	});
}

/** A collective with no seasons at all — the repro test's starting point. */
function emptyAgenda() {
	return fullAgendaResult();
}

const CURRENT_SEASON_ID = 'season-current-1';

/** A season that is RUNNING right now, with NO rights visible on it — the
 *  reporter's own read (#91: a viewer with no grant ON THE SEASON sees no
 *  `_owner`/`_editor` at all, whatever they hold on the database entity). */
function currentSeasonNoVisibleRights(): Season {
	return {
		id: CURRENT_SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(160),
		conductors: [],
		owners: [],
		editors: []
	};
}

/** A current season and one agenda event under it. Viewer + manageable fields
 *  agree (that is what the producer emits when a season is running). */
function currentSeasonAgenda(season: Season) {
	return fullAgendaResult({
		upcoming: [
			{
				id: 'ev-1',
				name: 'Rehearsal',
				startDatetime: new Date(Date.now() + 3600_000).toISOString(),
				durationMinutes: 90,
				location: '',
				conductors: [],
				owners: [],
				editors: []
			}
		],
		seasonId: season.id,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

/** Lets anything already queued — a late reply that WOULD have landed — run
 *  before asserting that it did not. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
	loadRosterMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue([]);
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: ''
	});
	listEventTypesMock.mockResolvedValue(['rehearsal', 'concert']);
	loadWorksByEventIdMock.mockResolvedValue({});
	listWorksMock.mockResolvedValue([]);
	listAllEditionsMock.mockResolvedValue([]);
	listRepertoireItemsMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createSeasonMock.mockReset();
	createEventMock.mockReset();
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
	listEventTypesMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	listWorksMock.mockReset();
	listAllEditionsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── helpers ─────────────────────────────────────────────────────────────────────

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Ready for the fixtures that DO have an agenda row (the current-season
 *  shapes) — `renderReady` waits for the empty state, which never arrives. */
async function renderReadyWithRow(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-row-ev-1')).not.toBeNull();
	});
	return container;
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

// ── the gate: a FUTURE-only season is manageable ────────────────────────────────

describe('#167 — event creation controls with a FUTURE-only season', () => {
	it('viewer is the future season’s EDITOR → [+ Event] renders, opens the form, and the future season is offerable in its season select', async () => {
		loadFullAgendaMock.mockResolvedValue(
			futureOnlyAgenda(futureSeason({ editors: ['person-p'] }))
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-create') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		const seasonSelect = q(container, 'event-create-season') as HTMLSelectElement;
		expect(Array.from(seasonSelect.options).map((o) => o.value)).toContain(FUTURE_SEASON_ID);
	});

	it('viewer is the future season’s OWNER → [+ Event] renders (ownership subsumes editing)', async () => {
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason({ owners: ['person-p'] })));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
	});

	it('NO rights visible on the season, but the viewer holds rights on the DATABASE entity → [+ Event] renders (the #167 cause-2 fallback: Mihkel is `_owner` on the database entity)', async () => {
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		// the fallback probes the DATABASE entity, for THIS person:
		expect(resolveManageRightsMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'polyphony' }),
			ORG_EFK,
			'person-p'
		);
	});

	it('fail-closed: no rights on the season AND none on the database entity → neither [+ Event] nor the gear renders', async () => {
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReady();

		await flush();
		expect(q(container, 'event-create')).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
	});

	it('SERIES creation reachable: editor of the future season → gear renders, the panel opens with [+ Series] and [+ Event], and its season-scoped reads target the FUTURE season', async () => {
		loadFullAgendaMock.mockResolvedValue(
			futureOnlyAgenda(futureSeason({ editors: ['person-p'] }))
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).not.toBeNull();
		});
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(
				expect.anything(),
				FUTURE_SEASON_ID
			);
		});
	});
});

// ── the reported repro, end to end on the route ─────────────────────────────────

describe('#167 — the reported repro: create a season, controls appear', () => {
	it('empty collective → create a FUTURE-dated season via the form → [+ Event] and the gear appear after the refresh', async () => {
		// First load: no seasons at all. After createSeason, the page's refresh
		// (loadFullAgenda re-invoked — pinned in page.season-create.spec.ts)
		// returns the new future-only season with the creator's rights on it.
		loadFullAgendaMock.mockResolvedValueOnce(emptyAgenda());
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason({ owners: ['person-p'] })));
		// The Mihkel case: `_owner` on the database entity (also what lets the
		// no-season collective offer [+ Season] via the org fallback).
		resolveManageRightsMock.mockResolvedValue('editor');

		const container = await renderReady();

		// No season exists yet → season-create offered, event-create not (there
		// is nothing to put an event into).
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();

		await fireEvent.click(q(container, 'season-create') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		await fill(container, 'season-create-name', 'Hooaeg 2027');
		await fill(container, 'season-create-start', isoDate(14));
		await fill(container, 'season-create-end', isoDate(200));
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});

		// THE BUG: after the refresh the page showed only "no upcoming
		// rehearsals". The event/series creation controls MUST be there now.
		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
	});
});

// ── #167 review F1 — a LAPSED season must not capture the admin surface ─────────

describe('#167 review F1 — a lapsed season alongside a just-created one', () => {
	it('the panel and [+ Series] target the NEW season, not the lapsed one whose dates have passed', async () => {
		// What the real producer emits for this collective: `currentSeason`
		// ignores end_date (viewer scoping), so the LAPSED season is still the
		// viewer's `seasonId`; `manageableSeason` prefers the season that has
		// not started yet, which is the one the admin just created.
		const lapsed: Season = {
			id: 'season-lapsed',
			name: 'Season 2025',
			startDate: isoDate(-400),
			endDate: isoDate(-30),
			conductors: [],
			owners: ['person-p'],
			editors: []
		};
		const created = futureSeason({ owners: ['person-p'] });
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasonId: lapsed.id,
				seasonOwners: lapsed.owners,
				seasonEditors: lapsed.editors,
				seasons: [lapsed, created],
				manageableSeasonId: created.id,
				manageableSeasonOwners: created.owners,
				manageableSeasonEditors: created.editors
			})
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).not.toBeNull();
		});
		// The panel — and with it the [+ Series] form, which has no season
		// picker of its own — is scoped to the NEW season.
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(
				expect.anything(),
				FUTURE_SEASON_ID
			);
		});
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalledWith(expect.anything(), lapsed.id);
	});
});

// ── #167 review F2/F3 — ONE database-entity answer, feeding every gate ──────────

describe('#167 review F2 — the database-entity answer is not applied to one gate only', () => {
	it('a CURRENT season with no visible rights + `_owner` on the database entity → event creation AND season creation AND repertoire management, not a contradictory mix', async () => {
		loadFullAgendaMock.mockResolvedValue(currentSeasonAgenda(currentSeasonNoVisibleRights()));
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReadyWithRow();

		// the manageable-season gate (event/series creation)…
		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		// …the season-CREATE gate (nothing upcoming exists to suppress it)…
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		// …and the season-MANAGE gate, whose reads were skipped on the first
		// pass because the answer had not arrived yet: the pickers and the
		// season repertoire load, and the works read re-runs UNFILTERED (a
		// rights-holder must see retired rows — the only place their status
		// toggle lives).
		await waitFor(() => {
			expect(listWorksMock).toHaveBeenCalled();
		});
		expect(listRepertoireItemsMock).toHaveBeenCalledWith(expect.anything(), CURRENT_SEASON_ID);
		await waitFor(() => {
			expect(loadWorksByEventIdMock).toHaveBeenCalledWith(
				expect.anything(),
				['ev-1'],
				CURRENT_SEASON_ID,
				expect.anything(),
				{ includeInactive: true }
			);
		});
	});

	it('fail-closed: the same shape with no database-entity rights leaves EVERY gate shut and the works read filtered', async () => {
		loadFullAgendaMock.mockResolvedValue(currentSeasonAgenda(currentSeasonNoVisibleRights()));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReadyWithRow();

		await flush();
		expect(q(container, 'event-create')).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'season-create')).toBeNull();
		expect(listWorksMock).not.toHaveBeenCalled();
		expect(loadWorksByEventIdMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			{ includeInactive: true }
		);
	});
});

describe('#167 review F3 — the database-entity probe is not paid per agenda load', () => {
	function setAuthedWithTwoCollectives() {
		setToken('jwt-abc');
		authStore.set({
			status: 'authenticated',
			personIdByDb: { 'org-a': 'person-p', 'org-b': 'person-p' },
			expMs: Date.now() + 100_000
		});
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'org-a', name: 'Org A', personId: 'person-p' },
				{ db: 'org-b', name: 'Org B', personId: 'person-p' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('org-a');
	}

	it('switching A → B → A costs ONE probe pair per collective, not one per load (the trigger is every ordinary member’s normal read)', async () => {
		// No rights visible anywhere: the trigger condition every plain singer
		// meets on every single load.
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(2);
		});

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await flush();
		// A's answer was already known — no third pair.
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(2);
		expect(resolveManageRightsMock).toHaveBeenCalledTimes(2);
	});
});

// ── review round 2, F1 — the two works reads of ONE agenda load are ordered ─────

describe('#167 review round 2, F1 — the upgraded works read is not clobbered by the filtered one it raced', () => {
	/** A RETIRED repertoire row: present only in the UNFILTERED read, and the
	 *  only place its status toggle lives. */
	const retiredRow: WorkRow = {
		id: 'ri-retired',
		kind: 'repertoire',
		workId: 'w-1',
		editionId: '',
		workName: 'Vana laul',
		composer: '',
		status: 'retired',
		editionName: '',
		ordinal: null,
		fileId: '',
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};

	it('the FILTERED read settling LAST does not drop the retired rows the database-entity upgrade fetched', async () => {
		loadFullAgendaMock.mockResolvedValue(currentSeasonAgenda(currentSeasonNoVisibleRights()));
		resolveManageRightsMock.mockResolvedValue('editor');

		// The realistic timing the F2 spec cannot reach: the filtered read is a
		// 4-collection JOIN plus one program_item read per event, the probe it
		// races is two GETs. Held open here so the filtered answer lands AFTER
		// the unfiltered one — the ordering a large season actually produces.
		let releaseFiltered: (value: Record<string, WorkRow[]>) => void = () => {};
		const filtered = new Promise<Record<string, WorkRow[]>>((resolve) => {
			releaseFiltered = resolve;
		});
		loadWorksByEventIdMock.mockImplementation(
			(
				_cfg: unknown,
				_ids: unknown,
				_seasonId: unknown,
				_fetch: unknown,
				opts: { includeInactive: boolean }
			) => (opts.includeInactive ? Promise.resolve({ 'ev-1': [retiredRow] }) : filtered)
		);

		const container = await renderReadyWithRow();

		// The upgrade's unfiltered rows are on screen…
		await waitFor(() => {
			expect(q(container, 'works-line')).not.toBeNull();
		});

		// …and now the read they superseded finally answers, with the
		// member-facing view: retired rows filtered out.
		releaseFiltered({});
		await flush();

		// The stale answer must not win. Before the generation counter it did:
		// the row vanished and with it the toggle that brings it back.
		expect(q(container, 'works-line')).not.toBeNull();
		expect(q(container, 'works-manage-empty')).toBeNull();
	});
});

// ── review round 2, F2 — the probe triggers on the CURRENT season too ───────────

describe('#167 review round 2, F2 — a visible grant on the manageable season does not suppress the probe', () => {
	it('lapsed current season with NO visible rights + a future season that HAS them: the database entity is still asked, so repertoire management is not left dead under live controls', async () => {
		// The two entities were created at different moments, so only the newer
		// one inherited the org grant. `manageableSeason` picks the future one
		// (review F1), which makes `manageableRightsInvisible` false — the old
		// trigger. `currentRightsInvisible` is the one that is true here.
		const lapsed: Season = {
			id: 'season-lapsed',
			name: 'Season 2025',
			startDate: isoDate(-400),
			endDate: isoDate(-30),
			conductors: [],
			owners: [],
			editors: []
		};
		const created = futureSeason({ owners: ['person-p'] });
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				upcoming: [
					{
						id: 'ev-1',
						name: 'Rehearsal',
						startDatetime: new Date(Date.now() + 3600_000).toISOString(),
						durationMinutes: 90,
						location: '',
						conductors: [],
						owners: [],
						editors: []
					}
				],
				seasons: [lapsed, created]
			})
		);
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReadyWithRow();

		// The manageable (future) season's own grant already opened these…
		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		expect(q(container, 'season-manage-gear')).not.toBeNull();

		// …and the database entity is asked ANYWAY, on account of the current
		// season showing nothing…
		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'polyphony' }),
				ORG_EFK,
				'person-p'
			);
		});
		// …so the current season's repertoire surface comes alive too, instead of
		// sitting dead underneath live creation controls.
		await waitFor(() => {
			expect(listWorksMock).toHaveBeenCalled();
		});
		expect(listRepertoireItemsMock).toHaveBeenCalledWith(expect.anything(), lapsed.id);
		await waitFor(() => {
			expect(loadWorksByEventIdMock).toHaveBeenCalledWith(
				expect.anything(),
				['ev-1'],
				lapsed.id,
				expect.anything(),
				{ includeInactive: true }
			);
		});
	});

	it('fail-closed on the same shape: no database-entity grant leaves the current season’s repertoire surface read-only and filtered', async () => {
		const lapsed: Season = {
			id: 'season-lapsed',
			name: 'Season 2025',
			startDate: isoDate(-400),
			endDate: isoDate(-30),
			conductors: [],
			owners: [],
			editors: []
		};
		const created = futureSeason({ owners: ['person-p'] });
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				upcoming: [
					{
						id: 'ev-1',
						name: 'Rehearsal',
						startDatetime: new Date(Date.now() + 3600_000).toISOString(),
						durationMinutes: 90,
						location: '',
						conductors: [],
						owners: [],
						editors: []
					}
				],
				seasons: [lapsed, created]
			})
		);
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReadyWithRow();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		await flush();
		// The future season's own grant still opens creation — that is its right.
		expect(q(container, 'event-create')).not.toBeNull();
		// The current season's repertoire stays filtered: no unfiltered re-read.
		expect(loadWorksByEventIdMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			{ includeInactive: true }
		);
	});
});

// (*MVOX:Tallis*)
