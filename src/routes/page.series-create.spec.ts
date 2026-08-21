// @vitest-environment happy-dom
//
// #132/T5 RED — EVENT SERIES creation + the bulk occurrence generator, on the
// ACTUAL agenda route (integration: real +page.svelte, real season-manage
// panel, real generateEventDates; only the DATA seams are mocked — same
// harness family as page.event-create.spec.ts / page.season-manage.spec.ts).
// $lib/events/recurrence is deliberately NOT mocked: the live preview below IS
// the integration test that the page calls the real calculator.
//
// WHY (#132): T1 gave us `createEventSeries` + `createEvent`, T3 gave the
// panel its [+ Series] stub. T5 wires the stub into an inline form (design
// sketch D): the series template fields, a recurrence schedule, a LIVE
// preview of the occurrences it would generate, and a serial bulk-create of
// those occurrences on submit.
//
// RECONCILING THE SKETCH WITH THE WIRE (pinned here, GREEN must follow):
// v4E marks `event_type`, `interval_days`, `start_time`, `start_date`,
// `end_date`, `duration_minutes` REQUIRED on event_series, and T1's
// `createEventSeries` enforces exactly that — so the sketch's "optional
// recurrence section" cannot mean those fields are omittable. The schedule
// fields are therefore ALWAYS collected (they ARE the series template), and
// the genuinely optional thing is GENERATION: the `series-create-generate`
// checkbox (default OFF). OFF → submit creates the series ONLY. ON → submit
// creates the series, then POSTs each generated occurrence individually, in
// SERIAL, ascending. Because the sketch lists no event-type field but the
// wire requires one, `series-create-type` is a text input PRE-FILLED
// 'rehearsal' (the workflow's own default for generated occurrences).
//
// Pinned wiring contract:
//
//   DATA
//     - series submit calls `createEventSeries(cfg, input)` (T1) — the ONE
//       series-create seam. orgId from `resolveDatabaseEntityId(cfg, personId)`; the
//       panel's season id rides in `extraParentIds: [seasonId]`. NO `_sharing`
//       / inherit-rights anywhere in the UI layer (the #132 design decision —
//       the create body is entirely T1's business).
//     - repeat → intervalDays mapping: daily → 1, weekly → 7, biweekly → 14.
//     - startDate/endDate are the FIRST and LAST OCCURRENCE (entityCreate.ts's
//       own contract for the two fields). With generation ON that is
//       `generateEventDates`' first/last date — NOT the from/until search
//       range: the weekday is not stored on the series (only interval_days +
//       start_time), so start_date is the only place a later reader can recover
//       which day the cadence lands on, and a Monday series stamped with a
//       Tuesday `from` describes a schedule it never had (review F1). With
//       generation OFF nothing better than the operator's range exists, so
//       from/until go through verbatim. startTime = the time field;
//       durationMinutes = the duration field. Blank optional
//       location/description → the input carries NO value for them (T1 drops
//       blanks; the page must not invent '').
//     - bulk generation (generate ON): after `createEventSeries` resolves,
//       ONE `createEvent(cfg, input)` per date from the REAL
//       `generateEventDates`, IN ASCENDING ORDER, STRICTLY SERIAL (never two
//       in flight — Entu rate/ordering). Each occurrence sets ONLY:
//       orgId, seriesId (the id the series create just resolved),
//       extraParentIds: [seasonId], eventType, startDatetime. Name /
//       duration / location / description are NOT set — they inherit from
//       the series via the read-side merge (listRehearsals/loadEventDetail).
//     - startDatetime per occurrence: the generated calendar date at the
//       form's time, TALLINN wall clock → UTC instant (the TE.4 convention
//       T4 pinned: 19:00 EEST = 16:00Z before the 2026-10-25 fall-back,
//       19:00 EET = 17:00Z after).
//     - validation runs BEFORE ANY write — a refused submit must not leave a
//       half-made series behind.
//     - series-only success → form closes, the panel STAYS OPEN, and the
//       panel's series list re-reads (the new series must appear).
//     - bulk success → form closes, panel series list re-reads AND
//       `loadFullAgenda` re-invokes (the generated occurrences must land on
//       the agenda).
//     - bulk partial failure: creation STOPS at the first failed occurrence
//       (no further createEvent calls), `series-create-error` reports it with
//       counts (params `created` / `total`), the form stays OPEN. Events
//       1..N-1 are not rolled back — nothing here may DELETE.
//     - progress: while the bulk loop runs, `series-create-progress`
//       (role="status") announces the position (params `current` / `total`).
//
//   TESTIDS
//     season-manage-add-series    T3's stub button INSIDE the panel — T5 makes
//                                 it open the form. Rights-gated by the panel
//                                 itself (no gear for non-editors, fail-closed).
//     series-create-form          the inline form (same route — no goto)
//     series-create-name          text input — the series/template name
//     series-create-type          event_type text input, PRE-FILLED 'rehearsal'
//     series-create-duration      number input (minutes)
//     series-create-location      text input → defaultLocation (optional)
//     series-create-description   TEXTAREA → defaultDescription (optional)
//     series-create-repeat        <select> weekly | biweekly | daily, in that
//                                 order, 'weekly' pre-selected (no '' option —
//                                 the wire needs an interval either way)
//     series-create-day           <select> '' placeholder + '0'..'6' (JS
//                                 getDay: 0 = Sunday … 6 = Saturday)
//     series-create-time          <input type="time"> → start_time
//     series-create-from          <input type="date">, PRE-FILLED with the
//                                 panel season's start date
//     series-create-until         <input type="date">, PRE-FILLED with the
//                                 panel season's end date
//     series-create-generate      checkbox, UNCHECKED by default — ON enables
//                                 the preview + the bulk generator
//     series-create-skip-date     <input type="date"> — the skip picker
//     series-create-skip-add      adds the picked date to the skip set
//     series-create-skip-<date>   one chip per skipped date
//     series-create-skip-remove-<date>  the chip's remove button
//     series-create-preview       the live preview container — renders IFF
//                                 generate is ON and day/time/from/until are
//                                 all set; updates as params change ($derived)
//     series-create-preview-date-<YYYY-MM-DD>  one row per generated date
//     series-create-progress      role="status" — bulk progress indicator
//     series-create-submit        fires the write(s)
//     series-create-cancel        closes the form; nothing written
//     series-create-error         inline error, role="alert" (validation
//                                 refusal OR write failure)
//
//   MESSAGE KEYS (Comenius supplies copy; param NAMES are pinned here)
//     series_create_name_required / series_create_time_required /
//     series_create_duration_required / series_create_day_required
//     series_create_progress {current, total}
//     series_create_bulk_failed {created, total}
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// Params (progress/failure counts) are surfaced as JSON so their NAMES and
// VALUES are assertable without pinning any human wording.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	createEventSeriesMock,
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
	listEventTypesMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createEventSeriesMock: vi.fn(),
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
	listEventTypesMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// T1's write layer — the ONLY create seams this page may use. NOTE:
// $lib/events/recurrence is NOT in this mock list — on purpose (see header).
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: createEventSeriesMock,
	createEvent: createEventMock
}));
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
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
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
import type { Season } from '$lib/seasons/types';
import type { CreateEventInput, CreateEventSeriesInput } from '$lib/entity/entityCreate';
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
const NEW_SERIES_ID = 'series-new-1';

/** ISO calendar date `offsetDays` from now — keeps the gating fixtures
 *  time-bomb-free (the panel needs a season that is CURRENT at run time). The
 *  recurrence cases below then SET from/until to fixed 2026 dates explicitly,
 *  so the generated occurrences stay deterministic. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function agendaResult(opts: { editor?: boolean } = {}) {
	const { editor = true } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

/** The panel's existing lists (T3 shapes) — present so the panel renders. */
function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

/** Lets anything already queued — a late reply or a stray next write that
 *  WOULD have landed — run before asserting that it did not. */
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
	loadRosterMock.mockResolvedValue([]);
	createEventSeriesMock.mockResolvedValue(NEW_SERIES_ID);
	createEventMock.mockImplementation(async () => `ev-new-${createEventMock.mock.calls.length}`);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue(seriesFixture());
	listEventsForSeasonMock.mockResolvedValue(standaloneFixture());
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(null);
	listEventTypesMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createEventSeriesMock.mockReset();
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

/** Open the season-manage panel (T3's gear), then the [+ Series] form. */
async function openSeriesForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
}

/** The minimum a VALID series-only submit needs beyond the prefills: name,
 *  duration, time — plus fixed from/until so recurrence math is deterministic. */
async function fillValidTemplate(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fill(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
}

/** Turn generation ON, Mondays. With fillValidTemplate's range that yields
 *  exactly 3 occurrences: Sep 7, Sep 14, Sep 21 (all EEST, +3). */
async function enableMondayGeneration(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
	await selectValue(container, 'series-create-day', '1');
}

function previewDates(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="series-create-preview-date-"]')].map(
		(el) => el.getAttribute('data-testid')?.replace('series-create-preview-date-', '') ?? ''
	);
}

/** The input object the page handed createEventSeries on its most recent call. */
function lastSeriesInput(): CreateEventSeriesInput {
	const calls = createEventSeriesMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventSeriesInput;
}

function eventInput(callIndex: number): CreateEventInput {
	expect(createEventMock.mock.calls.length).toBeGreaterThan(callIndex);
	return createEventMock.mock.calls[callIndex][1] as CreateEventInput;
}

// ── the entry point: T3's [+ Series] stub becomes a live form ───────────────────

