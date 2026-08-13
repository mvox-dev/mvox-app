// @vitest-environment happy-dom
//
// #132/T4 RED — EVENT creation on the ACTUAL agenda route (integration: real
// +page.svelte, real AgendaList, real Autocomplete, real manageRightsFrom; only
// the data seams are mocked — same harness family as page.season-create.spec.ts
// and page.season-manage.spec.ts).
//
// WHY (#132): T1 gave us `createEvent`, T3 gave the season panel its [+ Event]
// stub. An editor still cannot BIRTH an event in-app. T4 wires the two entry
// points — a page-level [+ Event] on the agenda and the panel's existing
// season-manage-add-event — into ONE inline creation form (design sketch C):
// event type with autocomplete over PRIOR types, season/series pickers, the
// domain fields, and a series-inheritance PREVIEW (inherited values render as
// placeholders, never as values, so what the form shows is exactly what the
// read-side merge will show).
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA
//     - submit calls `createEvent(cfg, input)` (T1, $lib/entity/entityCreate) —
//       the ONE create seam. orgId from `resolveMyOrgId(cfg, personId)` (NEVER
//       a `_type.string=organization&limit=1` guess). NO `_sharing`, NO
//       inherit-rights flag anywhere in the UI layer — the create body is
//       entirely T1's business (`_type` + `_parent` + domain props only; rights
//       trusted to Entu's inheritance chain from the org — the #132 design
//       decision).
//     - parents: the chosen SEASON id rides in `extraParentIds: [seasonId]`
//       (what listRehearsals selects on); the chosen SERIES id rides in
//       `seriesId` (T1's named field — the one parent that changes validation).
//       No series chosen → `seriesId` absent/undefined (never `''` — the pin
//       below is a full-shape toHaveBeenCalledWith that a `''` would fail).
//     - event types come from `listEventTypes(cfg)` ($lib/events/eventTypes —
//       NEW module): the collective's prior `event_type` values VERBATIM
//       (duplicates included). Loaded when the form OPENS, never on the agenda
//       visit. The PAGE dedupes (exact) + sorts (localeCompare) them into the
//       type Autocomplete's items (item id = the type string).
//     - series options for the selected season come from
//       `listEventSeriesForSeason(cfg, seasonId)` (T3, $lib/seasons/seasonManage).
//     - series defaults for the inheritance preview come from
//       `getSeriesDefaults(cfg, seriesId)` ($lib/seasons/seasonManage — NEW
//       export): `{ name, durationMinutes, defaultLocation }`.
//     - conductor options come through the page's cached `getRoster` path
//       (loadRoster at most ONCE — pinned in page.season-create.spec.ts, held
//       to here).
//     - success → the form closes AND the world refreshes: `loadFullAgenda`
//       re-invoked always; a panel-born create ALSO re-reads the panel's two
//       lists (the new occurrence must show up in the counts it sits under).
//     - error → inline error, form stays OPEN, no refresh.
//
//   TESTIDS
//     event-create                the page-level [+ Event] button on the agenda.
//                                 Renders IFF a CURRENT season exists AND the
//                                 viewer is its editor (seasonManageRights —
//                                 fail-closed, like every other gate). Never
//                                 inside an agenda row.
//     season-manage-add-event     T3's button INSIDE the panel — T4 makes it
//                                 open the SAME form, season pre-filled.
//     event-create-form           the inline form (same route — no goto)
//     event-create-type-field     wrapper around the TYPE Autocomplete (the
//                                 component's own `autocomplete-input` testid is
//                                 per-instance; two instances share this form,
//                                 so each gets a named wrapper)
//     event-create-type-value     the committed type, visible (the Autocomplete
//                                 clears itself on commit — the parent shows
//                                 the pick)
//     event-create-season         season <select>: one option per KNOWN season
//                                 (agenda `seasons`, value = id, label = name)
//                                 behind a '' placeholder option. Pre-filled
//                                 with the panel's season when opened from the
//                                 panel; '' (nothing chosen) from the agenda.
//     event-create-series         series <select>: '' = standalone ("no
//                                 series"), then one option per series of the
//                                 SELECTED season. DISABLED until a season is
//                                 chosen.
//     event-create-name           text input
//     event-create-datetime       type="datetime-local", TALLINN wall clock —
//                                 converted to the UTC instant on submit (the
//                                 event/[id] TE.4 convention, exactly)
//     event-create-duration       number input (minutes)
//     event-create-location       text input
//     event-create-description    TEXTAREA (multiline)
//     event-create-conductors-field  wrapper around the conductor Autocomplete
//     event-create-conductor-<personId>  one chip per picked conductor, showing
//                                 the person's NAME (ids are never UI)
//     event-create-capacity       number input, optional
//     event-create-submit         fires the createEvent write
//     event-create-cancel         closes the form; nothing written
//     event-create-error          inline error, role="alert" (submit failure OR
//                                 the no-season validation refusal)
//
//   SERIES INHERITANCE (the preview)
//     - selecting a series calls getSeriesDefaults ONCE for it and shows the
//       inherited values as PLACEHOLDERS on name / duration / location — the
//       inputs' VALUES stay '' (an own '' would shadow the series default in
//       the read-side ?? merge; T1 drops blanks, and the form must not turn an
//       inherited default into a frozen own value).
//     - typing overrides (the value wins); CLEARING an override restores the
//       placeholder and the field goes back to inherited (not sent).
//     - deselecting the series drops the inherited placeholders.
//     - submit sends ONLY explicitly-typed fields: an untouched inherited
//       field arrives at createEvent blank/absent, NEVER as a copy of the
//       series default (pinned by inspecting the createEvent call's input).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	createEventMock,
	resolveMyOrgIdMock,
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
	listEventTypesMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveMyOrgIdMock: vi.fn(),
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
	listEventTypesMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// T1's write layer — the ONE create seam this page may use for events.
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
// T3's data layer + T4's getSeriesDefaults — the season/series read seams.
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
// T4's prior-event-type read — NEW module, lazy-loaded by the form.
vi.mock('$lib/events/eventTypes', () => ({ listEventTypes: listEventTypesMock }));
vi.mock('$lib/org/myOrg', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/org/myOrg')>();
	return { ...actual, resolveMyOrgId: resolveMyOrgIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
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
import type { CreateEventInput } from '$lib/entity/entityCreate';
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
const UPCOMING_SEASON_ID = 'season-2';

/** ISO calendar date `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The CURRENT season: running now. */
function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

/** An UPCOMING season: starts strictly AFTER today. */
function upcomingSeason(): Season {
	return {
		id: UPCOMING_SEASON_ID,
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
	return {
		upcoming: [],
		recent: [],
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: withUpcomingSeason ? [season, upcomingSeason()] : [season]
	};
}

/** No season is CURRENT — a lapsed one exists (its editor may CREATE a season,
 *  per T2, but there is no season to put an event under from this page). */
function noCurrentSeasonResult(): ReturnType<typeof agendaResult> {
	return {
		upcoming: [],
		recent: [],
		seasonId: null as unknown as string,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: [],
		seasons: [
			{
				id: 'season-0',
				name: 'Season 2025',
				startDate: isoDate(-300),
				endDate: isoDate(-1),
				conductors: [],
				owners: [],
				editors: ['person-p']
			}
		]
	};
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		},
		{
			memberId: 'm-grace',
			personId: 'p-grace',
			name: 'Grace Hopper',
			email: 'grace@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		}
	];
}

/** The selected season's series (T3's list shape). */
function seriesFixture() {
	return [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0 }
	];
}

function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

/** What getSeriesDefaults resolves for series-1 — the inheritance preview's source. */
function series1Defaults() {
	return {
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: 'Bring the black folder'
	};
}

/** The UPCOMING season's own series/events — deliberately distinct rows, so a
 *  list rendered under the WRONG season is unmistakable. */
function upcomingSeriesFixture() {
	return [{ id: 'series-9', name: 'Autumn sectionals', eventCount: 3 }];
}

function upcomingStandaloneFixture() {
	return [{ id: 'ev-77', name: 'Autumn concert', startDatetime: '2027-11-01T18:00:00.000Z' }];
}

/** Route the two season-scoped reads BY seasonId — the default mocks answer the
 *  same rows whatever season is asked for, which cannot tell the two apart. */
function routeSeasonListsBySeason(): void {
	listEventSeriesForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) =>
		seasonId === SEASON_ID ? seriesFixture() : upcomingSeriesFixture()
	);
	listEventsForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) =>
		seasonId === SEASON_ID ? standaloneFixture() : upcomingStandaloneFixture()
	);
}

