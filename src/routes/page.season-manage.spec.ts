// @vitest-environment happy-dom
//
// #132/T3 RED — season MANAGEMENT on the ACTUAL agenda route (integration: real
// +page.svelte, real AgendaList, real manageRightsFrom; only the data seams are
// mocked — same harness family as page.season-create.spec.ts).
//
// WHY (#132): T2 made seasons creatable in-app; managing one still means Entu's
// admin UI. The season editor needs a [⚙] entry point on the agenda's season
// header opening an INLINE management panel (design sketch B — no separate
// route): editable name/dates/conductors, the season's event series with event
// counts, its standalone events, and the [+ Series]/[+ Event] entry points that
// T5/T4 will wire.
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA — everything through src/lib/seasons/seasonManage.ts (its own wire
//   contract is pinned in src/lib/seasons/seasonManage.spec.ts):
//     - opening the panel loads `listEventSeriesForSeason(cfg, seasonId)` and
//       `listEventsForSeason(cfg, seasonId)` — cfg is the page's usual
//       { db: selected.db, token: getToken() }.
//     - a field save calls `updateSeasonField(cfg, seasonId, field, value)`
//       (field ∈ 'name' | 'start_date' | 'end_date'); the panel reflects the
//       new value LOCALLY (eventFieldEdit's optimistic posture) — NO full
//       loadFullAgenda refetch per keystroke-sized edit.
//     - conductor add/remove call `addSeasonConductor` / `removeSeasonConductor`
//       with the PERSON id; names come from the roster (through the page's
//       cached getRoster — never a fresh 1+N fan-out per panel open).
//     - rights gate = the page's existing `seasonManageRights` derivation
//       (manageRightsFrom on the CURRENT season's ride-along _owner/_editor).
//       FAIL-CLOSED: a non-editor gets NO card, not a disabled one. No current
//       season → nothing to manage → no card (independent of T2's [+ Season]).
//
//   TESTIDS
//     season-card-expand          #261 — the collapsed card's whole-card expand
//                                 button (the retired [⚙]'s successor). Renders
//                                 IFF a manageable season exists AND the viewer
//                                 is its editor. Carries its own accessible
//                                 name (aria-label, season_manage_expand_label).
//     season-card-collapse        #261 — the opened card's title-row collapse
//                                 button (full contract in
//                                 page.season-card.spec.ts).
//     season-manage-panel         the inline panel it opens: role="dialog" with
//                                 an accessible name, same route (no goto).
//     season-manage-name          the season name display inside the panel
//     season-edit-btn-<field>     enter edit mode (field: name|start_date|end_date
//                                 — the event/[id] per-field edit pattern)
//     season-edit-input-<field>   the edit input (dates are type="date")
//     season-edit-error-<field>   inline save-failed error, role="alert"
//     season-manage-conductor-<personId>  one chip per conductor, showing the
//                                 person's NAME (ids are not UI), containing its
//                                 own remove button
//     season-manage-conductor-select  the NATIVE conductor <select> INSIDE the
//                                 panel (#209, PO standing rule 1): aria-label =
//                                 season_conductor_label; prompt option first
//                                 (value '', disabled selected hidden, text =
//                                 the reworded season_conductor_placeholder);
//                                 one option per roster person NOT already a
//                                 conductor (value = person id, text = name) in
//                                 roster order; a change adds the conductor and
//                                 the select resets to the prompt; everyone
//                                 added → mounted + disabled + prompt text
//                                 picker_everyone_added (Gama ruling 2)
//     season-manage-series-<id>   one row per event series: name + event count
//     season-manage-add-series    [+ Series] entry point (wired in T5)
//     season-manage-event-<id>    REMOVED by #313 — the panel no longer lists
//                                 standalone events (managed on their pages)
//     season-manage-add-event     [+ Event] entry point (wired in T4)
//     season-manage-close         REMOVED by #213 — the gear is a TOGGLE now:
//                                 a second gear click dismisses the panel
//
//   BEHAVIOR
//     - Escape layering: Escape in an OPEN field edit cancels only that edit
//       (the panel survives); Escape on the panel itself dismisses the panel.
//     - a saved edit persists across close/reopen WITHOUT re-saving and WITHOUT
//       a full agenda refetch — local state is the truth the panel renders.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// Params are appended so a count threaded through an ICU message stays visible
// to the series-row assertions ("12" must surface SOMEWHERE in the row).
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
	deleteSeasonMock
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
	deleteSeasonMock: vi.fn()
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
	createEvent: vi.fn()
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
	listMyAttendance: vi.fn().mockResolvedValue([]),
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
	listWorks: vi.fn().mockResolvedValue([]),
	listAllEditions: vi.fn().mockResolvedValue([]),
	listAllCopies: vi.fn().mockResolvedValue([])
}));
// #277 — a named handle: the per-season pins assert WHICH season the panel's
// repertoire read targets.
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: listRepertoireItemsMock
}));

import Page from './+page.svelte';
import {
	openSeasonCardPanel,
	collapseSeasonCard,
	SEASON_CARD_EXPAND,
	SEASON_CARD_COLLAPSE
} from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = { db: 'polyphony', token: 'jwt-abc' };
const SEASON_ID = 'season-1';

/** ISO calendar date `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** How a season bound must READ in the panel — #207 rule 7 (PO standing rule,
 *  Gama's 2026-09-02 rulings): season bounds are NUMERIC/TABULAR date text, so
 *  they render as the ISO calendar date itself, `YYYY-MM-DD`. The oracle is the
 *  en-CA Intl trick the codebase already proved for ISO output (AgendaList's
 *  `groupKeyFmt`) — UTC-anchored, so a date-only value never slides a day back
 *  in a negative offset (the same guard the old localized formatter carried;
 *  #132/T3 review F3's "no raw ISO" ruling is superseded by rule 7 for
 *  numeric/tabular contexts). For a date-only ISO input this is the IDENTITY:
 *  displayDate(iso) === iso — asserted below so the oracle can't drift. */
const DISPLAY_FMT = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'UTC',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});
function displayDate(iso: string): string {
	return DISPLAY_FMT.format(new Date(iso));
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

/** The season's event series, as the panel lists them: name + event count. */
function seriesFixture() {
	return [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0 }
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
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(fixtureRows());
	// [] = no sections → roster order degrades to the roster's own order.
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue(seriesFixture());
	listEventsForSeasonMock.mockResolvedValue(standaloneFixture());
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

/** The event/[id] per-field pattern: click the edit button, type, Enter. */
async function editField(container: HTMLElement, field: string, value: string): Promise<void> {
	await fireEvent.click(q(container, `season-edit-btn-${field}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-edit-input-${field}`)).not.toBeNull();
	});
	const input = q(container, `season-edit-input-${field}`) as HTMLInputElement;
	await fireEvent.input(input, { target: { value } });
	await fireEvent.keyDown(input, { key: 'Enter' });
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

/** Every option's value, in DOM order — index 0 is the '' prompt. */
function optionValues(select: HTMLSelectElement): string[] {
	return Array.from(select.querySelectorAll('option')).map((o) => o.value);
}

/** The prompt option (first, value ''), pinned `disabled selected hidden` so it
 *  can never be committed as a value (Gama ruling 1). */
function promptOption(select: HTMLSelectElement): HTMLOptionElement {
	const prompt = select.querySelector('option') as HTMLOptionElement;
	expect(prompt, 'expected a first (prompt) option').not.toBeNull();
	expect(prompt.value).toBe('');
	expect(prompt.disabled).toBe(true);
	expect(prompt.hidden).toBe(true);
	return prompt;
}

/** Pick a conductor the way a native select is driven: change to the id. */
async function pickConductor(panel: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(panel), { target: { value: personId } });
}

