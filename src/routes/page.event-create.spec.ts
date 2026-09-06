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
//     event-create                REMOVED by #213 — the page-level [+ Event]
//                                 no longer exists; the gear (its gate is the
//                                 SAME manageable-season formula) opens the
//                                 panel, and the panel's [+ Event] is the ONLY
//                                 entry into this form now.
//     season-manage-add-event     T3's button INSIDE the panel — opens the
//                                 form, season pre-filled with the panel's.
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
//                                 with the panel's season (#213: every open is
//                                 panel-born now); the viewer may re-pick,
//                                 including back to '' (nothing chosen).
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
//     event-create-end            #243 — the duration number input is GONE.
//                                 In its place: an END composite under this
//                                 wrapper testid — event-create-end-date
//                                 (native <input type="date">, mirrors the
//                                 start date until the viewer touches it) +
//                                 -hour/-minute selects (TimeSelect, rule 5;
//                                 -ampm in AM/PM preference mode). Named by a
//                                 VISIBLE label (#239 idiom, Gama's on-issue
//                                 addition): aria-labelledby → a visible span,
//                                 NO aria-label on the wrapper. Submit derives
//                                 duration_minutes = (utc(end) − utc(start))
//                                 via the SAME two-pass Tallinn conversion,
//                                 each endpoint INDEPENDENTLY — real elapsed
//                                 minutes across a DST transition, never
//                                 wall-clock arithmetic. Blank end time = no
//                                 durationMinutes key at all (series
//                                 inheritance preserved). The wire is
//                                 UNCHANGED: only start_datetime +
//                                 duration_minutes, no end prop exists.
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
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { HOURS_24, MINUTES_5, fillDateTime, fillTime, optionValues } from '$lib/testing/timeControls';
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