/** Lets anything already queued — a late reply that WOULD have landed — run
 *  before asserting that it did not. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Prior event_type values as the seam returns them: VERBATIM, duplicates and
 *  all — the PAGE is what dedupes + sorts (pinned below). */
const RAW_EVENT_TYPES = ['rehearsal', 'concert', 'rehearsal', 'sectional'];

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
	createEventMock.mockResolvedValue('ev-new-1');
	resolveMyOrgIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue(seriesFixture());
	listEventsForSeasonMock.mockResolvedValue(standaloneFixture());
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(series1Defaults());
	listEventTypesMock.mockResolvedValue([...RAW_EVENT_TYPES]);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createEventMock.mockReset();
	resolveMyOrgIdMock.mockReset();
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── helpers ─────────────────────────────────────────────────────────────────────

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

/** Open the form via the page-level agenda [+ Event]. */
async function openFormFromAgenda(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'event-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'event-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

/** Open the season-manage panel (T3's gear), then its [+ Event]. */
async function openFormFromPanel(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
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

/** The TYPE Autocomplete's input (wrapped — two Autocomplete instances share
 *  this form, so the component's own `autocomplete-input` testid is ambiguous
 *  container-wide). */
function typeInput(container: HTMLElement): HTMLInputElement {
	const field = q(container, 'event-create-type-field') as HTMLElement;
	expect(field).not.toBeNull();
	const input = field.querySelector('[data-testid="autocomplete-input"]') as HTMLInputElement;
	expect(input).not.toBeNull();
	return input;
}

/** Commit an EXISTING type by picking its option. */
async function pickType(container: HTMLElement, filter: string, type: string): Promise<void> {
	const input = typeInput(container);
	await fireEvent.input(input, { target: { value: filter } });
	await waitFor(() => {
		expect(q(container, `autocomplete-option-${type}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `autocomplete-option-${type}`) as HTMLElement);
}

/** Commit a NEW type as free text (allowFreeText — Enter with no highlight). */
async function freeTextType(container: HTMLElement, type: string): Promise<void> {
	const input = typeInput(container);
	await fireEvent.input(input, { target: { value: type } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

/** Pick a conductor through the form's conductor Autocomplete. */
async function pickConductor(
	container: HTMLElement,
	filter: string,
	personId: string
): Promise<void> {
	const field = q(container, 'event-create-conductors-field') as HTMLElement;
	expect(field).not.toBeNull();
	const input = field.querySelector('[data-testid="autocomplete-input"]') as HTMLElement;
	expect(input).not.toBeNull();
	await fireEvent.input(input, { target: { value: filter } });
	await waitFor(() => {
		expect(q(container, `autocomplete-option-${personId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `autocomplete-option-${personId}`) as HTMLElement);
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
}

/** The input object the page handed createEvent on its most recent call. */
function lastCreateInput(): CreateEventInput {
	const calls = createEventMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventInput;
}

// ── the entry points: rights-gated agenda button + the panel's [+ Event] ────────

describe('agenda — the [+ Event] entry point (rights gate)', () => {
	it('season editor + current season: event-create renders at page level (never inside an agenda row); merely rendering writes nothing and fetches no event types', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		const control = q(container, 'event-create') as HTMLElement;
		expect(control.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(control.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(createEventMock).not.toHaveBeenCalled();
		expect(listEventTypesMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it('NON-editor: event-create does NOT render — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'event-create')).toBeNull();
	});

	it('NO current season (only a lapsed one the viewer edits): no event-create — there is no running season to put an event under', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult());
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();
	});

	it('an upcoming season hides [+ Season] (T2) but NOT [+ Event] — the two gates are independent', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		expect(q(container, 'season-create')).toBeNull();
	});

	it('clicking [+ Event] opens the inline form IN PLACE (no goto): season select is EMPTY (nothing chosen), series select is DISABLED until a season is picked — and nothing is written by opening', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		expect(gotoMock).not.toHaveBeenCalled();

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		expect(season).not.toBeNull();
		expect(season.tagName).toBe('SELECT');
		expect(season.value).toBe('');

		const series = q(container, 'event-create-series') as HTMLSelectElement;
		expect(series).not.toBeNull();
		expect(series.disabled).toBe(true);

		expect(createEventMock).not.toHaveBeenCalled();
	});

	it("the PANEL's [+ Event] (T3's season-manage-add-event) opens the SAME form with the panel's season PRE-FILLED and the series options already offered", async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		expect(season.value).toBe(SEASON_ID);

		const series = q(container, 'event-create-series') as HTMLSelectElement;
		expect(series.disabled).toBe(false);
		const values = [...series.querySelectorAll('option')].map((o) => o.value);
		expect(values).toEqual(['', 'series-1', 'series-2']);

		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await fill(container, 'event-create-name', 'Doomed draft');

		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

// ── the form's fields (design sketch C) ─────────────────────────────────────────

describe('agenda — the event creation form carries every sketch-C field', () => {
	it('name (text), datetime (datetime-local), duration + capacity (number), location (text), description (TEXTAREA), a type Autocomplete and a conductor Autocomplete', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.tagName).toBe('INPUT');

		const datetime = q(container, 'event-create-datetime') as HTMLInputElement;
		expect(datetime).not.toBeNull();
		expect(datetime.type).toBe('datetime-local');

		const duration = q(container, 'event-create-duration') as HTMLInputElement;
		expect(duration).not.toBeNull();
		expect(duration.type).toBe('number');

		const capacity = q(container, 'event-create-capacity') as HTMLInputElement;
		expect(capacity).not.toBeNull();
		expect(capacity.type).toBe('number');

		const location = q(container, 'event-create-location') as HTMLInputElement;
		expect(location).not.toBeNull();
		expect(location.tagName).toBe('INPUT');

		const description = q(container, 'event-create-description') as HTMLElement;
		expect(description).not.toBeNull();
		expect(description.tagName).toBe('TEXTAREA');

		expect(typeInput(container)).not.toBeNull();
		const conductors = q(container, 'event-create-conductors-field') as HTMLElement;
		expect(conductors.querySelector('[data-testid="autocomplete-input"]')).not.toBeNull();
	});

	it('the season select offers EVERY known season (value = id, its NAME visible) behind a "" placeholder option', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromAgenda(container);

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		const options = [...season.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', SEASON_ID, UPCOMING_SEASON_ID]);
		expect(options[1].textContent).toContain('Season 2026');
		expect(options[2].textContent).toContain('Season 2027');
	});

	it('choosing a season (agenda-opened) loads THAT season’s series — listEventSeriesForSeason(cfg, <the selected id>, …) — and enables the series select with a "" (no-series) option first', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromAgenda(container);

		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID);

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, UPCOMING_SEASON_ID);
		});
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(series.disabled).toBe(false);
		});
		const options = [...series.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', 'series-1', 'series-2']);
		expect(options[1].textContent).toContain('Monday rehearsals');
		expect(options[2].textContent).toContain('Sectionals');
	});
});