// ── the entry point: the season card itself, rights-gated (#261) ────────────────

describe('agenda — the season-card season-manage entry point', () => {
	it('season editor + current season: season-card-expand renders as a BUTTON whose accessible name says what it DOES *and* which season it is (sr-only verb + visible name), outside any agenda row; merely rendering opens no panel and writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		const expand = q(container, SEASON_CARD_EXPAND) as HTMLElement;
		expect(expand.tagName).toBe('BUTTON');
		// The visible text is the season's NAME, so the control adds the NEW
		// season_manage_expand_label copy (the message mock renders keys
		// verbatim) as an sr-only verb INSIDE itself — an identity is not a
		// function. #261 review F1: the verb SUPPLEMENTS the visible name, it
		// does not supersede it. An `aria-label` REPLACES the button's own
		// contents, dropping "Season 2026" out of the accessible name — a WCAG
		// 2.1 AA 2.5.3 (Label in Name) failure, and the exact mistake #205
		// review F1 corrected for the panel's three field activators.
		expect(expand.hasAttribute('aria-label')).toBe(false);
		// The real accname algorithm agrees: the control resolves BY its
		// function AND by the season it belongs to.
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2026/ })
		).toBe(expand);
		expect(expand.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(expand.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();
		// #261 — the gear does not exist any more, for anyone.
		expect(q(container, 'season-manage-gear')).toBeNull();

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
		expect(listEventsForSeasonMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no card at all — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
	});

	it('the only season LAPSED yesterday and nothing is queued behind it: the card RENDERS — its panel is the only way to fix that season’s dates', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(true));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		// The rights rode along on the season list — no database-entity round-trip.
		expect(resolveManageRightsMock).not.toHaveBeenCalled();
	});

	it('fail-closed on the same shape: a lapsed-only season the viewer does NOT edit (and no collective-wide grant) still hides the card', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(false));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		// The season carries no visible rights, so the database entity is asked —
		// and its 'not-editor' answer (the suite default) is not a grant.
		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalledWith(CFG, ORG_EFK, 'person-p');
		});
		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
	});

	it('the card gates INDEPENDENTLY of [+ Season]: with an upcoming season BOTH stay present (#261 reopen — the create affordance is rights-gated only; the current season is still manageable)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
	});

	it('clicking the collapsed card opens season-manage-panel INLINE (no route change), a dialog with an accessible name, and loads the series list for THIS season (#313: no standalone-event read any more)', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(panel.getAttribute('role')).toBe('dialog');
		// #236 — the panel's own <h2> is promoted into the card header, so the
		// dialog's accessible name COMES FROM that visible element
		// (aria-labelledby → season-manage-label). #238 — that h2 now renders
		// the season's NAME, so the dialog is named by the season it manages:
		// a region named by its subject is exactly right, so aria-labelledby
		// STAYS (unlike the gear, whose name must say what it does).
		expect(
			panel.getAttribute('aria-labelledby'),
			'#236/#238 — the dialog is named by the visible card title'
		).toBe('season-manage-label');
		expect(
			panel.hasAttribute('aria-label'),
			'no duplicated aria-label authoring on the panel'
		).toBe(false);
		const panelLabelEl = container.querySelector('[id="season-manage-label"]') as HTMLElement;
		expect(panelLabelEl, 'aria-labelledby must resolve to an element').not.toBeNull();
		// #238 — the h2's text is the season name (fixture: 'Season 2026'), not
		// the gear-label copy.
		expect(panelLabelEl.textContent?.trim()).toBe('Season 2026');

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});
		// #313 — the standalone-event list is removed; opening the panel must not
		// read it at all.
		expect(listEventsForSeasonMock).not.toHaveBeenCalled();
	});

	it('#238/#261 — the header leads with the season NAME: with the panel OPEN the title shows the name, and the retired gear/panel-label keys are consumed NOWHERE', async () => {
		const container = await renderReady();
		await openPanel(container);

		// #238 — the card's title IS the season. #261 keeps the identity on the
		// opened title row (season-manage-label survives as the named element).
		const label = q(container, 'season-manage-label') as HTMLElement;
		expect(label, 'the title element stays mounted with the panel open').not.toBeNull();
		expect(label.textContent?.trim(), 'the title text is the season name').toBe('Season 2026');
		// #261 — the gear is GONE and its copy with it: the retired key feeds
		// NOTHING — no text node, no aria-label attribute (innerHTML catches both).
		expect(container.innerHTML).not.toContain('season_manage_gear_label');
		expect(container.innerHTML).not.toContain('season_manage_panel_label');
	});
});

// ── field editing: name, dates — replace semantics through updateSeasonField ────