describe('agenda — the event-creation entry point (rights gate — #213: the gear + the panel [+ Event])', () => {
	it('season editor + current season: the GEAR renders (page-level, never inside an agenda row); the page-level event-create is GONE; merely rendering writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		// #213 — event creation moved INSIDE the panel; no standalone button.
		expect(q(container, 'event-create')).toBeNull();
		const control = q(container, 'season-manage-gear') as HTMLElement;
		expect(control.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(control.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it('NON-editor: the gear does NOT render — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'event-create')).toBeNull();
	});

	it('the only season LAPSED yesterday and nothing is queued behind it: the gear RENDERS — `manageableSeason` falls back to that season, and it is still where a new event belongs', async () => {
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

	it('an upcoming season hides [+ Season] (T2) but NOT the gear — the two gates are independent', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		expect(q(container, 'season-create')).toBeNull();
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
		await openFormFromPanel(container);
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
		await openFormFromPanel(container);

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

		// #243 — the duration NUMBER INPUT is GONE: nobody thinks of a camp as
		// 2880 minutes. It is replaced by an END composite (end date + end time)
		// mirroring the start one; duration_minutes is COMPUTED on submit.
		expect(q(container, 'event-create-duration'), '#243 removed the duration input').toBeNull();
		const end = q(container, 'event-create-end') as HTMLElement;
		expect(end, '#243: the end composite (event-create-end)').not.toBeNull();
		expect(end.tagName).not.toBe('INPUT');
		const endDate = q(container, 'event-create-end-date') as HTMLInputElement;
		expect(endDate, 'native end date input (native pickers stay, #207 Option 1)').not.toBeNull();
		expect(endDate.type).toBe('date');
		const endHour = q(container, 'event-create-end-hour') as HTMLSelectElement;
		const endMinute = q(container, 'event-create-end-minute') as HTMLSelectElement;
		expect(endHour.tagName, 'end time is the shipped TimeSelect (rule 5)').toBe('SELECT');
		expect(endMinute.tagName).toBe('SELECT');
		expect(optionValues(endHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(endMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'event-create-end-ampm'), '24h is the default').toBeNull();

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
		// #209 — the conductor picker is a NATIVE select (rule 1), resting on its
		// non-committable prompt option. #249 DELIBERATELY flips the naming half
		// of the old pin: the accessible name now comes from a visible wrapping
		// <label> (single-name rule — the aria-label is GONE; the full labeling
		// contract lives in the #249 block at the end of this file).
		const conductors = conductorSelect(container);
		expect(
			conductors.getAttribute('aria-label'),
			'#249 — the visible label replaced the aria-label'
		).toBeNull();
		expect(
			conductors.closest('label'),
			'#249 — the conductor select is named by a wrapping visible <label>'
		).not.toBeNull();
		expect(promptOption(conductors).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
		expect(conductors.value).toBe('');
	});

	it('the season select offers EVERY known season (value = id, its NAME visible) behind a "" placeholder option', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromPanel(container);

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		const options = [...season.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', SEASON_ID, UPCOMING_SEASON_ID]);
		expect(options[1].textContent).toContain('Season 2026');
		expect(options[2].textContent).toContain('Season 2027');
	});

	it('choosing a season (agenda-opened) loads THAT season’s series — listEventSeriesForSeason(cfg, <the selected id>, …) — and enables the series select with a "" (no-series) option first', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromPanel(container);

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

		await openFormFromPanel(container);
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
		await openFormFromPanel(container);

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
		await openFormFromPanel(container);

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
		const location = q(container, 'event-create-location') as HTMLInputElement;
		const description = q(container, 'event-create-description') as HTMLTextAreaElement;
		expect(name.placeholder).toBe('event_create_name_placeholder');
		expect(location.placeholder).toBe('event_create_location_placeholder');
		expect(description.placeholder).toBe('event_create_description_placeholder');
		expect(name.value).toBe('');
		expect(location.value).toBe('');
		expect(description.value).toBe('');
		// #243 — the duration input is gone; the inherited duration must NEVER be
		// pre-filled into the END composite either (#208's rule: an inherited
		// value is never copied into a value or a placeholder). The end time
		// selects stay unpicked — a blank end time IS the "inherit from series"
		// state on the wire (no durationMinutes key sent).
		expect((q(container, 'event-create-end-hour') as HTMLSelectElement).value).toBe('');
		expect((q(container, 'event-create-end-minute') as HTMLSelectElement).value).toBe('');

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

		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		// 19:00 Europe/Tallinn on 18 Apr 2027 (EEST, UTC+3) = 16:00Z — the same
		// wall-clock convention the event/[id] editor pins (TE.4).
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		// #243 — the end pair replaces the duration input: same-day end at 21:00
		// (the end DATE mirrors the start date untouched) → 120 computed minutes.
		await fillTime(container, 'event-create-end', '21:00');
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
		// #243 — a 45-minute override is now an END at 19:15 (end date mirrors the
		// start date: the same-day case costs exactly one interaction, Done-when 4).
		await fillTime(container, 'event-create-end', '19:15');
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

	it('no SEASON chosen (the viewer re-picks the "" placeholder): submit refuses with event-create-error (role="alert"), createEvent is NEVER called, the form stays open — a season-less event is invisible to every agenda read', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		// #213 — every open is panel-born and pre-filled; clearing the select is
		// how a no-season submit happens now.
		await selectValue(container, 'event-create-season', '');
		expect((q(container, 'event-create-series') as HTMLSelectElement).disabled).toBe(true);
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
		await openFormFromPanel(container);
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
		await openFormFromPanel(container);
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
		// #243 (Gama's on-issue addition, binding): the start/end pair is named by
		// VISIBLE labels in #239's idiom — a visible sibling <span> via
		// aria-labelledby, NO aria-label on the group. This INVERTS the previous
		// aria-label assertion deliberately.
		expect(wrapper.getAttribute('aria-label')).toBeNull();
		const startLabelledby = wrapper.getAttribute('aria-labelledby');
		expect(startLabelledby, 'the start group is named by a visible label').toBeTruthy();
		const startLabel = container.querySelector(`#${startLabelledby}`) as HTMLElement;
		expect(startLabel).not.toBeNull();
		expect(startLabel.textContent?.trim()).toBe('event_create_start_label');
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
		await openFormFromPanel(container);
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
		await openFormFromPanel(container);
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

		await openFormFromPanel(container);
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
		await openFormFromPanel(container);
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
		await openFormFromPanel(container);
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
		await openFormFromPanel(container);

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
		// Panel-born (#213 removed the page-level [+ Event], so every open is): the
		// season field is PRE-FILLED with `manageableSeasonId` — SEASON_ID, the
		// running season — and its series read fires at open, so the hanging read is
		// already in flight before the viewer re-picks below.
		await openFormFromPanel(container);
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
		await openFormFromPanel(container);

		const select = conductorSelect(container);
		expect(select.disabled).toBe(true);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE, permanently visible rather than reading as "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		await openFormFromPanel(container);

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
		await openFormFromPanel(container);

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

// ── #220 — the AM/PM preference on the event-created toast (display ONLY) ────
//
// "Am/pm preference applies globally" (Mihkel): the success toast's `when`
// composes the untouched ISO date half (#207 rule 7, as shipped) with the
// TIME half rendered through the ONE shared formatter — in ampm mode
// '2027-04-18 7:00 PM'. The WIRE stays byte-identical: createEvent still
// receives the same UTC instant regardless of the display preference. Store
// set BEFORE render, reset in finally (page.series-create.spec.ts pattern).

/** Drive the datetime composite in AM/PM mode — fillDateTime assumes 24h
 *  options ('19' is not among the 12h hour options), so the parts are set the
 *  way a viewer in ampm mode sets them: 12h hour + minute + AM/PM select. */
async function fillDateTimeAmpm(
	container: HTMLElement,
	prefix: string,
	date: string,
	hour12: string,
	minute: string,
	ampm: 'AM' | 'PM'
): Promise<void> {
	await fireEvent.input(q(container, `${prefix}-date`) as HTMLElement, { target: { value: date } });
	await fireEvent.change(q(container, `${prefix}-hour`) as HTMLElement, {
		target: { value: hour12 }
	});
	await fireEvent.change(q(container, `${prefix}-minute`) as HTMLElement, {
		target: { value: minute }
	});
	await fireEvent.change(q(container, `${prefix}-ampm`) as HTMLElement, { target: { value: ampm } });
}

describe('#220 — AM/PM preference on the event-created toast (and NOT on the wire)', () => {
	it("'ampm': the toast renders 'event_created Spring concert @ 2027-04-18 7:00 PM' — ISO date half untouched (rule 7), time half through the shared formatter", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			// 7:00 PM Tallinn on 18 Apr 2027 — the same instant the 24h toast spec
			// pins as '2027-04-18 19:00'.
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			await submit(container);

			await waitFor(() => {
				expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
					'event_created Spring concert @ 2027-04-18 7:00 PM'
				);
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'ampm' wire guard: createEvent STILL receives the untouched UTC instant — the preference is display-only, stored/submitted values never change", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			await submit(container);

			await waitFor(() => {
				expect(createEventMock).toHaveBeenCalledTimes(1);
			});
			// FULL param shape (partial assertions hide bugs): 7:00 PM Tallinn
			// (EEST, UTC+3) = 16:00Z — byte-identical to the 24h submit spec above.
			expect(createEventMock).toHaveBeenCalledWith(CFG, {
				name: 'Spring concert',
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'concert',
				startDatetime: '2027-04-18T16:00:00.000Z'
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});
});

// (*MVOX:Tallis* — #220 RED: ampm toast rendering + display-only wire guard)

// ═════════════════════════════════════════════════════════════════════════════
// #243 — multi-day events: start/end date+time entry instead of a duration
//
// "Nobody thinks of a camp as 2 880 minutes long; they think of it as running
// from Saturday morning to Sunday afternoon." The duration NUMBER INPUT is
// replaced by an END pair (native date input + TimeSelect); duration_minutes
// is COMPUTED on submit and written EXACTLY as today — the wire shape, the
// property names and eventDetail's read are all unchanged (Done-when 2; the
// schema question is SETTLED on the issue: event = start_datetime +
// duration_minutes, NO end field — do not re-open).
//
// Derivation contract (SPIKE-settled): convert start-local and end-local
// INDEPENDENTLY to UTC instants via the existing two-pass Tallinn helper,
// subtract, divide by 60 000. Naive wall-clock arithmetic is WRONG across a
// DST transition — the fixtures below pin the exact real-minutes numbers on
// both 2026 transitions (Europe/Tallinn: spring-forward 2026-03-29,
// fall-back 2026-10-25).
//
// Same-day mechanism (Done-when 4, engineering pick STATED): the end date
// MIRRORS the start date until the viewer touches the end date input — the
// common same-day case costs exactly one interaction (pick the end time),
// the multi-day case exactly one extra date pick.
// ═════════════════════════════════════════════════════════════════════════════

describe('#243 — visible labels on the start/end pair (Gama on-issue addition, #239 idiom)', () => {
	it('the END group: role="group", named by a VISIBLE label via aria-labelledby, NO aria-label on the wrapper; inner per-control labels name the parts', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const end = q(container, 'event-create-end') as HTMLElement;
		expect(end.getAttribute('role')).toBe('group');
		expect(end.getAttribute('aria-label'), 'no aria-label on the group — #205 F1 trap').toBeNull();
		const labelledby = end.getAttribute('aria-labelledby');
		expect(labelledby, 'named by a visible label').toBeTruthy();
		const label = container.querySelector(`#${labelledby}`) as HTMLElement;
		expect(label, 'the aria-labelledby target exists').not.toBeNull();
		expect(label.textContent?.trim()).toBe('event_create_end_label');
		// VISIBLE — not an sr-only crutch: the whole point of Gama's addition.
		expect(label.classList.contains('sr-only')).toBe(false);
		// The inner date input names its PART (the #239 shape: parts name the
		// parts, the visible label names the whole).
		expect(
			(q(container, 'event-create-end-date') as HTMLElement).getAttribute('aria-label')
		).toBe('time_select_date_label');
	});

	it('the START group flips to the same idiom: visible label, no aria-label', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const start = q(container, 'event-create-datetime') as HTMLElement;
		expect(start.getAttribute('role')).toBe('group');
		expect(start.getAttribute('aria-label')).toBeNull();
		const labelledby = start.getAttribute('aria-labelledby');
		expect(labelledby).toBeTruthy();
		const label = container.querySelector(`#${labelledby}`) as HTMLElement;
		expect(label).not.toBeNull();
		expect(label.textContent?.trim()).toBe('event_create_start_label');
		expect(label.classList.contains('sr-only')).toBe(false);
	});
});

describe('#243 — the end date MIRRORS the start date until touched (Done-when 4)', () => {
	it('filling/changing the start date writes the end date too — until the viewer touches the end date, after which it stays put', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const endDate = q(container, 'event-create-end-date') as HTMLInputElement;
		await fill(container, 'event-create-datetime-date', '2027-04-18');
		expect(endDate.value, 'end date mirrors the start date').toBe('2027-04-18');

		await fill(container, 'event-create-datetime-date', '2027-04-19');
		expect(endDate.value, 'the mirror keeps following').toBe('2027-04-19');

		// The viewer touches the end date — the mirror latches OFF.
		await fill(container, 'event-create-end-date', '2027-04-20');
		await fill(container, 'event-create-datetime-date', '2027-04-21');
		expect(endDate.value, 'a touched end date is never silently overwritten').toBe('2027-04-20');
	});

	it('cancel + reopen re-arms the mirror (the latch resets with the rest of the form)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fill(container, 'event-create-end-date', '2027-04-20');
		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect((q(container, 'event-create-end-date') as HTMLInputElement).value).toBe('');
		await fill(container, 'event-create-datetime-date', '2027-05-01');
		expect((q(container, 'event-create-end-date') as HTMLInputElement).value).toBe('2027-05-01');
	});
});

describe('#243 — duration_minutes is DERIVED, DST-safe (two independent UTC conversions)', () => {
	/** Standard standalone preamble: season + type + name. */
	async function standaloneReady(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Autumn camp');
	}

	it('October FALL-BACK camp: 2026-10-24 10:00 → 2026-10-25 15:00 = 1800 real minutes (naive wall-clock says 1740) — FULL wire shape, and NO end prop of any spelling', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-10-24', '10:00');
		await fill(container, 'event-create-end-date', '2026-10-25');
		await fillTime(container, 'event-create-end', '15:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		// 10:00 EEST (UTC+3) = 07:00Z; the clock falls back 04:00→03:00 on
		// 2026-10-25, so the span holds a 25-hour day: 30h elapsed = 1800 min.
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-10-24T07:00:00.000Z',
			durationMinutes: 1800
		});
		// The wire NEVER grows an end property under any name — duration is the
		// stored fact, end is a projection (settled on the issue).
		expect(Object.keys(lastCreateInput()).filter((k) => /end/i.test(k))).toEqual([]);
	});

	it('March SPRING-FORWARD camp: 2026-03-28 10:00 → 2026-03-29 15:00 = 1680 real minutes (naive says 1740)', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-03-28', '10:00');
		await fill(container, 'event-create-end-date', '2026-03-29');
		await fillTime(container, 'event-create-end', '15:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		// 10:00 EET (UTC+2) = 08:00Z; 03:00→04:00 skips an hour on 2026-03-29:
		// 29h wall-clock span = 28h elapsed = 1680 min.
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-03-28T08:00:00.000Z',
			durationMinutes: 1680
		});
	});

	it('the 25-HOUR DAY itself: 2026-10-25 00:00 → 2026-10-26 00:00 = 1500 min, exactly', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-10-25', '00:00');
		await fill(container, 'event-create-end-date', '2026-10-26');
		await fillTime(container, 'event-create-end', '00:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		// Midnight EEST 2026-10-25 = 2026-10-24T21:00Z; midnight EET 2026-10-26 =
		// 2026-10-25T22:00Z → 25h = 1500 min. A wall-clock subtraction says 1440.
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-10-24T21:00:00.000Z',
			durationMinutes: 1500
		});
	});

	it('a BLANK end time sends NO durationMinutes key at all — the optionality that carries series inheritance survives (full shape, phantom-key scan)', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		// Start fully set; the end DATE is mirrored, but no end TIME is picked —
		// exactly the "no own duration" state the old blank number input meant.
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z'
		});
		expect(Object.keys(lastCreateInput()).filter((k) => /end|duration/i.test(k))).toEqual([]);
	});
});