// ── the event-type autocomplete: prior types, deduped + sorted, free text ───────

describe('agenda — the event-type autocomplete builds on PRIOR event types', () => {
	it('listEventTypes fires ONCE, when the form OPENS — never on the agenda visit itself', async () => {
		const container = await renderReady();
		expect(listEventTypesMock).not.toHaveBeenCalled();

		await openFormFromAgenda(container);
		await waitFor(() => {
			expect(listEventTypesMock).toHaveBeenCalledTimes(1);
		});
		expect(listEventTypesMock.mock.calls[0][0]).toEqual(CFG);
	});

	it('the raw values are DEDUPLICATED and SORTED into the options: [rehearsal, concert, rehearsal, sectional] offers exactly concert / rehearsal / sectional, in that order', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		// ArrowDown on the closed combobox opens the full (unfiltered) list.
		const input = typeInput(container);
		await fireEvent.keyDown(input, { key: 'ArrowDown' });

		const field = q(container, 'event-create-type-field') as HTMLElement;
		await waitFor(() => {
			expect(field.querySelector('[data-testid^="autocomplete-option-"]')).not.toBeNull();
		});
		const labels = [...field.querySelectorAll('[data-testid^="autocomplete-option-"]')].map((el) =>
			el.textContent?.trim()
		);
		expect(labels).toEqual(['concert', 'rehearsal', 'sectional']);
	});

	it('picking a prior type commits it: event-create-type-value shows the pick', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		await pickType(container, 'con', 'concert');

		await waitFor(() => {
			expect(q(container, 'event-create-type-value')?.textContent).toContain('concert');
		});
	});

	it('FREE TEXT commits a NEW type (allowFreeText): "afterparty" is not among the options, Enter commits it anyway', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		await freeTextType(container, 'afterparty');

		await waitFor(() => {
			expect(q(container, 'event-create-type-value')?.textContent).toContain('afterparty');
		});
	});
});

