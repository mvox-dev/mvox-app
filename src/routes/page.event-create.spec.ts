// @vitest-environment happy-dom
//
// #132/T4 RED — EVENT creation on the ACTUAL agenda route (integration: real
// +page.svelte, real AgendaList, real manageRightsFrom; only
// the data seams are mocked — same harness family as page.season-create.spec.ts
// and page.season-manage.spec.ts).
//
// WHY (#132): T1 gave us `createEvent`, T3 gave the season panel its [+ Event]
// stub. An editor still cannot BIRTH an event in-app. T4 wires the two entry
// points — a page-level [+ Event] on the agenda and the panel's existing
// season-manage-add-event — into ONE inline creation form (design sketch C):
// event type (a canonical localized picker since #199), season/series pickers, the
// domain fields, and a series-inheritance PREVIEW (#208: descriptive
// placeholders stay put; inherited values render as a muted "From series:"
// secondary line under each field — never as values, so what the form sends is
// exactly what the read-side merge will supply).
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA
//     - submit calls `createEvent(cfg, input)` (T1, $lib/entity/entityCreate) —
//       the ONE create seam. dbEntityId from `resolveDatabaseEntityId(cfg, personId)` (NEVER
//       a `_type.string=organization&limit=1` guess). NO `_sharing`, NO
//       inherit-rights flag anywhere in the UI layer — the create body is
//       entirely T1's business (`_type` + `_parent` + domain props only; rights
//       trusted to Entu's inheritance chain from the org — the #132 design
//       decision).
//     - parents: the chosen SEASON id rides in `extraParentIds: [seasonId]`
//       (what listEvents selects on); the chosen SERIES id rides in
//       `seriesId` (T1's named field — the one parent that changes validation).
//       No series chosen → `seriesId` absent/undefined (never `''` — the pin
//       below is a full-shape toHaveBeenCalledWith that a `''` would fail).
//     - event types are the EIGHT canonical v4E keys, offered by the
//       `event-create-type` <select> and labelled through paraglide. #199
//       replaced the free-text Autocomplete — and the prior-values read that
//       fed it — with that picker; full contract in
//       page.event-type-picker.spec.ts.
//     - series options for the selected season come from
//       `listEventSeriesForSeason(cfg, seasonId)` (T3, $lib/seasons/seasonManage).
//     - series defaults for the inheritance preview come from
//       `getSeriesDefaults(cfg, seriesId)` ($lib/seasons/seasonManage):
//       `{ name, durationMinutes, defaultLocation, defaultDescription }`.
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
//     event-create-type           #199 — the canonical, localized <select>
//                                 (same shape as series-create-type); replaced
//                                 the free-text Autocomplete this doc used to
//                                 describe here (event-create-type-field /
//                                 event-create-type-value) — full picker
//                                 contract in page.event-type-picker.spec.ts
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
//     event-create-datetime       #207 rule 5: a composite under this testid —
//                                 event-create-datetime-date (native
//                                 <input type="date">, kept per Gama) +
//                                 -hour/-minute selects (TimeSelect, 24h
//                                 default, 5-min steps by construction).
//                                 State string stays 'YYYY-MM-DDTHH:MM',
//                                 TALLINN wall clock — converted to the UTC
//                                 instant on submit (the event/[id] TE.4
//                                 convention, exactly)
//     event-create-duration       number input (minutes)
//     event-create-location       text input
//     event-create-description    TEXTAREA (multiline)
//     event-create-conductors-field  wrapper around the conductor <select>
//     event-create-conductor-select  the NATIVE conductor <select> (#209)
//     event-create-conductor-<personId>  one chip per picked conductor, showing
//                                 the person's NAME (ids are never UI)
//     event-create-capacity       number input, optional
//     event-create-submit         fires the createEvent write
//     event-create-cancel         closes the form; nothing written
//     event-create-error          inline error, role="alert" (submit failure OR
//                                 the no-season validation refusal)
//     event-create-<field>-inherited  #208 — for <field> in name / duration /
//                                 location / description: ONE line of small
//                                 muted PLAIN TEXT directly under the field,
//                                 rendering m.event_create_inherited_from_series
//                                 ({ value }). Present IFF a series is selected
//                                 AND getSeriesDefaults provides a value for
//                                 that field. Not a widget, not a control.
//
//   SERIES INHERITANCE (the preview — #208 Gama ruling: secondary label,
//   create form ONLY; supersedes the #132/T4 values-in-placeholders preview)
//     - the four inputs (name / duration / location / description) keep their
//       DESCRIPTIVE placeholders (m.event_create_<field>_placeholder()) at all
//       times — selecting a series never writes into a placeholder and never
//       writes into a .value (an own '' would shadow the series default in
//       the read-side ?? merge; T1 drops blanks, and the form must not turn an
//       inherited default into a frozen own value).
//     - selecting a series calls getSeriesDefaults ONCE for it and shows each
//       provided value on the field's event-create-<field>-inherited line
//       (duration formatted through the existing agenda_duration_min unit
//       key). Fields the series carries no value for get NO line.
//     - typing an override keeps the line visible (the viewer sees what they
//       are replacing); CLEARING the override keeps it too — the field is
//       simply back to inherited (not sent).
//     - deselecting the series removes every inherited line.
//     - submit sends ONLY explicitly-typed fields: an untouched inherited
//       field arrives at createEvent blank/absent, NEVER as a copy of the
//       series default (pinned by inspecting the createEvent call's input).
//       UNCHANGED by #208 — as is the success announcement's precedence
//       (own name || series name || type).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// Exceptions ECHO their params, so the value the page hands the message has to
// survive into the rendered text:
//   - `event_created` — #207 rule 7 pins the success toast's `when` string
//     (the date part must be ISO).
//   - `event_create_inherited_from_series` — #208 pins the "From series:"
//     secondary line's payload AND which key renders it (key + value echo).
//   - `agenda_duration_min` — the sibling-spec convention (`${minutes} min`);
//     #208 pins that the inherited-duration line goes through this existing
//     unit key, not a bare number.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => {
				const k = String(key);
				if (k === 'event_created')
					return (p: { name: string; when: string }) => `event_created ${p.name} @ ${p.when}`;
				if (k === 'event_create_inherited_from_series')
					return (p: { value: string }) => `event_create_inherited_from_series ${p.value}`;
				if (k === 'agenda_duration_min') return (p: { minutes: number }) => `${p.minutes} min`;
				return () => k;
			}
		}
	)
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
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
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
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
	getSeriesDefaultsMock: vi.fn()
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
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { HOURS_24, MINUTES_5, fillDateTime, optionValues } from '$lib/testing/timeControls';
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
 * This is NOT a "no season" shape, however much it reads like one:
 * `currentSeason` ignores `end_date` by design (a lapsed season can still own
 * real events — agendaData's "Fila hooaeg" note) and answers `season-0`, and
 * `manageableSeason` finds no not-yet-started successor and falls back to that
 * same season (step 3). The builder derives both from the season list, so this
 * is a shape `listFullAgenda` can genuinely return — unlike the earlier
 * hand-pinned version, which claimed `seasonId: null` AND
 * `manageableSeasonId: null` for this very list (#167 review round 2, F3).
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
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue(seriesFixture());
	listEventsForSeasonMock.mockResolvedValue(standaloneFixture());
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(series1Defaults());
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
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

/** #199 — `event-create-type` is the canonical, localized <select> (same
 *  shape as `series-create-type`; full picker contract pinned in
 *  page.event-type-picker.spec.ts). It replaced the free-text Autocomplete
 *  this suite used to drive via a filter string + a commit keystroke: there
 *  is no filtering and no free text any more, so choosing a type IS just
 *  changing the select. */
function typeSelect(container: HTMLElement): HTMLSelectElement {
	const select = q(container, 'event-create-type') as HTMLSelectElement;
	expect(select).not.toBeNull();
	return select;
}

async function chooseType(container: HTMLElement, type: string): Promise<void> {
	await selectValue(container, 'event-create-type', type);
}

/** #209 — the form's NATIVE conductor <select> (rule 1), asserted present. */
function conductorSelect(container: HTMLElement): HTMLSelectElement {
	const field = q(container, 'event-create-conductors-field') as HTMLElement;
	expect(field).not.toBeNull();
	const select = field.querySelector(
		'[data-testid="event-create-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'expected the native event-create-conductor-select').not.toBeNull();
	expect(select.tagName).toBe('SELECT');
	return select;
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
async function pickConductor(container: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(container), { target: { value: personId } });
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
	it('season editor + current season: event-create renders at page level (never inside an agenda row); merely rendering writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		const control = q(container, 'event-create') as HTMLElement;
		expect(control.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(control.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it('NON-editor: event-create does NOT render — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'event-create')).toBeNull();
	});

	it('the only season LAPSED yesterday and nothing is queued behind it: event-create RENDERS — `manageableSeason` falls back to that season, and it is still where a new event belongs', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(true));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'event-create')).not.toBeNull();
		});
		// The rights rode along on the season list — no database-entity round-trip.
		expect(resolveManageRightsMock).not.toHaveBeenCalled();
	});

	it('fail-closed on the same shape: a lapsed-only season the viewer does NOT edit (and no collective-wide grant) still hides event-create', async () => {
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
	it('name (text), datetime (datetime-local), duration + capacity (number), location (text), description (TEXTAREA), a type picker (#199 canonical select) and a native conductor select (#209)', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.tagName).toBe('INPUT');

		// #207 rule 5 — no longer a native datetime-local (whose time half
		// renders per browser locale): a composite of a native DATE input
		// (native picker stays, Gama ruling) + the TimeSelect hour/minute
		// selects, under the SAME surface testid on a wrapper.
		const datetime = q(container, 'event-create-datetime') as HTMLElement;
		expect(datetime).not.toBeNull();
		expect(datetime.tagName).not.toBe('INPUT');
		const dtDate = q(container, 'event-create-datetime-date') as HTMLInputElement;
		expect(dtDate).not.toBeNull();
		expect(dtDate.type).toBe('date');
		const dtHour = q(container, 'event-create-datetime-hour') as HTMLSelectElement;
		const dtMinute = q(container, 'event-create-datetime-minute') as HTMLSelectElement;
		expect(dtHour.tagName).toBe('SELECT');
		expect(dtMinute.tagName).toBe('SELECT');
		expect(optionValues(dtHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(dtMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'event-create-datetime-ampm'), '24h is the default').toBeNull();

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

		expect(typeSelect(container).tagName).toBe('SELECT');
		// #209 — the conductor picker is a NATIVE select (rule 1), named by the
		// existing label key, resting on its non-committable prompt option.
		const conductors = conductorSelect(container);
		expect(conductors.getAttribute('aria-label')).toBe('event_create_conductor_label');
		expect(promptOption(conductors).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
		expect(conductors.value).toBe('');
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

// #199 superseded the "event-type autocomplete builds on PRIOR event types"
// describe block that lived here: `event-create-type` is now the same
// canonical, localized <select> as `series-create-type` — no more
// `listEventTypes` read (that module is DELETED — it had no callers left), no
// more dedup/sort of prior free-text values, no
// more free-text commit. That contract now lives in
// page.event-type-picker.spec.ts (exactly the 8 canonical options, localized
// labels, canonical-key writes).

// ── conductors: the native <select> (#209), through the page's cached roster ────

describe('agenda — the conductor select (#209) is fed from the cached roster', () => {
	it('the roster loads at most ONCE (through getRoster), only when the form opens; the select offers every roster person; a picked conductor renders as a NAMED chip and the select resets to the prompt', async () => {
		const container = await renderReady();
		expect(loadRosterMock).not.toHaveBeenCalled();

		await openFormFromAgenda(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		// FULL option array (value = person id, text = display name) behind the
		// prompt — nobody picked yet, no sections → roster's own order.
		const select = conductorSelect(container);
		await waitFor(() => {
			expect(optionValues(select)).toEqual(['', 'p-ada', 'p-grace', 'person-p']);
		});
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual([
			'event_create_conductor_placeholder',
			'Ada Lovelace',
			'Grace Hopper',
			'Pete Wilson'
		]);

		await pickConductor(container, 'p-ada');

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'event-create-conductor-p-ada')?.textContent).toContain('Ada Lovelace');

		// Chip pattern stays (Gama ruling 3): select back at the prompt, the
		// picked person no longer offered.
		await waitFor(() => {
			expect(conductorSelect(container).value).toBe('');
		});
		expect(optionValues(conductorSelect(container))).toEqual(['', 'p-grace', 'person-p']);

		// One roster read — the select is fed, not searched.
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('option order is ROSTER order — section (listSections tree order), then position within section, Unassigned last — NOT alphabetical (Gama ruling 3)', async () => {
		// loadRoster answers NAME order (Ada, Grace, Pete). Grace sings Sopran
		// (first), Ada Tenor (second), Pete is unassigned → LAST.
		loadRosterMock.mockResolvedValue([
			{ ...fixtureRows()[0], sectionIds: ['sec-t'] }, // Ada → Tenor
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran
			{ ...fixtureRows()[2], sectionIds: [] } // Pete → Unassigned
		]);
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		await openFormFromAgenda(container);

		await waitFor(() => {
			// Sopran (Grace), Tenor (Ada), Unassigned (Pete). Alphabetical would
			// put Ada first.
			expect(optionValues(conductorSelect(container))).toEqual([
				'',
				'p-grace',
				'p-ada',
				'person-p'
			]);
		});
	});

	it('EVERYONE picked: the select stays MOUNTED but disabled and its prompt text becomes picker_everyone_added (Gama ruling 2)', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);

		await pickConductor(container, 'p-ada');
		await pickConductor(container, 'p-grace');
		await pickConductor(container, 'person-p');

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-person-p')).not.toBeNull();
		});
		const select = conductorSelect(container);
		await waitFor(() => {
			expect(select.disabled).toBe(true);
		});
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_everyone_added');

		// Removing a chip revives the select — the state is derived, not sticky.
		await fireEvent.click(q(container, 'event-create-conductor-remove-p-ada') as HTMLElement);
		await waitFor(() => {
			expect(conductorSelect(container).disabled).toBe(false);
		});
		expect(optionValues(conductorSelect(container))).toEqual(['', 'p-ada']);
		expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
	});
});

// ── series inheritance: descriptive placeholders + "From series" lines (#208) ──

describe('agenda — selecting a series keeps DESCRIPTIVE placeholders and shows the inherited values as "From series" secondary lines (#208)', () => {
	async function openWithSeries1(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await waitFor(() => {
			expect(getSeriesDefaultsMock).toHaveBeenCalledWith(CFG, 'series-1');
		});
	}

	/** The trimmed text of one event-create-<field>-inherited line (null = absent). */
	function inherited(container: HTMLElement, field: string): string | null {
		const el = q(container, `event-create-${field}-inherited`);
		return el ? (el.textContent ?? '').trim() : null;
	}

	it('all four placeholders stay the DESCRIPTIVE keys, the VALUES stay empty, and each inherited value renders on its own muted line (exact strings)', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		// The secondary lines carry the series defaults — full-string pins, so a
		// wrong key, a missing wrapper or a bare unformatted duration all fail.
		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});
		expect(inherited(container, 'duration')).toEqual('event_create_inherited_from_series 90 min');
		expect(inherited(container, 'location')).toEqual(
			'event_create_inherited_from_series Main hall'
		);
		expect(inherited(container, 'description')).toEqual(
			'event_create_inherited_from_series Bring the black folder'
		);

		// …while the inputs themselves are untouched by the selection: the
		// descriptive placeholders never leave, and no value is written.
		const name = q(container, 'event-create-name') as HTMLInputElement;
		const duration = q(container, 'event-create-duration') as HTMLInputElement;
		const location = q(container, 'event-create-location') as HTMLInputElement;
		const description = q(container, 'event-create-description') as HTMLTextAreaElement;
		expect(name.placeholder).toBe('event_create_name_placeholder');
		expect(duration.placeholder).toBe('event_create_duration_placeholder');
		expect(location.placeholder).toBe('event_create_location_placeholder');
		expect(description.placeholder).toBe('event_create_description_placeholder');
		expect(name.value).toBe('');
		expect(duration.value).toBe('');
		expect(location.value).toBe('');
		expect(description.value).toBe('');

		// The line is PLAIN TEXT, not a widget (PO native-controls rule): nothing
		// interactive hides inside it.
		for (const field of ['name', 'duration', 'location', 'description']) {
			const line = q(container, `event-create-${field}-inherited`) as HTMLElement;
			expect(line.querySelector('input, select, textarea, button, a'), field).toBeNull();
		}
	});

	it('typing an OVERRIDE keeps the inherited line visible (the viewer sees what they are replacing); CLEARING it keeps the line too', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});

		await fill(container, 'event-create-name', 'Extra rehearsal');
		expect(name.value).toBe('Extra rehearsal');
		expect(inherited(container, 'name')).toEqual(
			'event_create_inherited_from_series Monday rehearsals'
		);
		// The placeholder is not the preview any more — it never budges either way.
		expect(name.placeholder).toBe('event_create_name_placeholder');

		await fill(container, 'event-create-name', '');
		expect(name.value).toBe('');
		// The line never left — the inherited default is still on offer.
		expect(inherited(container, 'name')).toEqual(
			'event_create_inherited_from_series Monday rehearsals'
		);
		expect(name.placeholder).toBe('event_create_name_placeholder');
	});

	it('DESELECTING the series (back to "no series") removes ALL FOUR inherited lines', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});

		await selectValue(container, 'event-create-series', '');

		await waitFor(() => {
			expect(inherited(container, 'name')).toBeNull();
		});
		expect(inherited(container, 'duration')).toBeNull();
		expect(inherited(container, 'location')).toBeNull();
		expect(inherited(container, 'description')).toBeNull();
	});

	it('a series providing ONLY name + duration renders exactly those two lines — no location/description line for values the series does not carry', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: 'Ad-hoc sectionals',
			durationMinutes: 45,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Ad-hoc sectionals'
			);
		});
		expect(inherited(container, 'duration')).toEqual('event_create_inherited_from_series 45 min');
		expect(inherited(container, 'location')).toBeNull();
		expect(inherited(container, 'description')).toBeNull();
	});
});