describe('agenda — season fields edit inline (event/[id] per-field pattern)', () => {
	it('name: the panel shows the current name; click-to-edit, Enter-to-save calls updateSeasonField(cfg, seasonId, "name", <value>) ONCE and the display updates IMMEDIATELY — no full agenda refetch', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		});

		await editField(container, 'name', 'Autumn splendour');

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1);
		});
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Autumn splendour');

		// Reflected NOW, from local state (eventFieldEdit's optimistic posture)…
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Autumn splendour');
		});
		// …not by re-running the whole agenda load.
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);
	});

	it('Escape in an open name edit cancels ONLY the edit: input closes, old value stays, NO write — and the PANEL survives (Escape layering)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-name') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Half-typed nonsense' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
	});

	it('start date: the edit input is type="date" pre-filled with the current value; saving calls updateSeasonField(cfg, seasonId, "start_date", <iso date>)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-start_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-start_date') as HTMLInputElement;
		expect(input.type).toBe('date');
		expect(input.value).toBe(SEASON_START);

		await fireEvent.input(input, { target: { value: '2026-10-01' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'start_date', '2026-10-01');
		});
	});

	it('end date: same pattern — updateSeasonField(cfg, seasonId, "end_date", <iso date>)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		expect(input.type).toBe('date');
		expect(input.value).toBe(SEASON_END);

		await fireEvent.input(input, { target: { value: '2027-06-30' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'end_date', '2027-06-30');
		});
	});

	// #207 rule 7 (INVERTS #132/T3 review F3's "never the raw ISO string" for
	// this panel): season bounds are numeric/tabular date text, so the panel
	// shows exactly the ISO calendar date, `YYYY-MM-DD` — which for a date-only
	// bound IS the stored string. The F3 gains that survive: each bound still
	// carries its own VISIBLE text label (the label, not the format, is what
	// tells start from end), and an unset bound still says so in words.
	it('the dates render as ISO YYYY-MM-DD (#207 rule 7) and each carries its own VISIBLE label', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		// Oracle self-check: for a date-only value the ISO rendering IS the value.
		expect(displayDate(SEASON_START)).toBe(SEASON_START);
		expect(displayDate(SEASON_END)).toBe(SEASON_END);
		// The panel shows exactly the YYYY-MM-DD strings — nothing localized.
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe(SEASON_START);
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe(SEASON_END);
		// …and the labels are TEXT in the panel, not just aria on the pencils.
		expect(panel.textContent).toContain('season_manage_start_date_label');
		expect(panel.textContent).toContain('season_manage_end_date_label');
	});

	// #207 rule 7, DST edge — Europe/Tallinn switches to EEST on 2026-03-29 and
	// back on 2026-10-25. A season bound ON a transition day must still render
	// as that exact ISO calendar day: the formatter is UTC-anchored over a
	// date-only value, so no timezone/DST arithmetic may shift it (the same
	// slide-a-day trap the old localized formatter guarded against, now pinned
	// with the transition days themselves).
	it('DST edge: bounds ON the Tallinn spring-forward/fall-back days render as those exact ISO days', async () => {
		const season = currentSeason(true);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			...agendaResult(),
			seasons: [{ ...season, startDate: '2026-03-29', endDate: '2026-10-25' }]
		}));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe('2026-03-29');
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe('2026-10-25');
	});

	it('a season with NO dates set says so — never a bare pencil, and never "Invalid Date"', async () => {
		const season = currentSeason(true);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			...agendaResult(),
			seasons: [{ ...season, startDate: '', endDate: '' }]
		}));
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-manage-start_date')?.textContent).toContain(
			'season_manage_date_unset'
		);
		expect(q(container, 'season-manage-end_date')?.textContent).toContain(
			'season_manage_date_unset'
		);
		expect(panel.textContent).not.toContain('Invalid Date');
		// Still editable — the pencils are the way to SET a missing bound.
		expect(q(container, 'season-edit-btn-start_date')).not.toBeNull();
		expect(q(container, 'season-edit-btn-end_date')).not.toBeNull();
	});

	it('a FAILED save surfaces season-edit-error-name (role="alert") and the display keeps the OLD value — a silently snapped-back edit reads as a bug', async () => {
		updateSeasonFieldMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await editField(container, 'name', 'Doomed rename');

		await waitFor(() => {
			expect(q(container, 'season-edit-error-name')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-name')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Doomed rename');
	});

	// #132/T3 review F3 — the create form (submitSeasonCreate) refuses an inverted
	// range; the inline edits must refuse the same one, or the guarded UI admits
	// the corrupt bounds the agenda's current-season derivation then reads.
	it('an END date moved BEFORE the start date is refused: no write, the old value stands, and the error names the RANGE (not the generic save failure)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: isoDate(-90) } }); // before SEASON_START
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-end_date')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-edit-error-end_date')?.textContent).toContain(
			'season_date_range_invalid'
		);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		// The refused value never lands — locally or on the wire.
		expect(q(container, 'season-manage-end_date')?.textContent).toContain(displayDate(SEASON_END));
		expect(q(container, 'season-manage-panel')?.textContent).not.toContain(
			displayDate(isoDate(-90))
		);
	});

	it('a START date moved AFTER the end date is refused the same way — the guard reads BOTH bounds', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-start_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-start_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: isoDate(200) } }); // after SEASON_END
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'season-edit-error-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-start_date')?.textContent).toContain(
			'season_date_range_invalid'
		);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-start_date')?.textContent).toContain(
			displayDate(SEASON_START)
		);
	});

	it('a date edit INSIDE the range still saves, and a save failure still reads as a SAVE error (the two error kinds do not bleed)', async () => {
		updateSeasonFieldMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		const valid = isoDate(90); // after SEASON_START — a legitimate extension
		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: valid } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'end_date', valid);
		});
		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')?.textContent).toContain(
				'season_manage_save_error'
			);
		});
	});
});

// ── conductors: chips + native-select add (#209) / targeted remove ──────────────

describe('agenda — season conductors are editable in the panel', () => {
	it('the current conductor renders as a chip showing the person’s NAME (from the cached roster), not a raw entity id', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		expect(chip.textContent).toContain('Grace Hopper');
		expect(chip.textContent).not.toContain('p-grace');
	});

	// #132/T3 review F4 — the happy-path assertion above can only see the id after
	// the roster RESOLVED. These two cover the paths where a name never arrives:
	// the id must not leak into the chip or its remove button's accessible name in
	// either of them (entity ids are never UI).
	it('a FAILED roster read leaves no raw person id in the chip — not in its text, not in its remove button’s accessible name', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster down'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await waitFor(() => {
			expect(chip.textContent).toContain('season_manage_conductor_unknown');
		});
		expect(chip.textContent).not.toContain('p-grace');
		const remove = chip.querySelector('button') as HTMLElement;
		expect(remove.getAttribute('aria-label')).not.toContain('p-grace');
	});

	it('a conductor who is NOT on the roster (left the collective) reads as an unknown member, never as her entity id', async () => {
		loadRosterMock.mockResolvedValue(fixtureRows().filter((row) => row.personId !== 'p-grace'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await waitFor(() => {
			expect(chip.textContent).toContain('season_manage_conductor_unknown');
		});
		expect(chip.textContent).not.toContain('p-grace');
		expect((chip.querySelector('button') as HTMLElement).getAttribute('aria-label')).not.toContain(
			'p-grace'
		);
	});

	it('the panel holds a NATIVE conductor <select> (#209): named by season_conductor_label, prompt option (value "", disabled selected hidden, the reworded placeholder), then every roster person NOT already a conductor, in roster order', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		expect(select.getAttribute('aria-label')).toBe('season_conductor_label');
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
		expect(select.value).toBe('');

		// FULL option array — Grace already conducts this season, so she is NOT
		// offered again; Ada and Pete are (no sections → roster's own order).
		expect(optionValues(select)).toEqual(['', 'p-ada', 'person-p']);
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual(['season_conductor_placeholder', 'Ada Lovelace', 'Pete Wilson']);
	});

	it('option order is ROSTER order — section, then position within section — not alphabetical (Gama ruling 3)', async () => {
		// loadRoster answers NAME order (Ada, Grace, Pete). Pete sings Sopran
		// (first section), Ada Tenor (second); Grace already conducts (excluded).
		loadRosterMock.mockResolvedValue([
			{ ...fixtureRows()[0], sectionIds: ['sec-t'] }, // Ada → Tenor
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran (excluded anyway)
			{ ...fixtureRows()[2], sectionIds: ['sec-s'] } // Pete → Sopran
		]);
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			// Sopran (Pete), then Tenor (Ada). Alphabetical would put Ada first.
			expect(optionValues(conductorSelect(panel))).toEqual(['', 'person-p', 'p-ada']);
		});
	});

	it('adding via the panel’s select (change to a person id) calls addSeasonConductor(cfg, seasonId, <personId>), the new chip appears, and the select RESETS to the prompt', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await pickConductor(panel, 'p-ada');

		await waitFor(() => {
			expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-p-ada')?.textContent).toContain('Ada Lovelace');

		// Chip pattern stays: back to the prompt, Ada no longer offered.
		const select = conductorSelect(panel);
		await waitFor(() => {
			expect(select.value).toBe('');
		});
		expect(optionValues(select)).toEqual(['', 'person-p']);
	});

	it('EVERY roster person already conducts: the select stays MOUNTED but disabled with prompt text picker_everyone_added (Gama ruling 2)', async () => {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasonId: SEASON_ID,
				seasonConductors: ['p-ada', 'p-grace', 'person-p'],
				seasonEditors: ['person-p'],
				seasons: [
					{
						id: SEASON_ID,
						name: 'Season 2026',
						startDate: SEASON_START,
						endDate: SEASON_END,
						conductors: ['p-ada', 'p-grace', 'person-p'],
						owners: [],
						editors: ['person-p']
					}
				]
			})
		);

		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		await waitFor(() => {
			expect(select.disabled).toBe(true);
		});
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_everyone_added');
	});

	it('the chip’s remove button calls removeSeasonConductor(cfg, seasonId, <personId>) and the chip leaves', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		const remove = chip.querySelector('button') as HTMLElement;
		expect(remove).not.toBeNull();
		await fireEvent.click(remove);

		await waitFor(() => {
			expect(removeSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-grace');
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
		});
	});

	// #132/T3 review F1 — the optimistic chip change reverts on rejection; the
	// revert ALONE is a chip that silently appears and vanishes, the exact shape
	// the three text/date fields already refuse to ship.
	it('a FAILED add reverts the chip AND says so (role="alert") — a silently vanishing chip reads as a bug', async () => {
		addSeasonConductorMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		const panel = await openPanel(container);

		await pickConductor(panel, 'p-ada');

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-error')?.getAttribute('role')).toBe('alert');
		// …and the chip is gone again (the optimistic add was reverted).
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
	});

	it('a FAILED remove restores the chip AND surfaces the same error slot', async () => {
		removeSeasonConductorMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await fireEvent.click(chip.querySelector('button') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
	});

	it('a SUCCESSFUL attempt after a failed one clears the error — the slot is per-attempt, not sticky', async () => {
		removeSeasonConductorMock.mockRejectedValueOnce(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		await fireEvent.click(
			(q(container, 'season-manage-conductor-p-grace') as HTMLElement).querySelector(
				'button'
			) as HTMLElement
		);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});

		// Second try — this one resolves.
		await fireEvent.click(
			(q(container, 'season-manage-conductor-p-grace') as HTMLElement).querySelector(
				'button'
			) as HTMLElement
		);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).toBeNull();
		});
	});
});