describe('season panel — the [+ Series] entry point', () => {
	it('season editor: clicking season-manage-add-series opens series-create-form INLINE (no goto); merely opening writes nothing and shows no preview', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-preview')).toBeNull();

		const generate = q(container, 'series-create-generate') as HTMLInputElement;
		expect(generate).not.toBeNull();
		expect(generate.checked).toBe(false);
	});

	it('NON-editor: no season-manage-gear at all — the panel (and with it the form) is unreachable, fail-closed like every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		await flush();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'series-create-form')).toBeNull();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Doomed draft');

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

// ── the form's fields (design sketch D) ─────────────────────────────────────────

describe('season panel — the series form carries every sketch-D field', () => {
	it('name (text), type (text, PRE-FILLED rehearsal), duration (number), location (text), description (TEXTAREA), repeat/day (selects), time, from/until (dates), generate (checkbox), skip picker', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const name = q(container, 'series-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.tagName).toBe('INPUT');

		const type = q(container, 'series-create-type') as HTMLInputElement;
		expect(type).not.toBeNull();
		expect(type.value).toBe('rehearsal');

		const duration = q(container, 'series-create-duration') as HTMLInputElement;
		expect(duration.type).toBe('number');

		const location = q(container, 'series-create-location') as HTMLInputElement;
		expect(location.tagName).toBe('INPUT');

		const description = q(container, 'series-create-description') as HTMLElement;
		expect(description.tagName).toBe('TEXTAREA');

		const repeat = q(container, 'series-create-repeat') as HTMLSelectElement;
		expect(repeat.tagName).toBe('SELECT');
		expect([...repeat.querySelectorAll('option')].map((o) => o.value)).toEqual([
			'weekly',
			'biweekly',
			'daily'
		]);
		expect(repeat.value).toBe('weekly');

		const day = q(container, 'series-create-day') as HTMLSelectElement;
		expect(day.tagName).toBe('SELECT');
		expect([...day.querySelectorAll('option')].map((o) => o.value)).toEqual([
			'',
			'0',
			'1',
			'2',
			'3',
			'4',
			'5',
			'6'
		]);
		expect(day.value).toBe('');

		expect((q(container, 'series-create-time') as HTMLInputElement).type).toBe('time');
		expect((q(container, 'series-create-from') as HTMLInputElement).type).toBe('date');
		expect((q(container, 'series-create-until') as HTMLInputElement).type).toBe('date');
		expect((q(container, 'series-create-generate') as HTMLInputElement).type).toBe('checkbox');
		expect((q(container, 'series-create-skip-date') as HTMLInputElement).type).toBe('date');
		expect(q(container, 'series-create-skip-add')).not.toBeNull();
	});

	it('from/until default to the SEASON dates — the sketch-D pin — so a fresh form already spans the season', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expect((q(container, 'series-create-from') as HTMLInputElement).value).toBe(SEASON_START);
		expect((q(container, 'series-create-until') as HTMLInputElement).value).toBe(SEASON_END);
	});
});

// ── the live preview: the REAL generateEventDates, on the real page ─────────────

describe('season panel — the recurrence preview is live and real', () => {
	it('generate ON + day/time/from/until set → series-create-preview lists EXACTLY the generated dates (real generateEventDates: 13 Mondays for Sep 1 – Dec 1 2026) — and previewing writes NOTHING', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(previewDates(container)).toEqual([
			'2026-09-07',
			'2026-09-14',
			'2026-09-21',
			'2026-09-28',
			'2026-10-05',
			'2026-10-12',
			'2026-10-19',
			'2026-10-26',
			'2026-11-02',
			'2026-11-09',
			'2026-11-16',
			'2026-11-23',
			'2026-11-30'
		]);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the preview UPDATES LIVE as params change: shortening until 2026-12-01 → 2026-09-30 shrinks 13 Mondays to 4', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(13);
		});

		await fill(container, 'series-create-until', '2026-09-30');

		await waitFor(() => {
			expect(previewDates(container)).toEqual([
				'2026-09-07',
				'2026-09-14',
				'2026-09-21',
				'2026-09-28'
			]);
		});
	});

	it('adding a SKIP date chips it and drops it from the preview; removing the chip restores it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(4);
		});

		await fill(container, 'series-create-skip-date', '2026-09-14');
		await fireEvent.click(q(container, 'series-create-skip-add') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'series-create-skip-2026-09-14')).not.toBeNull();
		});
		expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-21', '2026-09-28']);

		await fireEvent.click(q(container, 'series-create-skip-remove-2026-09-14') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-skip-2026-09-14')).toBeNull();
		});
		expect(previewDates(container)).toHaveLength(4);
	});

	it('generate OFF → no preview, even with a complete recurrence; toggling it ON brings the preview up, OFF takes it down', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');
		await selectValue(container, 'series-create-day', '1');
		await flush();
		expect(q(container, 'series-create-preview')).toBeNull();

		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-preview')).toBeNull();
		});
	});

	it('generate ON but recurrence INCOMPLETE (no day picked): no preview yet', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-30');
		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);

		await flush();
		expect(q(container, 'series-create-preview')).toBeNull();
	});
});

// ── series-only submit (generate OFF) ───────────────────────────────────────────