// ── conductors: the T2 Autocomplete, through the page's cached roster ───────────

describe('agenda — the conductor autocomplete reuses T2’s component and the cached roster', () => {
	it('the roster loads at most ONCE (through getRoster), only when the form opens; a picked conductor renders as a NAMED chip', async () => {
		const container = await renderReady();
		expect(loadRosterMock).not.toHaveBeenCalled();

		await openFormFromAgenda(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		await pickConductor(container, 'ada', 'p-ada');

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'event-create-conductor-p-ada')?.textContent).toContain('Ada Lovelace');
		// Client-side filtering — still exactly one roster read.
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});
});

// ── series inheritance: placeholders, never values ──────────────────────────────

describe('agenda — selecting a series previews the inherited fields as PLACEHOLDERS', () => {
	async function openWithSeries1(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await waitFor(() => {
			expect(getSeriesDefaultsMock).toHaveBeenCalledWith(CFG, 'series-1');
		});
	}

	it('name / duration / location show the series defaults as placeholders — the VALUES stay empty (an own value would freeze the inheritance)', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		const duration = q(container, 'event-create-duration') as HTMLInputElement;
		const location = q(container, 'event-create-location') as HTMLInputElement;

		await waitFor(() => {
			expect(name.placeholder).toContain('Monday rehearsals');
		});
		expect(duration.placeholder).toContain('90');
		expect(location.placeholder).toContain('Main hall');

		expect(name.value).toBe('');
		expect(duration.value).toBe('');
		expect(location.value).toBe('');
	});

	it('typing OVERRIDES an inherited field; CLEARING the override restores the placeholder (the field goes back to inherited)', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		await waitFor(() => {
			expect(name.placeholder).toContain('Monday rehearsals');
		});

		await fill(container, 'event-create-name', 'Extra rehearsal');
		expect(name.value).toBe('Extra rehearsal');

		await fill(container, 'event-create-name', '');
		expect(name.value).toBe('');
		// The placeholder never left — the inherited default is offered again.
		expect(name.placeholder).toContain('Monday rehearsals');
	});

	it('DESELECTING the series (back to "no series") drops the inherited placeholders', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		await waitFor(() => {
			expect(name.placeholder).toContain('Monday rehearsals');
		});

		await selectValue(container, 'event-create-series', '');

		await waitFor(() => {
			expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).not.toContain(
				'Monday rehearsals'
			);
		});
		expect(
			(q(container, 'event-create-duration') as HTMLInputElement).placeholder
		).not.toContain('90');
		expect(
			(q(container, 'event-create-location') as HTMLInputElement).placeholder
		).not.toContain('Main hall');
	});
});