describe('#243 — an end at or before the start is refused BEFORE any write (Done-when 5)', () => {
	// Copy note (SPIKE-settled): the three existing end-before-start keys
	// (season_date_range_invalid / series_create_until_before_from /
	// event_convert_end_before_start) all speak of DATES and all sit behind a
	// strict `<` — they PERMIT equality. #243 rejects `end <= start` on
	// DATETIMES, so reusing any of them would tell a viewer who set end == start
	// that her end "cannot be before the start date" — an actively wrong
	// message. ONE new surface-neutral key, `event_end_before_start`, in the
	// same phrasing family (Done-when 5's "reuse that copy pattern"), shared by
	// the create form and the detail editor. No other new error keys.
	async function readySameDay(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Inverted event');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
	}

	it('end time EARLIER the same day: refused with event_end_before_start, createEvent never called, the end controls carry aria-invalid + aria-describedby', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '18:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
		// #207 review F2 — the wiring lives on the real controls, not the group.
		for (const testid of [
			'event-create-end-date',
			'event-create-end-hour',
			'event-create-end-minute'
		]) {
			const control = q(container, testid) as HTMLElement;
			expect(control.getAttribute('aria-invalid'), testid).toBe('true');
			expect(control.getAttribute('aria-describedby'), testid).toBe('event-create-error');
		}
	});

	it('end EQUAL to start: refused too — the rule is end <= start on DATETIMES, which is why the date-flavoured copy could not be reused', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('end DATE before the start date (a touched mirror the viewer then out-ran): refused, loud — never a silent fix-up of the end date', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fill(container, 'event-create-end-date', '2027-04-17');
		await fillTime(container, 'event-create-end', '20:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the refusal is not sticky: editing the end time clears it, and the corrected submit writes', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '18:00');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});

		await fillTime(container, 'event-create-end', '21:00');
		expect(q(container, 'event-create-error')).toBeNull();
		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().durationMinutes).toBe(120);
	});
});