// ── event series + standalone events ────────────────────────────────────────────

describe('agenda — the panel lists the season’s series and standalone events', () => {
	it('every series renders a row with its NAME and its EVENT COUNT — including a zero-count series (present with 0, not dropped)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		const row1 = q(container, 'season-manage-series-series-1') as HTMLElement;
		expect(row1.textContent).toContain('Monday rehearsals');
		expect(row1.textContent).toContain('12');

		const row2 = q(container, 'season-manage-series-series-2') as HTMLElement;
		expect(row2).not.toBeNull();
		expect(row2.textContent).toContain('Sectionals');
		expect(row2.textContent).toContain('0');
	});

	it('the event count goes through an i18n message with the count as a PARAM — never a bare, unlabelled number (#132/T3 review F2)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		// The message mock renders `<key> <params-json>`, so both the key and the
		// threaded count are visible here: a hard-coded `{series.eventCount}` shows
		// the digits with no key, and this assertion catches it.
		const row1 = q(container, 'season-manage-series-series-1') as HTMLElement;
		expect(row1.textContent).toContain('season_manage_series_event_count');
		expect(row1.textContent).toContain('"count":12');

		const row2 = q(container, 'season-manage-series-series-2') as HTMLElement;
		expect(row2.textContent).toContain('season_manage_series_event_count');
		expect(row2.textContent).toContain('"count":0');
	});

	it('[+ Series] is present for the editor — T5’s entry point exists NOW, rendered inside the panel', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-add-series')).not.toBeNull();
		});
		expect(panel.contains(q(container, 'season-manage-add-series'))).toBe(true);
	});

	it('[+ Event] — T4’s entry point — is present inside the panel (#313: the standalone-event LIST itself is gone; events are managed on their own pages)', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});
		expect(panel.contains(q(container, 'season-manage-add-event'))).toBe(true);
	});

	// #132/T3 review F2 — a rejected read used to land as `[]`, which is exactly
	// what a genuinely empty season renders. With [+ Series]/[+ Event] sitting
	// right under those lists, "silently empty" invites the editor to re-create
	// series that already exist. Fail loudly (house rule).
	it('a FAILED series read surfaces an error (role="alert") — NOT an empty list indistinguishable from "no series yet"', async () => {
		listEventSeriesForSeasonMock.mockRejectedValue(new Error('read down'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-series-series-1')).toBeNull();
	});

	// (#313 — the "FAILED standalone-event read" test died with the list: the
	// panel no longer reads standalone events at all; see the removal pins in
	// page.season-manage-delete.spec.ts.)

	it('a failed read does not stick: reopening after a recovery shows the rows and no error', async () => {
		listEventSeriesForSeasonMock.mockRejectedValueOnce(new Error('read down'));
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});

		await collapseSeasonCard(container);
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-error')).toBeNull();
	});
});

// ── collective switch: no stale data leaks into the panel ───────────────────────

describe('agenda — the panel’s reads respect the page-wide requestId guard', () => {
	function setAuthedWithTwoCollectives(): void {
		setToken('jwt-abc');
		authStore.set({
			status: 'authenticated',
			personIdByDb: { polyphony: 'person-p', 'org-b': 'person-p' },
			expMs: Date.now() + 100_000
		});
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
				{ db: 'org-b', name: 'Org B', personId: 'person-p' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');
	}

	// #132/T3 review F4 — `resetSeasonManage()` clears the arrays on a new
	// selection, but a read still in flight for the OLD db resolves afterwards.
	// The panel is closed at that moment, so nothing is on screen; the stale rows
	// then survive into the NEXT open and render the previous collective's series.
	it('a series read still in flight when the collective changes never repopulates the panel', async () => {
		let resolveStale!: (rows: ReturnType<typeof seriesFixture>) => void;
		listEventSeriesForSeasonMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveStale = resolve as typeof resolveStale;
				})
		);
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanel(container);
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});

		// Switch collectives while that read is still pending.
		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});

		// …and only NOW does the previous collective's read land.
		resolveStale(seriesFixture());
		await new Promise((r) => setTimeout(r, 0));

		// The org-b panel must be empty of polyphony's series (org-b's own read is
		// still pending — anything visible here came from the stale resolve).
		await openPanel(container);
		expect(q(container, 'season-manage-series-series-1')).toBeNull();
		expect(q(container, 'season-manage-series-series-2')).toBeNull();
	});
});