// ── submission: the createEvent call, its params, and the after-party ───────────

describe('agenda — submit calls createEvent with exactly what the viewer set', () => {
	it('STANDALONE full flow (agenda-opened): every field set → createEvent(cfg, {…}) ONCE, full shape — org from resolveMyOrgId, season in extraParentIds, NO seriesId, Tallinn wall clock converted to the UTC instant', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		// 19:00 Europe/Tallinn on 18 Apr 2027 (EEST, UTC+3) = 16:00Z — the same
		// wall-clock convention the event/[id] editor pins (TE.4).
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await fill(container, 'event-create-duration', '120');
		await fill(container, 'event-create-location', 'Estonia Hall');
		await fill(container, 'event-create-description', 'Doors at 18:30');
		await pickConductor(container, 'ada', 'p-ada');
		await fill(container, 'event-create-capacity', '300');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		// FULL param shape (partial assertions hide bugs). No seriesId key — a
		// standalone create passes it absent/undefined, never ''.
		expect(createEventMock).toHaveBeenCalledWith(CFG, {
			name: 'Spring concert',
			orgId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z',
			durationMinutes: 120,
			location: 'Estonia Hall',
			description: 'Doors at 18:30',
			conductorRefs: ['p-ada'],
			capacity: 300
		});
		expect(resolveMyOrgIdMock).toHaveBeenCalledWith(CFG, 'person-p');

		// Close + refresh: the agenda re-reads the world the write just changed.
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('SERIES occurrence, untouched inherited fields (panel-opened): seriesId is the picked series, the season still rides in extraParentIds, and the inherited defaults are NOT copied into the call', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await freeTextType(container, 'rehearsal');
		// 18:30 Tallinn on 7 Sep 2026 (EEST, UTC+3) = 15:30Z.
		await fill(container, 'event-create-datetime', '2026-09-07T18:30');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		const input = lastCreateInput();
		expect(input.orgId).toBe(ORG_EFK);
		expect(input.seriesId).toBe('series-1');
		expect(input.extraParentIds).toEqual([SEASON_ID]);
		expect(input.eventType).toBe('rehearsal');
		expect(input.startDatetime).toBe('2026-09-07T15:30:00.000Z');
		// The inherited trio arrives BLANK/ABSENT — never a frozen copy of the
		// series defaults ('' is fine: T1 drops blanks; a copied value is the bug).
		expect(input.name ?? '').toBe('');
		expect(input.durationMinutes ?? undefined).toBeUndefined();
		expect(input.location ?? '').toBe('');
		expect(input.description ?? '').toBe('');
		expect(input.conductorRefs ?? []).toEqual([]);
		expect(input.capacity ?? undefined).toBeUndefined();
	});

	it('SERIES occurrence with OVERRIDES: the typed name + duration are sent, the untouched location still is not', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await freeTextType(container, 'rehearsal');
		await fill(container, 'event-create-datetime', '2026-09-07T18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await fill(container, 'event-create-duration', '45');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		const input = lastCreateInput();
		expect(input.name).toBe('Extra rehearsal');
		expect(input.durationMinutes).toBe(45);
		expect(input.location ?? '').toBe('');
	});

	it('a PANEL-born create refreshes the panel lists too: after success the season’s series + standalone lists re-read (the new occurrence must land in the counts), the panel is STILL OPEN to receive them, and the agenda refreshes', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		const eventReadsBefore = listEventsForSeasonMock.mock.calls.length;

		await selectValue(container, 'event-create-series', 'series-1');
		await freeTextType(container, 'rehearsal');
		await fill(container, 'event-create-datetime', '2026-09-07T18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		expect(listEventsForSeasonMock.mock.calls.length).toBeGreaterThan(eventReadsBefore);
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		// #132/T4 review F2 — the refresh above must land somewhere VISIBLE. The
		// panel the editor launched this create from stays open across the
		// agenda reload (which otherwise tears it down via resetSeasonManage),
		// keeping its already-seeded fields; focus lands back in it rather than
		// on <body>.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(
			(q(container, 'season-manage-name') as HTMLElement | null)?.textContent ?? ''
		).not.toBe('');
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
	});

	it('no SEASON chosen (agenda-opened): submit refuses with event-create-error (role="alert"), createEvent is NEVER called, the form stays open — a season-less event is invisible to every agenda read', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-name', 'Orphan event');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
	});

	it('a FAILED write: event-create-error shows (role="alert"), the form stays OPEN with the work still in it, and nothing refreshes', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'event-create-form')).not.toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).value).toBe('Spring concert');
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		// …and the failure is not sticky: a second submit retries the write.
		createEventMock.mockResolvedValue('ev-new-1');
		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(2);
		});
	});
});