// ── submission: the createEvent call, its params, and the after-party ───────────

describe('agenda — submit calls createEvent with exactly what the viewer set', () => {
	it('STANDALONE full flow (agenda-opened): every field set → createEvent(cfg, {…}) ONCE, full shape — org from resolveDatabaseEntityId, season in extraParentIds, NO seriesId, Tallinn wall clock converted to the UTC instant', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		// 19:00 Europe/Tallinn on 18 Apr 2027 (EEST, UTC+3) = 16:00Z — the same
		// wall-clock convention the event/[id] editor pins (TE.4).
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await fill(container, 'event-create-duration', '120');
		await fill(container, 'event-create-location', 'Estonia Hall');
		await fill(container, 'event-create-description', 'Doors at 18:30');
		await pickConductor(container, 'p-ada');
		await fill(container, 'event-create-capacity', '300');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		// FULL param shape (partial assertions hide bugs). No seriesId key — a
		// standalone create passes it absent/undefined, never ''.
		expect(createEventMock).toHaveBeenCalledWith(CFG, {
			name: 'Spring concert',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z',
			durationMinutes: 120,
			location: 'Estonia Hall',
			description: 'Doors at 18:30',
			conductorRefs: ['p-ada'],
			capacity: 300
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);

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
		await chooseType(container, 'rehearsal');
		// 18:30 Tallinn on 7 Sep 2026 (EEST, UTC+3) = 15:30Z.
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		// FULL argument shape (#208 hardened: toEqual, not field-by-field ?? reads
		// — an extra frozen-copy key would have slipped past the old asserts).
		// NO name / durationMinutes / location / description keys AT ALL: the
		// untouched inherited quartet is absent, never a copy of the series
		// defaults. The "From series" lines are presentation only.
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1'
		});
	});

	it('SERIES occurrence with OVERRIDES: the typed name + duration are sent, the untouched location/description still are not (full shape)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await fill(container, 'event-create-duration', '45');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1',
			name: 'Extra rehearsal',
			durationMinutes: 45
		});
	});

	it('SERIES occurrence, ONLY the name overridden: exactly that one extra key rides along', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1',
			name: 'Extra rehearsal'
		});
	});

	it('a PANEL-born create refreshes the panel lists too: after success the season’s series + standalone lists re-read (the new occurrence must land in the counts), the panel is STILL OPEN to receive them, and the agenda refreshes', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		const eventReadsBefore = listEventsForSeasonMock.mock.calls.length;

		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
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
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Orphan event');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
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
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
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

// #199 superseded both pins that lived here: `event-create-type` is now the
// canonical <select> — it always carries a value ('rehearsal' by default), so
// there is no "typed but not committed" state and no "no type at all" refusal
// to reach any more. The picker's own contract (exactly the 8 canonical
// options, defaulting to rehearsal) is pinned in
// page.event-type-picker.spec.ts instead.

describe('agenda — event create REFUSES an incomplete form before it writes (review F1)', () => {
	it('NO datetime: refused with the DATETIME message; the input carries aria-invalid + aria-describedby', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_create_datetime_required'
		);
		expect(createEventMock).not.toHaveBeenCalled();
		// #207 review F2 — the composite WRAPPER keeps the surface testid and, as
		// a named role="group", the accessible name; the aria-invalid /
		// aria-describedby wiring lives on the FOCUSABLE CONTROLS inside, which
		// is the only place a screen reader announces it. Asserting it on the
		// wrapper alone was the partial assertion that let the regression pass.
		const wrapper = q(container, 'event-create-datetime') as HTMLElement;
		expect(wrapper.getAttribute('role')).toBe('group');
		expect(wrapper.getAttribute('aria-label')).toBe('event_create_datetime_label');
		for (const testid of [
			'event-create-datetime-date',
			'event-create-datetime-hour',
			'event-create-datetime-minute'
		]) {
			const control = q(container, testid) as HTMLElement;
			expect(['INPUT', 'SELECT'], `${testid} is a real form control`).toContain(control.tagName);
			expect(control.getAttribute('aria-invalid'), testid).toBe('true');
			expect(control.getAttribute('aria-describedby'), testid).toBe('event-create-error');
		}
	});

	it('STANDALONE with no name: refused (a standalone event has no series to inherit a name from)', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
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
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
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
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
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
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			// The mock echoes params (see the messages mock above), so the status is
			// the key PLUS the name/when args — presence of the key is this test's pin.
			expect(q(container, 'event-create-status')?.textContent?.trim()).toContain('event_created');
		});
	});

	// #207 rule 7 — the toast's `when` is numeric date text: ISO `YYYY-MM-DD`,
	// with the time part staying 24h `HH:MM` (rule 5, already landed). The
	// fixture is typed as Tallinn wall-clock (2027-04-18 19:00 EEST) and the
	// toast formats the resulting UTC instant BACK in Europe/Tallinn, so the
	// full string round-trips to exactly what the operator typed.
	it('#207 rule 7: the success toast renders the event start as "YYYY-MM-DD HH:MM" (ISO date + 24h time, Tallinn wall clock)', async () => {
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Spring concert @ 2027-04-18 19:00'
			);
		});
	});

	// #208 guards — the announcement's naming precedence is UNTOUCHED by the
	// secondary-label change: own (typed) name || series name || type value.
	it('#208 guard: an untouched SERIES occurrence is announced under the SERIES name (no own name typed)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Monday rehearsals @ 2026-09-07 18:30'
			);
		});
	});

	it('#208 guard: an OWN typed name beats the series name in the announcement', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Extra rehearsal @ 2026-09-07 18:30'
			);
		});
	});

	it('#208 guard: a series with NO name of its own falls back to the TYPE value in the announcement', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: '',
			durationMinutes: 45,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created rehearsal @ 2026-09-07 18:30'
			);
		});
	});

	it('a FAILED write announces nothing — the status slot stays empty', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromAgenda(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-status')?.textContent?.trim()).toBe('');
	});
});