describe('season panel — submit WITHOUT generation creates the series only', () => {
	it('full flow: createEventSeries(cfg, {…}) ONCE, FULL shape — org from resolveDatabaseEntityId, season in extraParentIds, weekly → intervalDays 7, from/until verbatim as startDate/endDate — and NO createEvent; form closes, panel stays open, series list re-reads', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;

		await fillValidTemplate(container);
		await fill(container, 'series-create-location', 'Main hall');
		await fill(container, 'series-create-description', 'Bring the black folder');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		// FULL param shape (partial assertions hide bugs).
		expect(createEventSeriesMock).toHaveBeenCalledWith(CFG, {
			name: 'Monday rehearsals',
			orgId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			intervalDays: 7,
			startTime: '19:00',
			durationMinutes: 90,
			startDate: '2026-09-01',
			endDate: '2026-09-21',
			defaultLocation: 'Main hall',
			defaultDescription: 'Bring the black folder'
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);
		expect(createEventMock).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
	});

	it('untouched optional location/description arrive BLANK/ABSENT — never an invented "" that would shadow inheritance downstream', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		const input = lastSeriesInput();
		expect(input.defaultLocation ?? '').toBe('');
		expect(input.defaultDescription ?? '').toBe('');
	});

	it('the repeat select maps to intervalDays: biweekly → 14', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await selectValue(container, 'series-create-repeat', 'biweekly');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().intervalDays).toBe(14);
	});

	it('…and daily → 1', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await selectValue(container, 'series-create-repeat', 'daily');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().intervalDays).toBe(1);
	});

	it('a FAILED series write: series-create-error (role="alert"), the form stays OPEN with the work still in it, nothing generated', async () => {
		createEventSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'series-create-form')).not.toBeNull();
		expect((q(container, 'series-create-name') as HTMLInputElement).value).toBe(
			'Monday rehearsals'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

// ── bulk submit (generate ON): series first, then one event per date, serial ────

describe('season panel — submit WITH generation bulk-creates the occurrences', () => {
	it('creates the series FIRST, then ONE createEvent per generated date, ascending: each occurrence sets ONLY org/series/season parents + eventType + startDatetime (Tallinn wall clock → UTC instant); name/duration/location/description INHERIT — never copied', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-location', 'Main hall');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		// The series create resolved BEFORE the first occurrence went out — the
		// occurrences need its id as their parent.
		expect(createEventSeriesMock.mock.invocationCallOrder[0]).toBeLessThan(
			createEventMock.mock.invocationCallOrder[0]
		);

		// 19:00 Europe/Tallinn in September 2026 is EEST (UTC+3) → 16:00Z — the
		// same TE.4 wall-clock convention T4 pinned for single-event creates.
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-09-07T16:00:00.000Z', '2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']
		);
		for (let i = 0; i < 3; i += 1) {
			expect(createEventMock.mock.calls[i][0]).toEqual(CFG);
			const input = eventInput(i);
			expect(input.orgId).toBe(ORG_EFK);
			expect(input.seriesId).toBe(NEW_SERIES_ID);
			expect(input.extraParentIds).toEqual([SEASON_ID]);
			expect(input.eventType).toBe('rehearsal');
			// The inheritable quartet arrives BLANK/ABSENT — the series supplies
			// them at read time; a frozen copy would defeat the inheritance the
			// generator exists for ('' is fine: T1 drops blanks).
			expect(input.name ?? '').toBe('');
			expect(input.durationMinutes ?? undefined).toBeUndefined();
			expect(input.location ?? '').toBe('');
			expect(input.description ?? '').toBe('');
			expect(input.conductorRefs ?? []).toEqual([]);
			expect(input.capacity ?? undefined).toBeUndefined();
		}
	});

	it('review F1 — the series carries the FIRST and LAST OCCURRENCE as startDate/endDate, not the search range: Mondays over Tue 2026-09-01 → 2026-09-21 persist 2026-09-07 / 2026-09-21', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		// FULL param shape (partial assertions hide bugs).
		expect(createEventSeriesMock).toHaveBeenCalledWith(CFG, {
			name: 'Monday rehearsals',
			orgId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			intervalDays: 7,
			startTime: '19:00',
			durationMinutes: 90,
			// 2026-09-01 is a TUESDAY — a Monday series must never claim it as its
			// first occurrence. The weekday is recoverable from nothing else on the
			// series (interval_days + start_time carry no day).
			startDate: '2026-09-07',
			endDate: '2026-09-21'
		});
	});

	it('…and a SKIPPED first/last occurrence moves the bounds with it — the stored range is what was actually created', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await fill(container, 'series-create-skip-date', '2026-09-07');
		await fireEvent.click(q(container, 'series-create-skip-add') as HTMLElement);
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().startDate).toBe('2026-09-14');
		expect(lastSeriesInput().endDate).toBe('2026-09-21');
	});

	it('the bulk loop is STRICTLY SERIAL — never two createEvent calls in flight (Entu rate/ordering)', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		createEventMock.mockImplementation(async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 0));
			inFlight -= 1;
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(3);
		expect(maxInFlight).toBe(1);
	});

	it('the occurrences honour the SKIP set: skipping 2026-09-14 creates 2 events, not 3', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await fill(container, 'series-create-skip-date', '2026-09-14');
		await fireEvent.click(q(container, 'series-create-skip-add') as HTMLElement);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(2);
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-09-07T16:00:00.000Z', '2026-09-21T16:00:00.000Z']
		);
	});

	it('the Tallinn wall clock holds ACROSS the DST fall-back (2026-10-25): 19:00 local is 16:00Z before and 17:00Z after — never a fixed UTC offset', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-from', '2026-10-19');
		await fill(container, 'series-create-until', '2026-11-02');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-10-19T16:00:00.000Z', '2026-10-26T17:00:00.000Z', '2026-11-02T17:00:00.000Z']
		);
	});

	it('bulk success: form closes, the panel STAYS OPEN, its series list re-reads (the new series + counts must appear) and the agenda refreshes (the occurrences must land on it)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});
});