// ── #132/T4 review: validation, the announced result, and the visible labels ───

/** The type Autocomplete's committed value is private to the page; these read
 *  the box the viewer is actually looking at. */
function typeInputValue(container: HTMLElement): string {
	return typeInput(container).value;
}

describe('agenda — event create REFUSES an incomplete form before it writes (review F1)', () => {
	it('TYPED BUT NOT COMMITTED type (no Enter): the word is still in the box, so the write uses it — never a silent eventType: ""', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		// Typed, NOT confirmed — the trap: `event-create-type-value` never appears,
		// but "afterparty" is right there in the input.
		await fireEvent.input(typeInput(container), { target: { value: 'afterparty' } });
		expect(q(container, 'event-create-type-value')).toBeNull();
		expect(typeInputValue(container)).toBe('afterparty');
		await fill(container, 'event-create-name', 'Cast party');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().eventType).toBe('afterparty');
	});

	it('NO type at all: refused with the TYPE message, createEvent never runs, the form stays open and the combobox is aria-invalid pointing at the message', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await fill(container, 'event-create-name', 'Spring concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		const error = q(container, 'event-create-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		// NOT the generic write-failure copy — that names no field and blames a
		// network nobody asked.
		expect(error.textContent?.trim()).toBe('event_create_type_required');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
		expect(typeInput(container).getAttribute('aria-invalid')).toBe('true');
		expect(typeInput(container).getAttribute('aria-describedby')).toBe(error.id);
		expect(error.id).toBe('event-create-error');
	});

	it('NO datetime: refused with the DATETIME message; the input carries aria-invalid + aria-describedby', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_create_datetime_required'
		);
		expect(createEventMock).not.toHaveBeenCalled();
		const input = q(container, 'event-create-datetime') as HTMLInputElement;
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe('event-create-error');
	});

	it('STANDALONE with no name: refused (a standalone event has no series to inherit a name from)', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_create_name_required'
		);
		expect(createEventMock).not.toHaveBeenCalled();
		expect((q(container, 'event-create-name') as HTMLInputElement).getAttribute('aria-invalid')).toBe(
			'true'
		);
	});

	it('a SERIES occurrence with no name is NOT refused — the name is inherited (already pinned above, held here against the new name guard)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await freeTextType(container, 'rehearsal');
		await fill(container, 'event-create-datetime', '2026-09-07T18:30');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(q(container, 'event-create-error')).toBeNull();
	});

	it('the refusal is not sticky: editing the named field clears it, and the next submit re-decides', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});

		await fill(container, 'event-create-name', 'Spring concert');
		expect(q(container, 'event-create-error')).toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).getAttribute('aria-invalid')).toBeNull();

		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
	});
});

