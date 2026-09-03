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
//       FAIL-CLOSED: a non-editor gets NO gear, not a disabled one. No current
//       season → nothing to manage → no gear (independent of T2's [+ Season]).
//
//   TESTIDS
//     season-manage-gear          the [⚙] button. Renders IFF a CURRENT season
//                                 exists AND the viewer is its editor. Has an
//                                 accessible name (aria-label) — an icon-only
//                                 button announcing nothing is not shippable.
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
//     season-manage-event-<id>    one row per STANDALONE event: name
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
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
	removeSeasonConductorMock
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
	removeSeasonConductorMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// T3's data layer — the ONE seam the panel may read/write seasons through.
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock
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
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
// The viewer IS a season editor in most cases here, so the page's
// loadManagePickers fires — stub its reads or they hit the network.
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue([]),
	listAllEditions: vi.fn().mockResolvedValue([]),
	listAllCopies: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
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

/** An UPCOMING season — makes T2's [+ Season] gate close while the CURRENT
 *  season stays fully manageable (the two affordances gate independently). */
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

/** Click the gear, wait for the panel. Returns the panel element. */
async function openPanel(container: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
	return q(container, 'season-manage-panel') as HTMLElement;
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

// ── the entry point: gear on the season header, rights-gated ────────────────────

describe('agenda — the [⚙] season-manage entry point', () => {
	it('season editor + current season: season-manage-gear renders as a BUTTON with an accessible name, outside any agenda row; merely rendering opens no panel and writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		const gear = q(container, 'season-manage-gear') as HTMLElement;
		expect(gear.tagName).toBe('BUTTON');
		// Icon-only affordance MUST carry a name a screen reader can announce.
		// #222 — the name is COMPUTED from the visible 'Manage season' text
		// (season-manage-label) via aria-labelledby, not authored twice as a
		// separate aria-label: one copy per locale, visible and announced alike.
		const labelledby = gear.getAttribute('aria-labelledby');
		expect(labelledby, 'the gear must take its name from the visible label').toBeTruthy();
		const labelEl = container.querySelector(`[id="${labelledby}"]`) as HTMLElement;
		expect(labelEl, 'aria-labelledby must resolve to an element').not.toBeNull();
		expect(labelEl.getAttribute('data-testid')).toBe('season-manage-label');
		// The message mock renders keys verbatim — the computed name IS the
		// season_manage_gear_label copy ('Manage season' in en).
		expect(labelEl.textContent?.trim()).toBe('season_manage_gear_label');
		expect(gear.hasAttribute('aria-label'), 'no duplicated aria-label authoring').toBe(false);
		expect(gear.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(gear.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
		expect(listEventsForSeasonMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no gear at all — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'season-manage-gear')).toBeNull();
	});

	it('the only season LAPSED yesterday and nothing is queued behind it: the gear RENDERS — its panel is the only way to fix that season’s dates', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(true));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		// The rights rode along on the season list — no database-entity round-trip.
		expect(resolveManageRightsMock).not.toHaveBeenCalled();
	});

	it('fail-closed on the same shape: a lapsed-only season the viewer does NOT edit (and no collective-wide grant) still hides the gear', async () => {
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
		expect(q(container, 'season-manage-gear')).toBeNull();
	});

	it('the gear gates INDEPENDENTLY of [+ Season]: with an upcoming season the create affordance is gone, the gear stays (the current season is still manageable)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		expect(q(container, 'season-create')).toBeNull();
	});

	it('clicking [⚙] opens season-manage-panel INLINE (no route change), a dialog with an accessible name, and loads the series + standalone-event lists for THIS season', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(panel.getAttribute('role')).toBe('dialog');
		expect(panel.getAttribute('aria-label')).toBeTruthy();

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});
		expect(listEventsForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
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

	it('standalone events render one row each (name visible); [+ Event] — T4’s entry point — is present inside the panel', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
		});
		expect(q(container, 'season-manage-event-ev-9')?.textContent).toContain('Spring concert');

		expect(q(container, 'season-manage-add-event')).not.toBeNull();
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
		// The standalone-event list loaded fine — its failure is tracked separately.
		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
		});
		expect(q(container, 'season-manage-events-error')).toBeNull();
	});

	it('a FAILED standalone-event read surfaces its own error, and leaves the series list alone', async () => {
		listEventsForSeasonMock.mockRejectedValue(new Error('read down'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-events-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-events-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-event-ev-9')).toBeNull();
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-error')).toBeNull();
	});

	it('a failed read does not stick: reopening after a recovery shows the rows and no error', async () => {
		listEventSeriesForSeasonMock.mockRejectedValueOnce(new Error('read down'));
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
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
	it('a second GEAR click dismisses the panel (#213 — no internal close button exists); nothing was written by opening + closing', async () => {
		const container = await renderReady();
		await openPanel(container);

		// #213 — the panel carries no season-manage-close; the gear toggles.
		expect(q(container, 'season-manage-close')).toBeNull();
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(addSeasonConductorMock).not.toHaveBeenCalled();
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();
	});

	// #132/T3 review F1 — the Escape assertions below dispatch at
	// `document.activeElement`, NEVER at the panel element: firing the key at the
	// panel proves only that the handler is bound, not that a real keypress can
	// ever reach it. #222 containment model: the panel renders inside the shared
	// agenda-admin-card as a SIBLING of the role="toolbar" header row that holds
	// the gear — never inside the toolbar element itself — so unless the open
	// ACTUALLY moves focus into the dialog, a browser Escape dispatches at the
	// gear (or <body>) and never enters the panel's subtree.
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

	it('dismissing the panel returns focus to the [⚙] that opened it — a keyboard user is not dropped at document start', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});

		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(document.activeElement).toBe(q(container, 'season-manage-gear'));
	});

	it('closing through the GEAR leaves focus on the gear (#213 — it does not unmount; the old × did)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(document.activeElement).toBe(q(container, 'season-manage-gear'));
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

		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

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

// (*MVOX:Tallis* — #132/T3 RED: [⚙] season management — gear entry point, inline
// panel, per-field editing, conductor chips, series/standalone listings, close/persist)