// ── progress + partial failure ──────────────────────────────────────────────────

describe('season panel — bulk creation reports progress and survives partial failure', () => {
	it('series-create-progress (role="status") tracks the loop: current 1 of 3 while the first POST is in flight, advancing as each resolves, gone when the run completes', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		const progress = q(container, 'series-create-progress') as HTMLElement;
		expect(progress).not.toBeNull();
		expect(progress.getAttribute('role')).toBe('status');
		expect(progress.textContent).toContain('series_create_progress');
		expect(progress.textContent).toContain('"current":1');
		expect(progress.textContent).toContain('"total":3');

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		expect(q(container, 'series-create-progress')?.textContent).toContain('"current":2');

		resolvers[1]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(3);
		});
		resolvers[2]('ev-new-3');

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'series-create-progress')).toBeNull();
	});

	it('PARTIAL FAILURE: occurrence 2 of 3 fails → the loop STOPS (no 3rd POST), series-create-error (role="alert") reports created=1 / total=3, and the form stays OPEN; nothing is rolled back', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		await flush();
		// Stopped AT the failure — the 3rd occurrence was never attempted.
		expect(createEventMock).toHaveBeenCalledTimes(2);
		const error = q(container, 'series-create-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('series_create_bulk_failed');
		expect(error.textContent).toContain('"created":1');
		expect(error.textContent).toContain('"total":3');
		expect(q(container, 'series-create-form')).not.toBeNull();
		// The series itself was created and STAYS created — no rollback delete
		// exists in this app, and re-submitting is the operator's call.
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
	});
});

// ── validation: refused BEFORE any write ────────────────────────────────────────

describe('season panel — series create REFUSES an incomplete form before it writes', () => {
	it('blank NAME: series-create-error names it, createEventSeries never runs, the form stays open', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fill(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		const error = q(container, 'series-create-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent?.trim()).toBe('series_create_name_required');
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-form')).not.toBeNull();
	});

	it('review F2 — a CLEARED type is refused, never silently defaulted back to "rehearsal": event_type is the discriminator the agenda filters on, so a wrong one is invisible until the agenda is wrong', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-type', '   ');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_type_required'
		);
		expect(resolveDatabaseEntityIdMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-form')).not.toBeNull();
	});

	it('…and a type the viewer TYPED rides through verbatim onto the series and every generated occurrence', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-type', 'concert');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});
		expect(lastSeriesInput().eventType).toBe('concert');
		for (let i = 0; i < 3; i += 1) {
			expect(eventInput(i).eventType).toBe('concert');
		}
	});

	it('review F4 — a refusal is wired to ITS OWN box: aria-invalid + aria-describedby point at the error, and only that field carries them', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fill(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.getAttribute('id')).toBe('series-create-error');
		const name = q(container, 'series-create-name') as HTMLInputElement;
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(name.getAttribute('aria-describedby')).toBe('series-create-error');
		// The boxes that were NOT refused stay clean — one message, one owner.
		for (const testid of ['series-create-type', 'series-create-duration', 'series-create-time']) {
			const el = q(container, testid) as HTMLElement;
			expect(el.getAttribute('aria-invalid')).toBeNull();
			expect(el.getAttribute('aria-describedby')).toBeNull();
		}

		// Editing the refused field clears both the message and its wiring.
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await waitFor(() => {
			expect(q(container, 'series-create-error')).toBeNull();
		});
		expect(
			(q(container, 'series-create-name') as HTMLInputElement).getAttribute('aria-invalid')
		).toBeNull();
	});

	it('…and a range refusal hands the wiring to the UNTIL box instead', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '2026-08-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		const until = q(container, 'series-create-until') as HTMLInputElement;
		expect(until.getAttribute('aria-invalid')).toBe('true');
		expect(until.getAttribute('aria-describedby')).toBe('series-create-error');
		expect(
			(q(container, 'series-create-name') as HTMLInputElement).getAttribute('aria-invalid')
		).toBeNull();
	});

	it('blank TIME: refused with the TIME message — v4E start_time is required and T1 would throw anyway; the page says WHICH field first', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await fill(container, 'series-create-duration', '90');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_time_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('blank DURATION: refused with the DURATION message', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await fill(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_duration_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('generate ON but NO day picked: refused with the DAY message and NO write at all — otherwise a refused form leaves a half-made series behind', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_day_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the refusal is not sticky: filling the named field and re-submitting writes', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fill(container, 'series-create-time', '19:00');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		await fill(container, 'series-create-name', 'Monday rehearsals');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
	});
});