describe('agenda — a successful event create SAYS SO (review F3)', () => {
	it('event-create-status is mounted (empty) from first render and carries the result after the write — the form vanishing is otherwise the same signal Cancel gives', async () => {
		const container = await renderReady();
		const status = q(container, 'event-create-status') as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent?.trim()).toBe('');

		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe('event_created');
		});
	});

	it('a FAILED write announces nothing — the status slot stays empty', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-status')?.textContent?.trim()).toBe('');
	});
});

describe('agenda — every event-create field keeps a VISIBLE label (review F4 + F5)', () => {
	it('a series with NO default_location keeps the static Location hint — an inherited blank is not a placeholder', async () => {
		// `default_location` is optional on event_series; getSeriesDefaults reports
		// an absent property as ''.
		getSeriesDefaultsMock.mockResolvedValue({
			name: 'Ad-hoc sectionals',
			durationMinutes: null,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');

		await waitFor(() => {
			expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
				'Ad-hoc sectionals'
			);
		});
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect((q(container, 'event-create-duration') as HTMLInputElement).placeholder).toBe(
			'event_create_duration_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
	});

	it('capacity and description carry placeholders, not an aria-label alone — capacity sits beside a duration box that has one', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		expect((q(container, 'event-create-capacity') as HTMLInputElement).placeholder).toBe(
			'event_create_capacity_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
	});
});

// ── #132/T4 review, 2nd pass: the live type box, the panel's own season, and
//    the form's in-flight guards ─────────────────────────────────────────────────

describe('agenda — event create writes the type the viewer is LOOKING AT (2nd-pass F1)', () => {
	it('a committed type RETYPED without Enter: the write carries the RETYPED word, and the echoed committed value stops showing', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await waitFor(() => {
			expect(q(container, 'event-create-type-value')?.textContent).toContain('concert');
		});

		// The combobox blanked its own input on that commit; the viewer now types
		// a DIFFERENT type into the visibly empty box and never presses Enter.
		await fireEvent.input(typeInput(container), { target: { value: 'workshop' } });
		expect(typeInputValue(container)).toBe('workshop');
		// …and the echo of the superseded commit goes with it — a line reading
		// 'concert' beside a box reading 'workshop' names a value nothing uses.
		expect(q(container, 'event-create-type-value')).toBeNull();

		await fill(container, 'event-create-name', 'Summer workshop');
		await fill(container, 'event-create-datetime', '2027-06-02T18:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().eventType).toBe('workshop');
	});

	it('the box CLEARED back to empty falls back to the committed type — a deletion is not a refusal', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fireEvent.input(typeInput(container), { target: { value: 'wor' } });
		await fireEvent.input(typeInput(container), { target: { value: '' } });

		await waitFor(() => {
			expect(q(container, 'event-create-type-value')?.textContent).toContain('concert');
		});
		await fill(container, 'event-create-name', 'Spring concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().eventType).toBe('concert');
	});
});

describe("agenda — a panel-born create refreshes the PANEL's season, not the form's (2nd-pass F2)", () => {
	it('the form’s season switched away: the panel keeps showing ITS OWN season’s series and events', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ withUpcomingSeason: true }));
		routeSeasonListsBySeason();
		const container = await renderReady();
		await openFormFromPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});

		// The panel is scoped to the CURRENT season; the form's select is merely
		// prefilled from it, and the viewer moves the event to another season.
		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID);
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-name', 'Autumn opener');
		await fill(container, 'event-create-datetime', '2027-10-04T19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().extraParentIds).toEqual([UPCOMING_SEASON_ID]);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await flush();

		// The panel survived (review F2) — and its lists still belong to it.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-9')).toBeNull();
		expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
		expect(q(container, 'season-manage-event-ev-77')).toBeNull();
	});
});