describe('#243 — the end time honours the AM/PM preference (rule 5, shipped TimeSelect)', () => {
	it("'ampm': the end composite grows its -ampm select; 7:00 PM → 9:00 PM writes durationMinutes 120 on an unchanged wire", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			// The end composite is the SAME TimeSelect — the preference applies to
			// both ends automatically (Done-when 7), no hand-rolled second control.
			expect(q(container, 'event-create-end-ampm'), 'end TimeSelect in ampm mode').not.toBeNull();
			await fireEvent.change(q(container, 'event-create-end-hour') as HTMLElement, {
				target: { value: '9' }
			});
			await fireEvent.change(q(container, 'event-create-end-minute') as HTMLElement, {
				target: { value: '00' }
			});
			await fireEvent.change(q(container, 'event-create-end-ampm') as HTMLElement, {
				target: { value: 'PM' }
			});
			await submit(container);

			await waitFor(() => {
				expect(createEventMock).toHaveBeenCalledTimes(1);
			});
			expect(createEventMock).toHaveBeenCalledWith(CFG, {
				name: 'Spring concert',
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'concert',
				startDatetime: '2027-04-18T16:00:00.000Z',
				durationMinutes: 120
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});
});

// ── #243: the new keys exist in ALL FOUR locales (the render mock above hides
//    a missing key, so the message FILES are pinned directly — same guard
//    family as the #208 block) ─────────────────────────────────────────────────

describe('#243 — locale coverage for the start/end labels and the range error', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('event_create_start_label / event_create_end_label / event_end_before_start exist in en/et/lv/uk and are non-empty', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			for (const key of [
				'event_create_start_label',
				'event_create_end_label',
				'event_end_before_start'
			]) {
				const msg = messages(locale)[key];
				expect(msg, `${locale}.json is missing ${key}`).toBeDefined();
				expect(msg, `${locale}.json ${key} is empty`).toMatch(/\S/);
			}
		}
	});

	it('the detail editor’s field name follows the field: event_edit_duration_minutes_aria_label no longer says "Edit duration" (the KEY stays — a rename would break the derived-key a11y suite)', () => {
		// SPIKE-settled: the detail page keeps its sr-only/aria-label idiom
		// (Gama's visible-label addition names the CREATE form only), but the
		// editor it names is now the END composite — "Edit duration" would label
		// a control that asks for a date and a time. Copy is Comenius's; this
		// only pins that the OLD wording is gone in the two ruled locales.
		expect(messages('en')['event_edit_duration_minutes_aria_label']).not.toBe('Edit duration');
		expect(messages('et')['event_edit_duration_minutes_aria_label']).not.toBe('Muuda kestust');
	});

	it('event_end_before_start is its OWN copy, not a byte-copy of the date-flavoured keys it deliberately does not reuse', () => {
		// The predicate differs (datetimes, equality rejected) — a pasted date
		// message would be wrong for end == start. Same phrasing FAMILY is fine;
		// identical bytes to a date key is the copy-paste this guards against.
		for (const locale of ['en', 'et']) {
			const msgs = messages(locale);
			expect(msgs['event_end_before_start']).not.toBe(msgs['season_date_range_invalid']);
			expect(msgs['event_end_before_start']).not.toBe(msgs['series_create_until_before_from']);
			expect(msgs['event_end_before_start']).not.toBe(msgs['event_convert_end_before_start']);
		}
	});
});