describe('agenda — every event-create field keeps a VISIBLE label (review F4 + F5)', () => {
	it('#208: a series providing ONLY a name — every placeholder stays the static descriptive hint, and only the NAME gets a "From series" line', async () => {
		// `default_location` / `duration_minutes` / `default_description` are
		// optional on event_series; getSeriesDefaults reports an absent string
		// property as '' and an absent duration as null.
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
			expect(q(container, 'event-create-name-inherited')?.textContent?.trim()).toBe(
				'event_create_inherited_from_series Ad-hoc sectionals'
			);
		});
		// The descriptive hints never leave — #208's whole point.
		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect((q(container, 'event-create-duration') as HTMLInputElement).placeholder).toBe(
			'event_create_duration_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
		// A blank inherited value is NO line, not an empty line.
		expect(q(container, 'event-create-duration-inherited')).toBeNull();
		expect(q(container, 'event-create-location-inherited')).toBeNull();
		expect(q(container, 'event-create-description-inherited')).toBeNull();
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

// ── #132/T4 review, 2nd pass: the panel's own season, and the form's
//    in-flight guards ─────────────────────────────────────────────────────────

// #199 superseded the "event create writes the type the viewer is LOOKING AT
// (2nd-pass F1)" describe block that lived here: it pinned the Autocomplete's
// live-box-wins-over-committed-value precedence (retype without Enter, clear
// back to committed) — behaviour a canonical <select> has no room for, since
// every change IS the commit.

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
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Autumn opener');
		await fillDateTime(container, 'event-create-datetime', '2027-10-04', '19:00');
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
		// …and no "From series" line either (#208): the dead form's late defaults
		// must not seed the fresh form's secondary labels any more than its
		// placeholders.
		expect(q(container, 'event-create-name-inherited')).toBeNull();
		expect(q(container, 'event-create-duration-inherited')).toBeNull();
		expect(q(container, 'event-create-location-inherited')).toBeNull();
		expect(q(container, 'event-create-description-inherited')).toBeNull();
	});
});