describe('agenda — the event-create form drops async replies that no longer belong to it (2nd-pass F3)', () => {
	it('the season switched while its series read is in flight: the select never offers the PREVIOUS season’s series', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ withUpcomingSeason: true }));
		let releaseSlow: (list: unknown) => void = () => {};
		listEventSeriesForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId === SEASON_ID) {
				return new Promise((resolve) => {
					releaseSlow = resolve;
				});
			}
			return Promise.resolve(upcomingSeriesFixture());
		});
		const container = await renderReady();
		// Agenda-born: the season starts EMPTY, so no series read has fired yet.
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID); // …hangs
		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID); // …answers

		const select = () => q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(select().querySelector('option[value="series-9"]')).not.toBeNull();
		});

		// The abandoned season's list arrives late. It must land nowhere: offered
		// under the new season, picking one would ride along as a cross-season
		// `event_series` parent on the created event.
		releaseSlow(seriesFixture());
		await flush();
		expect(select().querySelector('option[value="series-1"]')).toBeNull();
		expect(select().querySelector('option[value="series-9"]')).not.toBeNull();
	});

	it('the form dismissed and REOPENED while a series-defaults read is in flight: the fresh form shows the static hints, not the dead form’s inherited ones', async () => {
		let releaseDefaults: (defaults: unknown) => void = () => {};
		getSeriesDefaultsMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseDefaults = resolve;
				})
		);
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');

		await fireEvent.keyDown(q(container, 'event-create-form') as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});

		releaseDefaults(series1Defaults());
		await flush();
		// No series is selected in THIS form — inheriting the dismissed form's
		// preview would promise a name/location/duration nothing will supply.
		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
	});
});

describe('agenda — the inheritance preview covers DESCRIPTION too (2nd-pass F4)', () => {
	it('a series carrying a default_description previews it as the description placeholder', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');

		await waitFor(() => {
			expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
				'Bring the black folder'
			);
		});
		// …and a blank description still WRITES as absent — the preview says what
		// the read side will supply, it does not freeze a copy into the event.
		await pickType(container, 'con', 'concert');
		await fill(container, 'event-create-datetime', '2027-04-18T19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().description).toBeUndefined();
	});
});

// (*MVOX:Tallis* — #132/T4 RED: [+ Event] — two entry points, one inline form,
// prior-type autocomplete, series-inheritance placeholder preview, createEvent wiring)
// (*MVOX:Palestrina* — #132/T4 review: validation ladder, announced result,
// panel survival, visible labels)