// ── review fixes (#132/T5 YELLOW) ───────────────────────────────────────────────
//
// Five defects Bentham's review found in the GREEN implementation, each pinned
// here so it cannot come back:
//   1. daily + generate was unreachable — the day requirement gated a field
//      `generateEventDates` ignores for 'daily'.
//   2. a stopped bulk run offered only a full re-submit, duplicating the series
//      and every occurrence that had already landed.
//   3. from/until were never validated client-side — a blank/inverted range
//      reached the wire and came back as the generic "try again".
//   4. cancel/Escape mid-run unmounted the form while the loop kept POSTing.
//   5. the preview had no count and an empty occurrence set closed the form as
//      a silent success.

describe('season panel — DAILY generation needs no day of week', () => {
	it('daily HIDES the inert day select and previews immediately: generateEventDates ignores dayOfWeek for daily, so demanding one would gate generation behind a field with no effect', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-04');
		await selectValue(container, 'series-create-repeat', 'daily');
		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(q(container, 'series-create-day')).toBeNull();
		expect(previewDates(container)).toEqual([
			'2026-09-01',
			'2026-09-02',
			'2026-09-03',
			'2026-09-04'
		]);
	});

	it('…and submits without a day: one occurrence per calendar day, no day_required refusal', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Festival week');
		await fill(container, 'series-create-duration', '90');
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-04');
		await selectValue(container, 'series-create-repeat', 'daily');
		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'series-create-error')).toBeNull();
		expect(lastSeriesInput().intervalDays).toBe(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			[
				'2026-09-01T16:00:00.000Z',
				'2026-09-02T16:00:00.000Z',
				'2026-09-03T16:00:00.000Z',
				'2026-09-04T16:00:00.000Z'
			]
		);
	});

	it('a day-using pattern still demands one — switching back to weekly restores the select and the refusal', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await selectValue(container, 'series-create-repeat', 'daily');
		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
		await selectValue(container, 'series-create-repeat', 'weekly');

		await waitFor(() => {
			expect(q(container, 'series-create-day')).not.toBeNull();
		});
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_day_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});
});

describe('season panel — the date range is validated BEFORE any fetch', () => {
	it('blank FROM: named refusal, no org round-trip, no write', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-from', '');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_from_required'
		);
		expect(resolveDatabaseEntityIdMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('blank UNTIL: named refusal, no write', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_until_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('UNTIL before FROM: named refusal — never the generic "try again" that retrying cannot fix', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '2026-08-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_until_before_from'
		);
		expect(resolveDatabaseEntityIdMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});
});

describe('season panel — the preview counts, scrolls, and refuses an empty set', () => {
	it('states how many events will be created (plural), and the singular form when exactly one', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-12-01');
		await enableMondayGeneration(container);

		await waitFor(() => {
			expect(q(container, 'series-create-preview-count')).not.toBeNull();
		});
		const count = q(container, 'series-create-preview-count') as HTMLElement;
		expect(count.textContent).toContain('series_create_preview_count_other');
		expect(count.textContent).toContain('"count":13');

		await fill(container, 'series-create-until', '2026-09-07');
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07']);
		});
		expect(q(container, 'series-create-preview-count')?.textContent?.trim()).toBe(
			'series_create_preview_count_one'
		);
	});

	it('a recurrence that yields NOTHING (Mondays over a Tue–Sun range) is REFUSED before the series is written — never a silent success with a childless series behind it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Impossible Mondays');
		await fill(container, 'series-create-duration', '90');
		await fill(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-06');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_no_dates'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
});

describe('season panel — dismissal is refused while a bulk run is in flight', () => {
	it('Escape when IDLE closes the form but NOT the panel it sits in — the WAI-APG two-Escapes-to-leave layering', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		await fireEvent.keyDown(q(container, 'series-create-form') as HTMLElement, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('cancel is DISABLED and Escape is ignored mid-run: the form cannot unmount while the loop is still POSTing', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(true);

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await fireEvent.keyDown(q(container, 'series-create-form') as HTMLElement, { key: 'Escape' });
		await flush();
		expect(q(container, 'series-create-form')).not.toBeNull();

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		resolvers[1]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(3);
		});
		resolvers[2]('ev-new-3');
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'series-create-cancel') as HTMLButtonElement | null) ?? null).toBeNull();
	});
});