describe('agenda — the inheritance preview covers DESCRIPTION too (2nd-pass F4, #208 secondary line)', () => {
	it('a series carrying a default_description shows it on the description "From series" line — the placeholder stays descriptive', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'event-create-description-inherited')?.textContent?.trim()).toBe(
				'event_create_inherited_from_series Bring the black folder'
			);
		});
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
		// …and a blank description still WRITES as absent — the preview says what
		// the read side will supply, it does not freeze a copy into the event.
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().description).toBeUndefined();
	});
});

// ── #208: the new key exists in ALL FOUR locales (same guard family as the
//    attendance/repertoire a11y specs — the mock above hides a missing key at
//    render time, so the message FILES are pinned directly) ────────────────────

describe('#208 — locale coverage for the "From series" secondary line', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('event_create_inherited_from_series exists in en/et/lv/uk, is non-empty, and carries the {value} slot', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['event_create_inherited_from_series'];
			expect(msg, `${locale}.json is missing event_create_inherited_from_series`).toBeDefined();
			expect(msg, `${locale}.json event_create_inherited_from_series is empty`).toMatch(/\S/);
			expect(msg, `${locale}.json event_create_inherited_from_series lacks {value}`).toContain(
				'{value}'
			);
		}
	});

	it('the en/et copy is the ruled wording (Gama, #208): "From series: {value}" / "Seeriast: {value}"', () => {
		expect(messages('en')['event_create_inherited_from_series']).toBe('From series: {value}');
		expect(messages('et')['event_create_inherited_from_series']).toBe('Seeriast: {value}');
	});

	it('guard: agenda_duration_min (the inherited-duration unit) already exists in all four locales with {minutes}', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['agenda_duration_min'];
			expect(msg, `${locale}.json is missing agenda_duration_min`).toBeDefined();
			expect(msg, `${locale}.json agenda_duration_min lacks {minutes}`).toContain('{minutes}');
		}
	});
});