// ── close / Escape / persistence ────────────────────────────────────────────────

describe('agenda — closing the panel, and what survives it', () => {
	it('a TITLE-ROW click dismisses the panel (#261 — the card is the toggle; no internal close button exists); nothing was written by opening + closing', async () => {
		const container = await renderReady();
		await openPanel(container);

		// The panel carries no season-manage-close; the title row collapses.
		expect(q(container, 'season-manage-close')).toBeNull();
		await collapseSeasonCard(container);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(addSeasonConductorMock).not.toHaveBeenCalled();
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();
	});

	// #132/T3 review F1 — the Escape assertions below dispatch at
	// `document.activeElement`, NEVER at the panel element: firing the key at the
	// panel proves only that the handler is bound, not that a real keypress can
	// ever reach it. #222/#261 containment model: the panel renders inside the
	// shared agenda-admin-card as a SIBLING of the title row — never inside the
	// title-row button itself — so unless the open ACTUALLY moves focus into the
	// dialog, a browser Escape dispatches at the title row (or <body>) and never
	// enters the panel's subtree.
	function pressEscapeAtFocus(): Promise<boolean> {
		return fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
	}

	it('opening the panel moves focus INTO the dialog — what role="dialog" promises, and what makes Escape reachable at all', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(document.activeElement).toBe(panel);
		});
	});

	it('Escape AT THE FOCUSED ELEMENT dismisses the panel (no field edit open — the layering test above covers the edit-open case)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
	});

	it('dismissing the panel returns focus to the collapsed card’s EXPAND control (#261 — the gear was the old anchor) — a keyboard user is not dropped at document start', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});

		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
	});

	it('closing through the TITLE ROW hands focus to the expand control that takes its place (#261 — the collapse control unmounts with the open state, like the old × did)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await collapseSeasonCard(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
		});
	});

	it('the two-Escapes-to-leave layering holds through REAL focus: the first Escape (fired at the focused edit input) closes only the edit, the second dismisses the panel', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		// The edit input focuses itself on mount — so this Escape really is the
		// field's, exactly as a viewer's would be.
		expect(document.activeElement).toBe(q(container, 'season-edit-input-name'));

		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();

		// Focus came back to the dialog, so the NEXT Escape reaches its handler.
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
	});

	it('a saved rename PERSISTS across close + reopen — shown from local truth, with NO second save and NO full agenda refetch', async () => {
		const container = await renderReady();
		await openPanel(container);

		await editField(container, 'name', 'Autumn splendour');
		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1);
		});

		await collapseSeasonCard(container);

		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Autumn splendour');
		});
		expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1);
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);
	});
});

// ── the picker's EMPTY states (#209 review F1) ─────────────────────────────────
//
// The panel's conductor CHIPS were already careful here (name-not-here-YET vs
// name-will-NEVER-arrive, #132/T3 review F4). The select was not: it claimed
// everyone had been added while the roster was still loading, and kept claiming
// it after a failed read.

describe('agenda — the season-manage conductor select tells its empties apart (#209 review F1)', () => {
	it('roster read STILL IN FLIGHT: disabled with the LOADING prompt, never picker_everyone_added', async () => {
		loadRosterMock.mockReturnValue(new Promise<never>(() => {})); // never settles

		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		expect(select.disabled).toBe(true);
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE — the same failure the chips already report as "unknown", never "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(panel)).textContent?.trim()).toBe(
				'picker_roster_unavailable'
			);
		});
		expect(conductorSelect(panel).disabled).toBe(true);
	});

	it('SECTION read failed: the select stays usable in the roster’s own name order and says so', async () => {
		listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-order-note')).not.toBeNull();
		});
		const select = conductorSelect(panel);
		expect(select.disabled).toBe(false);
		expect(optionValues(select)).toEqual(['', 'p-ada', 'person-p']);
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
	});
});

// ════════════════════════════════════════════════════════════════════════════════
// #277 — a per-season entry point, NOT a picker (Gama's `ready` ruling,
// 2026-09-09: dropdown/select explicitly rejected; "make creation set the
// manageable season" explicitly rejected as a hidden mode).
//
// Contract under test:
//   1. an admin can open the management panel for ANY not-lapsed season they
//      hold editor rights on, not just `manageableSeason`'s automatic pick;
//   2. the panel states WHICH season it manages, visibly, whenever more than
//      one is manageable — the visible identity is the season's OWN NAME via
//      the existing `season-manage-label` element, so NO new i18n key is
//      needed for it;
//   3. switching the managed season is a context switch: repertoire, series
//      rows, fields and every in-flight write belong to the OPEN season;
//   4. rights are re-derived per season — never carried across a switch;
//   5. with exactly one manageable season the DOM is EXACTLY today's (#261
//      face) — no new control in the common case, no new testids: each entry
//      reuses data-testid="season-card-expand", distinguished by its visible
//      season name (querySelectorAll where the multi case needs them all).
//
// Rendering shape pinned here: the single collapsed card block becomes an
// iteration over the manageable set — one collapsed entry per season, in the
// page's `seasons` order, each opening the panel FOR THAT season. Clicking
// another season's collapsed entry while a panel is open IS the switch.
//
// The manageable SET: every not-lapsed season (current + upcoming) whose own
// ride-along owners/editors resolve the viewer to editor (`manageRightsFrom`
// per season), plus `manageableSeason`'s automatic pick unchanged (its lapsed
// fallback keeps its entry — conductorLogic.manageable.spec.ts does not flip).
// The DB-entity-rights fallback is COLLECTIVE-level: when it promotes, it
// promotes uniformly for all candidate seasons.
// ════════════════════════════════════════════════════════════════════════════════

/** Every per-season entry currently on the page, in DOM order. */
function expandButtons(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll('[data-testid="season-card-expand"]')
	) as HTMLElement[];
}

/** The collapsed entry whose visible text names `seasonName`, or null. */
function expandFor(container: HTMLElement, seasonName: string): HTMLElement | null {
	return expandButtons(container).find((b) => b.textContent?.includes(seasonName)) ?? null;
}

/** Open (or switch to) the panel FOR the named season via its own entry, then
 *  wait until the panel's visible label names that season. */
async function openPanelForSeason(container: HTMLElement, seasonName: string): Promise<HTMLElement> {
	await waitFor(() => {
		expect(expandFor(container, seasonName), `an entry for ${seasonName}`).not.toBeNull();
	});
	await fireEvent.click(expandFor(container, seasonName) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe(seasonName);
	});
	return q(container, 'season-manage-panel') as HTMLElement;
}

/** Any <select> offering a season as an option — the picker shape Gama's
 *  ruling rejects. (The event-create form's season <select> only exists while
 *  that form is open; none of these tests open it.) */
function seasonPickerSelects(container: HTMLElement): HTMLSelectElement[] {
	return (Array.from(container.querySelectorAll('select')) as HTMLSelectElement[]).filter(
		(sel) =>
			Array.from(sel.querySelectorAll('option')).some((o) => /Season 20\d\d/.test(o.textContent ?? ''))
	);
}