describe('season panel — a STOPPED bulk run resumes instead of duplicating', () => {
	it('the failure path re-reads the agenda AND the panel lists so the occurrences that DID land become visible', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		// And the operator is told what a re-submit will do.
		const resume = q(container, 'series-create-resume') as HTMLElement;
		expect(resume).not.toBeNull();
		expect(resume.textContent).toContain('series_create_resume_notice');
		expect(resume.textContent).toContain('"remaining":2');
		expect(resume.textContent).toContain('"total":3');
		// …and the full-set count is gone, so no two contradictory numbers.
		expect(q(container, 'series-create-preview-count')).toBeNull();
	});

	it('review F3 — the preview ROWS shrink to the remainder too: the list and the resume notice describe the SAME set (never 3 dates over a "2 remaining")', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		// Before the run: the full occurrence set.
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
		});

		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		// After the stop: exactly what a re-submit will create — 2026-09-07 landed.
		await waitFor(() => {
			expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		});
		expect(q(container, 'series-create-resume')?.textContent).toContain('"remaining":2');
	});

	it('review F5 — the template and recurrence boxes go INERT while a run is resumable: submit finishes THAT run, so an edit here would be silently discarded', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		for (const testid of [
			'series-create-name',
			'series-create-type',
			'series-create-duration',
			'series-create-location',
			'series-create-description',
			'series-create-repeat',
			'series-create-day',
			'series-create-time',
			'series-create-from',
			'series-create-until',
			'series-create-skip-date',
			'series-create-skip-add'
		]) {
			expect(
				(q(container, testid) as HTMLInputElement | HTMLButtonElement | null)?.disabled
			).toBe(true);
		}
		// Submit stays live (finish the run) and so does the generate checkbox —
		// turning it OFF is the documented way to close out without the rest.
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-generate') as HTMLInputElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);
	});

	it('re-submitting creates NO second series and only the occurrences that never landed', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(2);

		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		// 1 ok + 1 failed, then the failed one and the last one — never a replay
		// of the occurrence that already succeeded.
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
		for (const call of createEventMock.mock.calls.slice(2)) {
			expect((call[1] as CreateEventInput).seriesId).toBe(NEW_SERIES_ID);
		}
	});

	it('turning generation OFF after a stopped run closes out without writing a SECOND series', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		await flush();
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(2);
	});
});

// ── #138 — a stopped run survives the COLLECTIVE ROUND TRIP ────────────────────
//
// The gap the #138 fix's own review found: keying the resume record by db was
// not enough, because `closeSeriesCreateForm` still cleared "the currently
// selected db" and DURING a switch `selected` has already moved to the db being
// switched TO. Returning to the collective that owns a stopped run therefore
// deleted exactly that db's entry — the only direction the feature exists for —
// and the suite could not see it: every existing resume case above stays inside
// ONE collective. These pin the round trip itself.
//
// Contract pinned here:
//   - a run stopped in A (by a failed occurrence OR by the switch itself) is
//     still recorded when the viewer comes back to A;
//   - coming back RE-OPENS the panel + form from the run's own snapshot, so the
//     "N remaining of M" notice, the remainder-scoped preview rows, Submit and
//     Cancel are all on screen — a lock with no visible cause and no exit is not
//     an acceptable terminal state;
//   - a re-submit after the round trip FINISHES the run: no second
//     `createEventSeries`, and no re-POST of an occurrence that already landed;
//   - B is untouched throughout — its own entry points stay live and it can
//     create its own series while A's run is outstanding;
//   - Cancel is still the documented way to abandon the run, and it unlocks A.