// (*MVOX:Tallis* — #243 RED: end date+time pair replaces the duration input;
// visible start/end labels (#239 idiom, Gama's binding addition); same-day
// mirror; DST-safe two-endpoint derivation with exact fall-back/spring-forward
// minutes; end<=start refusal on one new shared key; blank end = inheritance
// preserved; wire discipline — no end prop of any spelling)

// ── #249 — visible labels on every event-create field (label parity with #239) ──
//
// The event-create form has the same defect #239 just fixed on the series
// form: SEVEN controls a user must identify with no visible name — season,
// series, name, capacity, location, description, conductor. The three selects
// are the sharpest cases (no placeholder to fall back on): the exact failure
// Joosep reported on the series form's time selects ("Ma eeldan, et siin on
// kellaaeg…"), sitting unfixed on the commoner form.
//
// Naming contract (the #205 review F1 trap, generalized — same as the #239
// block in page.series-create.spec.ts): when a control gains a visible label
// the old aria-label GOES — two authored names on one control drift apart.
// These tests assert the COMPUTED accessible name (accname precedence:
// aria-labelledby > aria-label > associated <label>), not aria-label
// truthiness, AND that no aria-label remains on the control. Placeholders may
// stay (rule 4 — descriptive, #208's ruling) but are deliberately NOT
// consulted by the computation: a control whose only name is its placeholder
// computes '' here, which is exactly the bug.
//
// Folded in per Gama's scope note on the #242 verification: event-create-type
// carried BOTH its visible label AND a same-key aria-label (the #205 F1
// double-naming shape, predating #242) — no existing test forced its removal,
// so the null pin is authored here.
describe('#249 — every event-create control carries a visible label that IS its accessible name', () => {
	/** The visible label element that names `el`: a `label[for]` match when the
	 *  control has an id, else a wrapping <label> ancestor. */
	function labelElementOf(container: HTMLElement, el: HTMLElement): HTMLLabelElement | null {
		const id = el.getAttribute('id');
		if (id) {
			const forLabel = container.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
			if (forLabel) return forLabel;
		}
		return el.closest('label');
	}

	/** A label's naming text: its subtree text MINUS any embedded controls (a
	 *  wrapping label names the control with its OTHER text, never the
	 *  control's own options/value — the accname embedded-control rule). */
	function labelText(label: HTMLElement): string {
		const clone = label.cloneNode(true) as HTMLElement;
		for (const embedded of clone.querySelectorAll('input, select, textarea')) embedded.remove();
		return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	}

	/** The slice of the accname algorithm these pins need, in precedence order:
	 *  aria-labelledby > aria-label > associated <label>. NO placeholder step. */
	function computedName(container: HTMLElement, el: HTMLElement): string {
		const labelledby = el.getAttribute('aria-labelledby');
		if (labelledby) {
			return labelledby
				.split(/\s+/)
				.map((id) => container.querySelector(`[id="${id}"]`)?.textContent?.trim() ?? '')
				.join(' ')
				.trim();
		}
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel !== null) return ariaLabel.trim();
		const label = labelElementOf(container, el);
		return label ? labelText(label) : '';
	}

	/** Visible = actually on screen for Joosep: rendered text, not hidden away. */
	function expectVisibleText(el: HTMLElement, what: string): void {
		expect(el.hasAttribute('hidden'), `${what} must not be [hidden]`).toBe(false);
		expect(el.getAttribute('aria-hidden'), `${what} must not be aria-hidden`).not.toBe('true');
		expect(
			Array.from(el.classList),
			`${what} must be visibly rendered, not screen-reader-only`
		).not.toContain('sr-only');
	}

	// The seven aria-only controls, each paired with the label key it ALREADY
	// owns (all four locales carry translated values — currently consumed only
	// via aria-label/placeholder; #249 renders them, zero new copy).
	const FIELD_LABEL_KEYS: ReadonlyArray<readonly [testid: string, key: string]> = [
		['event-create-season', 'event_create_season_label'],
		['event-create-series', 'event_create_series_label'],
		['event-create-name', 'event_create_name_label'],
		['event-create-capacity', 'event_create_capacity_label'],
		['event-create-location', 'event_create_location_label'],
		['event-create-description', 'event_create_description_label'],
		['event-create-conductor-select', 'event_create_conductor_label']
	];

	async function openReadyForm(): Promise<HTMLElement> {
		const container = await renderReady();
		await openFormFromPanel(container);
		return container;
	}

	it('all seven aria-only controls: a visible <label> (for= or wrapping) computes as the accessible name, and the old aria-label is GONE — never a placeholder as the only name', async () => {
		const container = await openReadyForm();

		for (const [testid, key] of FIELD_LABEL_KEYS) {
			const control = q(container, testid) as HTMLElement;
			expect(control, testid).not.toBeNull();

			// No double-authoring: the name must COME FROM the label element.
			expect(
				control.getAttribute('aria-label'),
				`${testid}: aria-label must be dropped once the visible label names it`
			).toBeNull();

			const label = labelElementOf(container, control);
			expect(label, `${testid}: needs a label[for] or wrapping <label>`).not.toBeNull();
			expectVisibleText(label as HTMLElement, `${testid}'s label`);

			// The lenient message mock renders every key as its own name, so the
			// EXISTING i18n key is pinned as the label text — no new copy.
			expect(
				computedName(container, control),
				`${testid}: computed accessible name must be the visible label's text`
			).toBe(key);
		}
	});

	it("event-create-type sheds its redundant aria-label (the #205 F1 double-naming shape, Gama's scope note on #242): the visible label STAYS and is the only authored name", async () => {
		const container = await openReadyForm();

		const type = q(container, 'event-create-type') as HTMLSelectElement;
		expect(type).not.toBeNull();
		expect(
			type.getAttribute('aria-label'),
			'the wrapping label already names the select — the same-key aria-label is redundant'
		).toBeNull();

		// The visible half is UNCHANGED (page.event-type-picker.spec.ts owns its
		// full contract) — re-pinned here so the aria-label removal cannot be
		// "satisfied" by deleting the visible label instead.
		const caption = q(container, 'event-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('event_create_type_label');
		expectVisibleText(caption, "event-create-type's label");
		expect(type.closest('label')).toBe(caption.closest('label'));
		expect(computedName(container, type)).toBe('event_create_type_label');
	});

	it('the already-labeled start/end groups are UNTOUCHED: still named by their visible spans via aria-labelledby, still no aria-label (done-when 7)', async () => {
		const container = await openReadyForm();

		for (const [testid, key] of [
			['event-create-datetime', 'event_create_start_label'],
			['event-create-end', 'event_create_end_label']
		] as const) {
			const group = q(container, testid) as HTMLElement;
			expect(group, testid).not.toBeNull();
			expect(group.getAttribute('role'), testid).toBe('group');
			expect(group.getAttribute('aria-label'), `${testid}: #205 F1 trap stays fixed`).toBeNull();
			expect(computedName(container, group), testid).toBe(key);
		}
	});

	it('labels are ADDITIVE (rule 4): every placeholder/prompt survives exactly as it was', async () => {
		const container = await openReadyForm();

		// Text-entry placeholders: the label says WHAT the field is, the
		// placeholder shows an example — both render, on the same keys as before.
		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-capacity') as HTMLInputElement).placeholder).toBe(
			'event_create_capacity_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);

		// Selects: the ''-valued prompt options keep doing their in-list work.
		const season = q(container, 'event-create-season') as HTMLSelectElement;
		expect(season.querySelector('option[value=""]')?.textContent?.trim()).toBe(
			'event_create_season_placeholder'
		);
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		expect(series.querySelector('option[value=""]')?.textContent?.trim()).toBe(
			'event_create_series_none'
		);
		const conductors = conductorSelect(container);
		expect(promptOption(conductors).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
	});

	it("#248's location datalist wiring is untouched: the location input keeps list= resolving to a real <datalist>, INSIDE its new label", async () => {
		const container = await openReadyForm();

		const location = q(container, 'event-create-location') as HTMLInputElement;
		const listId = location.getAttribute('list');
		expect(listId, 'the location input must keep its list= attribute').toBeTruthy();
		expect(
			document.querySelector(`datalist[id="${listId}"]`),
			`<datalist id="${listId}"> must still exist in the page`
		).not.toBeNull();
	});

	it('NO fieldsets/legends: grouping is explicitly deferred (done-when 5) — labels ship alone', async () => {
		const container = await openReadyForm();

		const form = q(container, 'event-create-form') as HTMLElement;
		expect(form).not.toBeNull();
		expect(
			form.querySelectorAll('fieldset').length,
			"#239's four legends must NOT be copied across mechanically"
		).toBe(0);
		expect(form.querySelectorAll('legend').length).toBe(0);
	});
});

// (*MVOX:Tallis* — #249 RED: visible label on every event-create field in the
// #239 idiom — seven aria-only controls gain a wrapping visible <label> whose
// text IS the computed accessible name, eight aria-label null pins (the seven
// + event-create-type's #205-F1 redundancy per Gama's scope note), the :766
// conductor aria-label pin deliberately flipped, placeholders/datalist/groups
// pinned untouched, fieldset grouping pinned ABSENT per done-when 5)