/** Two not-lapsed seasons; per-season rights as given. Only `seasons` is
 *  passed, so the builder derives the current/manageable fields exactly as the
 *  real producer would — production-shaped, never hand-pinned. */
function twoSeasonResult(opts: { aEditor?: boolean; bEditor?: boolean } = {}) {
	const { aEditor = true, bEditor = true } = opts;
	return fullAgendaResult({
		seasons: [currentSeason(aEditor), { ...upcomingSeason(), editors: bEditor ? ['person-p'] : [] }]
	});
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const SEASON_B_ID = 'season-2';
const seriesA = [{ id: 'series-a1', name: 'Monday rehearsals', eventCount: 12 }];
const seriesB = [{ id: 'series-b1', name: 'Thursday sectionals', eventCount: 4 }];
/** One repertoire row per season — what lets the write-race pin tell A's row
 *  from B's inside the panel's repertoire section. */
const repertoireA = [
	{ id: 'rep-a1', workId: 'work-a1', editionId: '', status: 'active', name: 'Kyrie' }
];
const repertoireB = [
	{ id: 'rep-b1', workId: 'work-b1', editionId: '', status: 'active', name: 'Sanctus' }
];

/** Answer each season its OWN series list — what lets the switch pins tell
 *  A's rows from B's. */
function serveSeriesPerSeason(): void {
	listEventSeriesForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) =>
		Promise.resolve(seasonId === SEASON_B_ID ? seriesB : seriesA)
	);
}

describe('season card #277 — one entry per manageable season, not a picker', () => {
	it('TWO manageable seasons: TWO collapsed entries in season order, each a BUTTON naming its own season (sr-only verb + visible name), and NO season <select> anywhere; merely rendering opens no panel and reads nothing', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const container = await renderReady();

		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		const [first, second] = expandButtons(container);
		expect(first.tagName).toBe('BUTTON');
		expect(second.tagName).toBe('BUTTON');
		// Season order — the page's `seasons` order, current first.
		expect(first.textContent).toContain('Season 2026');
		expect(second.textContent).toContain('Season 2027');
		// Each entry resolves BY its function AND by ITS season (the #261
		// accname discipline, now per entry — no aria-label superseding the name).
		expect(first.hasAttribute('aria-label')).toBe(false);
		expect(second.hasAttribute('aria-label')).toBe(false);
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2026/ })
		).toBe(first);
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2027/ })
		).toBe(second);
		// Not a picker: no dropdown duplicates the list beside it.
		expect(seasonPickerSelects(container)).toEqual([]);

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
		// NOT asserting `listRepertoireItemsMock` uncalled here (deviation,
		// stated): `twoSeasonResult()`'s default `aEditor: true` makes person-p
		// editor on the CURRENT season, which is `seasonManageRights` territory
		// (#91/#167) — a completely different, pre-existing surface (the
		// agenda's own inline "Add work" pickers) that eagerly prefetches
		// `listRepertoireItems(cfg, currentSeasonId)` on EVERY render where the
		// viewer edits their current season, #277 or not. None of the ~50
		// pre-#277 tests in this file assert this mock stays uncalled under an
		// editor-true current season, for exactly that reason. The panel's OWN
		// read is what the two assertions above already cover.
		expect(listRepertoireItemsMock).toHaveBeenCalledWith(CFG, SEASON_ID);
	});

	it('ONE manageable season: EXACTLY one entry — today’s #261 face, no new control, no picker (criterion 5)', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		const only = expandButtons(container)[0];
		expect(only.getAttribute('aria-expanded')).toBe('false');
		expect(only.textContent).toContain('Season 2026');
		expect(only.hasAttribute('aria-label')).toBe(false);
		expect(seasonPickerSelects(container)).toEqual([]);
	});

	it('opening the UPCOMING season’s entry loads THAT season: series + repertoire reads use ITS id, the fields are ITS fields, and the visible label names it (criteria 1+2)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2027');

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		await waitFor(() => {
			expect(listRepertoireItemsMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		// The fields are B's, seeded fresh — never A's under B's heading.
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		});
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe(isoDate(61));
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe(isoDate(240));
		// B's series, not A's.
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-series-a1')).toBeNull();
		// A conductor chip from A would be a leak — B has none.
		expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
	});

	it('with the panel OPEN for one season the OTHER season’s entry stays reachable — the panel names its season while more than one is manageable (criterion 2)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');

		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2026');
		// B's entry is still there — it IS the way to switch.
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandFor(container, 'Season 2027')).not.toBeNull();
	});
});

describe('season card #277 — switching the managed season is a context switch', () => {
	it('A open → click B’s entry: the panel now holds B’s fields and B’s series; NOTHING of A survives — fields, rows, chips (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-a1')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		});
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-series-a1')).toBeNull();
		expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
		// The repertoire read re-ran for B, not recycled from A.
		await waitFor(() => {
			expect(listRepertoireItemsMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
	});

	it('race (a): a series read for A still in flight when the admin switches to B NEVER repopulates B’s panel', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		let resolveStaleA!: (rows: typeof seriesA) => void;
		listEventSeriesForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId === SEASON_ID)
				return new Promise((resolve) => {
					resolveStaleA = resolve as typeof resolveStaleA;
				});
			return new Promise(() => {}); // B's own read stays pending: anything visible is stale
		});
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});

		await openPanelForSeason(container, 'Season 2027');
		// …and only NOW does A's read land.
		resolveStaleA(seriesA);
		await flush();

		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2027');
		expect(q(container, 'season-manage-series-series-a1')).toBeNull();
		expect(q(container, 'season-manage-series-error')).toBeNull();
	});

	it('race (b): a field edit on A REJECTING after the switch neither clobbers B’s field nor leaks into B’s error slot — and the field is still editable (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let rejectStaleWrite!: (e: Error) => void;
		updateSeasonFieldMock.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectStaleWrite = reject as typeof rejectStaleWrite;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await editField(container, 'name', 'Renamed A');
		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed A');
		});

		await openPanelForSeason(container, 'Season 2027');
		rejectStaleWrite(new Error('boom, late'));
		await flush();

		// B's field untouched: not A's old value (the stale revert), not the draft.
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Season 2026');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Renamed A');
		// No error leak into B's slots.
		expect(q(container, 'season-edit-error-name')).toBeNull();
		// And no leaked pending flag: B's name is still editable.
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
	});

	it('race (c): an in-flight conductor add on A rejecting after the switch leaves B’s chips and error slot untouched (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let rejectStaleAdd!: (e: Error) => void;
		addSeasonConductorMock.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectStaleAdd = reject as typeof rejectStaleAdd;
				})
		);
		const container = await renderReady();

		const panelA = await openPanelForSeason(container, 'Season 2026');
		await pickConductor(panelA, 'p-ada');
		await waitFor(() => {
			expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		});

		await openPanelForSeason(container, 'Season 2027');
		rejectStaleAdd(new Error('boom, late'));
		await flush();

		// B has NO conductors: neither the optimistic Ada nor A's restored
		// before-array (Grace) may appear under B's heading.
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
		expect(q(container, 'season-manage-conductor-error')).toBeNull();
	});

	it('race (d): a season delete ARMED on A is DISARMED by the switch — B’s title row shows the idle trashcan, never a live confirm (resetSeasonManage keeps covering it)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season-confirm')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).toBeNull();
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('race (e): a panel repertoire REMOVE on A rejecting after the switch never paints A’s row under B’s heading (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		// Each season its own row. B's SECOND read — the one the rejected write's
		// `revert()` fires — never settles, so the rollback is the only thing that
		// could put a row on screen: without the guard the assertion below is not
		// racing a re-read that would have washed A's row out a tick later.
		let bReads = 0;
		listRepertoireItemsMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId !== SEASON_B_ID) return Promise.resolve(repertoireA);
			bReads += 1;
			return bReads === 1 ? Promise.resolve(repertoireB) : new Promise(() => {});
		});
		let rejectStaleDelete!: (e: Error) => void;
		deleteRepertoireItemMock.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectStaleDelete = reject as typeof rejectStaleDelete;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Kyrie');
		});
		const removeA = q(q(container, 'season-manage-repertoire') as HTMLElement, 'work-manage-remove');
		expect(removeA, 'the panel row’s remove control').not.toBeNull();
		await fireEvent.click(removeA as HTMLElement);
		await waitFor(() => {
			expect(deleteRepertoireItemMock).toHaveBeenCalledWith(CFG, 'rep-a1');
		});

		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Sanctus');
		});

		// …and only NOW does A's DELETE reject.
		rejectStaleDelete(new Error('boom, late'));
		await flush();

		const section = q(container, 'season-manage-repertoire') as HTMLElement;
		// B's row stands, A's restored array is not painted under it — and no
		// remove/status control writing against A's repertoire_item id survives.
		expect(section.textContent).toContain('Sanctus');
		expect(section.textContent).not.toContain('Kyrie');
		expect(section.querySelectorAll('[data-testid="work-manage-remove"]')).toHaveLength(1);
	});
});