describe('#138 — a stopped series run survives a collective round trip', () => {
	function setAuthedWithTwoCollectives(): void {
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

	async function renderTwoReady(): Promise<HTMLElement> {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		return container;
	}

	/** Three Mondays in org-a; occurrence #2 fails, so the run STOPS owing two. */
	async function stopRunInOrgA(container: HTMLElement): Promise<void> {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
	}

	async function leaveOrgA(container: HTMLElement): Promise<void> {
		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
	}

	it('coming back to org-a re-surfaces the run, and a re-submit creates NO second series and re-POSTs nothing that landed', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(2);

		await leaveOrgA(container);
		selectedCollectiveDbStore.set('org-a');

		// No gear click: the return itself must put the run back on screen — while
		// the record is outstanding every entry point INCLUDING [+ Series] is
		// refused, so a viewer who had to click her way back could not get here.
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		const resume = q(container, 'series-create-resume') as HTMLElement;
		expect(resume.textContent).toContain('"remaining":2');
		expect(resume.textContent).toContain('"total":3');
		// The rows describe the same set as the notice — the remainder.
		expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		// …and the exits are reachable again.
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);

		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
		for (const call of createEventMock.mock.calls.slice(2)) {
			expect((call[1] as CreateEventInput).seriesId).toBe(NEW_SERIES_ID);
			expect(call[0]).toEqual({ db: 'org-a', token: 'jwt-abc' });
		}
		// The finished run is forgotten, so org-a's entry points are live again.
		await waitFor(() => {
			expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	it('a switch MID-generation (nothing failed) records what org-a still owes — the orphan #138 is actually named after', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderTwoReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		// The viewer leaves while occurrence #1 is still on the wire.
		await leaveOrgA(container);
		resolvers[0]('ev-new-1');
		await flush();
		// #137's contract holds: the loop stops rather than POSTing into org-a.
		expect(createEventMock).toHaveBeenCalledTimes(1);
		// …and org-b is a clean slate meanwhile.
		expect(q(container, 'series-create-resume')).toBeNull();

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		expect((q(container, 'series-create-resume') as HTMLElement).textContent).toContain(
			'"remaining":2'
		);

		createEventMock.mockImplementation(async () => `ev-resumed-${createEventMock.mock.calls.length}`);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(3);
		expect(
			createEventMock.mock.calls.slice(1).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
	});

	it('org-b is unaffected while org-a owes a run: its entry points stay live and it creates its own series', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);

		await leaveOrgA(container);
		// `openSeriesForm` clicks the gear and then [+ Series] — a click on a
		// disabled button is a no-op, so reaching the form at all proves org-b's
		// entry points were never blocked by org-a's outstanding run.
		await openSeriesForm(container);
		expect(q(container, 'series-create-resume')).toBeNull();

		createEventMock.mockImplementation(async () => `ev-b-${createEventMock.mock.calls.length}`);
		await fillValidTemplate(container);
		await submit(container); // generation OFF — series only

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(2);
		expect(createEventSeriesMock.mock.calls[1][0]).toEqual({ db: 'org-b', token: 'jwt-abc' });

		// And org-a's own record survived org-b's clean series create untouched.
		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
	});

	it('Cancel after the round trip abandons the run and unlocks org-a', async () => {
		const container = await renderTwoReady();
		await stopRunInOrgA(container);
		await leaveOrgA(container);
		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);
		// Re-opening is a genuinely blank form, not the abandoned run.
		await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).not.toBeNull();
		});
		expect(q(container, 'series-create-resume')).toBeNull();
		expect((q(container, 'series-create-name') as HTMLInputElement).value).toBe('');
	});

	// #138 review 2 — the restore guard was keyed to the GLOBAL submitting flag
	// while the resume records are keyed by db, so a run still on the wire in the
	// collective the viewer just LEFT swallowed the arriving collective's own
	// restore. `restoreSeriesCreateRun` has exactly one call site (the agenda
	// load's success handler), so the skipped restore is never re-attempted: the
	// arriving db's surviving record keeps every create entry point refused with
	// no form on screen and no copy explaining it — the dead end the flag's own
	// doc says cannot happen. It self-heals only on a further collective switch.
	it('a run still IN FLIGHT in the collective just left does not swallow the arriving one’s restore', async () => {
		const container = await renderTwoReady();

		// org-b acquires its OWN stopped run (occurrence 2 of 3 fails)…
		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		await stopRunInOrgA(container); // db-agnostic: it runs in whatever is selected
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);

		// …and the viewer moves back to org-a, whose entry points are free (the
		// outstanding record belongs to org-b).
		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		// org-a starts a bulk run of its own; the first occurrence POST hangs.
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		// She switches to org-b WHILE org-a's POST is still on the wire. org-b's
		// agenda load resolves first — this is the load that used to skip the
		// restore because SOME db was submitting.
		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		// org-a's POST lands afterwards: it records what org-a still owes and
		// releases the submitting flag — and touches nothing org-b is showing.
		resolvers[0]('ev-a-1');
		await flush();
		expect(q(container, 'series-create-resume')).not.toBeNull();
		expect(previewDates(container)).toEqual(['2026-09-14', '2026-09-21']);
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);
		expect((q(container, 'series-create-cancel') as HTMLButtonElement).disabled).toBe(false);

		// The lock therefore has its visible exit back: Cancel frees org-b.
		await fireEvent.click(q(container, 'series-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(false);

		// …while org-a's own record survived the whole exchange untouched.
		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});
		expect((q(container, 'series-create-resume') as HTMLElement).textContent).toContain(
			'"remaining":2'
		);
	});
});

// (*MVOX:Palestrina* — #132/T5 review fixes: daily-generation reachability,
// range validation, empty-recurrence refusal, mid-run dismissal guard, preview
// count/scroll, resumable partial bulk run)

// (*MVOX:Palestrina* — #132/T5 review 2nd pass: start_date/end_date = first/last
// OCCURRENCE, required event_type, resume-scoped preview rows, per-field
// aria-invalid/describedby, template+recurrence locked while resumable)

// (*MVOX:Tallis* — #132/T5 RED: [+ Series] inline form, live recurrence preview
// over the REAL generateEventDates, serial bulk generator with progress +
// partial-failure reporting, createEventSeries/createEvent wiring)