// ── the picker's EMPTY states (#209 review F1) ─────────────────────────────────

describe('agenda — the event-create conductor select tells its empties apart (#209 review F1)', () => {
	it('roster read STILL IN FLIGHT: disabled with the LOADING prompt, never picker_everyone_added', async () => {
		loadRosterMock.mockReturnValue(new Promise<never>(() => {})); // never settles

		const container = await renderReady();
		await openFormFromAgenda(container);

		const select = conductorSelect(container);
		expect(select.disabled).toBe(true);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE, permanently visible rather than reading as "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		await openFormFromAgenda(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
				'picker_roster_unavailable'
			);
		});
		expect(conductorSelect(container).disabled).toBe(true);
	});

	it('SECTION read failed: the select stays usable in the roster’s own name order and says so', async () => {
		listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const container = await renderReady();
		await openFormFromAgenda(container);

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-order-note')).not.toBeNull();
		});
		const select = conductorSelect(container);
		expect(select.disabled).toBe(false);
		expect(promptOption(select).textContent?.trim()).toBe('event_create_conductor_placeholder');
	});
});

// (*MVOX:Tallis* — #132/T4 RED: [+ Event] — two entry points, one inline form,
// prior-type autocomplete, series-inheritance placeholder preview, createEvent wiring)
// (*MVOX:Palestrina* — #132/T4 review: validation ladder, announced result,
// panel survival, visible labels)
// (*MVOX:Tallis* — #208 RED: descriptive placeholders always; inherited series
// values as "From series" secondary lines; submit path + announcement guards)