describe('season card #277 — rights are re-derived per season', () => {
	it('editor on the CURRENT season only: exactly one entry, the current season’s — the upcoming season the viewer cannot edit gets NONE (criterion 4, fail-closed)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: true, bEditor: false }));
		const container = await renderReady();

		await waitFor(() => {
			expect(expandFor(container, 'Season 2026')).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandFor(container, 'Season 2027')).toBeNull();
	});

	it('switching cannot CARRY A’s editor onto B: with rights on A only, opening A leaves NO switch target for B', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: true, bEditor: false }));
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');

		expect(expandFor(container, 'Season 2027')).toBeNull();
		expect(expandButtons(container)).toHaveLength(0);
	});

	it('editor on the UPCOMING season only: ITS entry renders even though the automatic pick (the current season) is unmanageable — and it opens ITS panel (criterion 1)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: false, bEditor: true }));
		serveSeriesPerSeason();
		const container = await renderReady();

		await waitFor(() => {
			expect(expandFor(container, 'Season 2027')).not.toBeNull();
		});
		expect(expandFor(container, 'Season 2026')).toBeNull();
		expect(expandButtons(container)).toHaveLength(1);

		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalledWith(CFG, SEASON_ID);
	});

	it('rights on ZERO not-lapsed seasons: no entries, no card, no panel — absent, not disabled (and the DB probe’s not-editor answer is no grant)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: false, bEditor: false }));
		const container = await renderReady();

		// The auto-pick carries no visible rights → the database entity is asked;
		// its 'not-editor' (suite default) leaves everything shut.
		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalledWith(CFG, ORG_EFK, 'person-p');
		});
		expect(expandButtons(container)).toHaveLength(0);
		expect(q(container, 'agenda-admin-card')).toBeNull();
		expect(q(container, 'season-manage-panel')).toBeNull();
	});

	it('the DB-entity fallback promotes UNIFORMLY: no per-season rights visible anywhere + database-entity editor → EVERY not-lapsed season gets an entry (collective-level grant)', async () => {
		resolveManageRightsMock.mockResolvedValue('editor');
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: false, bEditor: false }));
		const container = await renderReady();

		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		expect(expandFor(container, 'Season 2026')).not.toBeNull();
		expect(expandFor(container, 'Season 2027')).not.toBeNull();
	});

	it('a LAPSED season alongside a current one gets NO entry even for its editor — the set is not-lapsed seasons only (the automatic pick’s lapsed FALLBACK case stays covered by the existing single-season specs)', async () => {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [
					{
						id: 'season-0',
						name: 'Season 2025',
						startDate: isoDate(-300),
						endDate: isoDate(-100),
						conductors: [],
						owners: [],
						editors: ['person-p']
					},
					currentSeason(true)
				]
			})
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(expandFor(container, 'Season 2026')).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandFor(container, 'Season 2025')).toBeNull();
	});
});

// ════════════════════════════════════════════════════════════════════════════════
// #277 REVIEW pins (Bentham, RED verdict) — the three findings that only bite
// once the OPEN panel's season and the automatic pick can differ.
// ════════════════════════════════════════════════════════════════════════════════

/** The two-step series delete inside the panel, from the row's trashcan. */
async function armAndConfirmSeriesDelete(container: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(q(container, `season-manage-series-delete-${id}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-manage-series-delete-confirm-${id}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `season-manage-series-delete-confirm-${id}`) as HTMLElement);
}

/** Each collapsed entry's visible season NAME (its last span — the sr-only verb
 *  and the disclosure triangle precede it), in DOM order. */
function entryNames(container: HTMLElement): string[] {
	return expandButtons(container).map(
		(b) => b.querySelector('span:last-of-type')?.textContent?.trim() ?? ''
	);
}

describe('season card #277 review F1 — a panel-preserving reload keeps the panel on ITS season', () => {
	it('a series delete inside B’s panel reloads the agenda with the panel kept: the panel stays B’s, the next field edit writes B, and B is NOT listed as a collapsed entry while it is open', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		});

		// The panel's own delete → `refreshAfterSeasonManageDelete` →
		// `loadForSelected({ keepSeasonManage: true })`, which leaves the panel open.
		await armAndConfirmSeriesDelete(container, 'series-b1');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await flush();

		// Still B's panel — label, fields, and the id every write carries.
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2027');
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		await editField(container, 'name', 'Renamed B');
		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_B_ID, 'name', 'Renamed B');
		});
		expect(updateSeasonFieldMock).not.toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed B');
		// One face per season: A collapsed, B expanded — never B listed under
		// itself while its own panel is open.
		expect(entryNames(container)).toEqual(['Season 2026']);
	});

	it('the panel’s repertoire section reconciles after that reload even when its own re-read settles BEFORE the agenda load', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let panelItems = [
			{ id: 'rep-b1', workId: 'work-b1', editionId: '', status: 'active', name: 'Kyrie' }
		];
		listRepertoireItemsMock.mockImplementation((_cfg: unknown, seasonId: string) =>
			Promise.resolve(seasonId === SEASON_B_ID ? panelItems : [])
		);
		const container = await renderReady();
		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Kyrie');
		});

		// The post-delete agenda reload NEVER settles, so the panel's own re-read
		// is the only thing that lands — exactly the ordering under which the live
		// `manageableSeasonId` compare dropped it (blanked for the whole reload).
		panelItems = [
			{ id: 'rep-b2', workId: 'work-b2', editionId: '', status: 'active', name: 'Sanctus' }
		];
		loadFullAgendaMock.mockImplementation(() => new Promise(() => {}));
		await armAndConfirmSeriesDelete(container, 'series-b1');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});

		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Sanctus');
		});
		expect(q(container, 'season-manage-repertoire')?.textContent).not.toContain('Kyrie');
	});

	it('review 2 F1 — a panel repertoire WRITE settling during that reload reconciles its own section too: the blanked `manageableSeasonId` is a reload, not a switch', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		// Read 1 = the panel's open, read 2 = the post-delete list refresh (same
		// rows), read 3 = what the status write's own reconcile fetches. Only the
		// third carries a different name, so 'Gloria' on screen can ONLY have come
		// from `refreshPanelRepertoire` — which used to bail on the blank
		// `manageableSeasonId` a `{ keepSeasonManage: true }` reload holds for its
		// whole duration, leaving the section on pre-write rows.
		let bReads = 0;
		listRepertoireItemsMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId !== SEASON_B_ID) return Promise.resolve([]);
			bReads += 1;
			return Promise.resolve(
				bReads >= 3
					? [{ id: 'rep-b1', workId: 'work-b1', editionId: '', status: 'retired', name: 'Gloria' }]
					: repertoireB
			);
		});
		let resolveStatusWrite!: () => void;
		updateRepertoireStatusMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveStatusWrite = resolve as typeof resolveStatusWrite;
				})
		);
		const container = await renderReady();
		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Sanctus');
		});

		// The write goes out BEFORE the reload — mid-reload the panel's controls are
		// read-only anyway (`resetManagement` blanks the rights too), so the only
		// way a write can settle inside that window is to have started outside it.
		await fireEvent.click(
			q(q(container, 'season-manage-repertoire') as HTMLElement, 'work-status-retired') as HTMLElement
		);
		await waitFor(() => {
			expect(updateRepertoireStatusMock).toHaveBeenCalledWith(CFG, 'rep-b1', 'retired');
		});

		// The reload this panel's own series delete fires NEVER settles, so
		// `manageableSeasonId` stays blank for the rest of the test.
		loadFullAgendaMock.mockImplementation(() => new Promise(() => {}));
		await armAndConfirmSeriesDelete(container, 'series-b1');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(bReads).toBe(2);
		});

		// …and only NOW does the status write land, inside the reload's window.
		resolveStatusWrite();

		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Gloria');
		});
		// The reconcile's own read went to the PANEL's season (a third B read),
		// never to the automatic pick the blanked id would have fallen back to.
		expect(bReads).toBe(3);
	});
});

describe('season card #277 review F3 — a series cascade that resolves after a switch', () => {
	it('the delete of A’s series landing AFTER the switch announces nothing, splices no row of B’s, and fires no reload', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let resolveCascade!: (count: number) => void;
		deleteEventSeriesMock.mockImplementation(
			() =>
				new Promise<number>((resolve) => {
					resolveCascade = resolve as typeof resolveCascade;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-a1')).not.toBeNull();
		});
		await armAndConfirmSeriesDelete(container, 'series-a1');
		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalled();
		});

		await openPanelForSeason(container, 'Season 2027');
		const agendaLoadsBeforeLanding = loadFullAgendaMock.mock.calls.length;
		resolveCascade(3);
		await flush();

		expect(q(container, 'season-manage-delete-status')?.textContent?.trim()).toBe('');
		expect(q(container, 'season-manage-delete-error')).toBeNull();
		// B's rows are B's — the stale splice cannot reach them.
		expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(agendaLoadsBeforeLanding);
	});

	it('a REJECTED cascade for A after the switch paints no error slot in B’s panel', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let rejectCascade!: (e: Error) => void;
		deleteEventSeriesMock.mockImplementation(
			() =>
				new Promise<number>((_resolve, reject) => {
					rejectCascade = reject as typeof rejectCascade;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-a1')).not.toBeNull();
		});
		await armAndConfirmSeriesDelete(container, 'series-a1');
		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalled();
		});

		await openPanelForSeason(container, 'Season 2027');
		rejectCascade(new Error('boom, late'));
		await flush();

		expect(q(container, 'season-manage-delete-error')).toBeNull();
		expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
	});
});

describe('season card #277 review F4 — the in-play entry carries the panel’s live name', () => {
	it('ONE manageable season: a rename in the panel then a collapse shows the NEW name on the entry (the collapse keeps the panel’s fields)', async () => {
		const container = await renderReady();
		await openPanel(container);
		await editField(container, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});

		await collapseSeasonCard(container);

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandButtons(container)[0].textContent).toContain('Renamed 2026');
		expect(expandButtons(container)[0].textContent).not.toContain('Season 2026');
	});

	it('the OTHER seasons’ entries keep reading the season list: renaming the open season touches only its own entry', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await editField(container, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});
		// B is collapsed and untouched while A is open…
		expect(entryNames(container)).toEqual(['Season 2027']);

		await collapseSeasonCard(container);

		// …and A's own entry comes back with the edited name beside B's unchanged one.
		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		expect(entryNames(container)).toEqual(['Renamed 2026', 'Season 2027']);
	});
});

describe('season card #277 — [+ Season] alongside the entries', () => {
	it('[+ Hooaeg] stays present above TWO manageable entries, and a created season JOINS the entries after the existing post-create reload', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const container = await renderReady();
		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-create') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'season-create-name') as HTMLInputElement, {
			target: { value: 'Season 2028' }
		});
		await fireEvent.input(q(container, 'season-create-start') as HTMLInputElement, {
			target: { value: isoDate(241) }
		});
		await fireEvent.input(q(container, 'season-create-end') as HTMLInputElement, {
			target: { value: isoDate(400) }
		});
		// The post-create reload answers THREE manageable seasons.
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [
					currentSeason(true),
					upcomingSeason(),
					{
						id: 'season-3',
						name: 'Season 2028',
						startDate: isoDate(241),
						endDate: isoDate(400),
						conductors: [],
						owners: [],
						editors: ['person-p']
					}
				]
			})
		);
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(3);
		});
		expect(expandFor(container, 'Season 2028')).not.toBeNull();
	});
});

// (*MVOX:Tallis* — #132/T3 RED: [⚙] season management — gear entry point, inline
// panel, per-field editing, conductor chips, series/standalone listings, close/persist)
// (*MVOX:Tallis* — #277 RED: per-season entry points — one collapsed entry per
// manageable season, season switch as a context switch (race pins a–d),
// per-season rights re-derivation, single-season case byte-identical)
