// @vitest-environment happy-dom
//
// #199 RED — LOCALIZED EVENT TYPE PICKER on both creation forms, on the ACTUAL
// agenda route (integration: real +page.svelte, real season-manage panel; only
// the data seams are mocked — same harness family as page.event-create.spec.ts
// and page.series-create.spec.ts).
//
// WHY (#199, Crede pilot 2026-08-31): `event_type` is free text today. Mihkel
// typed `proov` (Estonian); the agenda's rehearsal filter (#194) keys on the
// canonical English `rehearsal` — the event silently fell out of the agenda
// query. #194 fixed the query side; THIS is the input side: the forms must stop
// accepting arbitrary strings and instead offer the 8 canonical v4E types,
// SHOWN in the viewer's language, STORED as the canonical English key.
//
// Pinned contract (GREEN must implement):
//
//   THE CANONICAL TYPES — v4E schema.ts `event_type` note, in schema order:
//     rehearsal | concert | festival | retreat | workshop | meeting | social |
//     other
//   The one label source is the EXISTING $lib/events/eventTypeLabels map
//   (#194/#202) — option labels come through paraglide `m.event_type_<key>`
//   messages (already translated en/et/lv/uk), NEVER hard-coded English and
//   NEVER the raw key.
//
//   SERIES FORM (season panel → [+ Series])
//     - `series-create-type` becomes a <select> — SAME testid, new tag. The
//       old contract ("text input PRE-FILLED 'rehearsal'", typed values ride
//       through verbatim — page.series-create.spec.ts) is SUPERSEDED here;
//       GREEN updates those older pins to match this file.
//     - option VALUES = the 8 canonical keys, schema order, no '' placeholder
//       (the wire requires a type either way — same posture as
//       series-create-repeat); option LABELS = the localized messages.
//     - default selection 'rehearsal' (the workflow's own default, unchanged).
//     - the submitted `createEventSeries` input carries the canonical ENGLISH
//       key — an Estonian viewer who sees "Kontsert" stores 'concert'. The
//       picked key also rides onto every generated occurrence (bulk path).
//
//   EVENT FORM (agenda [+ Event] / panel [+ Event])
//     - `event-create-type` — NEW testid, the <select> itself — replaces the
//       free-text Autocomplete flow (`event-create-type-field` /
//       `event-create-type-value` / listEventTypes-fed suggestions). Those
//       older pins in page.event-create.spec.ts are SUPERSEDED; GREEN updates
//       them. (Whether a free-text "custom type" escape hatch survives
//       somewhere is a product call the issue leaves open — NOT pinned here;
//       what IS pinned is that the canonical picker exists and is the default
//       path.)
//     - same 8 canonical options, same localized labels, same schema order —
//       PLUS, since #242, a leading '' placeholder option FIRST, labeled by
//       the NEW event_create_type_placeholder message (the same idiom as the
//       season select's '' placeholder).
//     - #242 RULING (Mihkel, 2026-09-05) SUPERSEDES the old default pin: the
//       standalone picker STARTS EMPTY — no preselected type, the user makes
//       one explicit choice. The old default is why #245 had to exist (a
//       concert entered as proov because the form had already answered). An
//       untouched submit is REFUSED with event_create_type_required pointing
//       at the field — #199's "defensive floor" validation becomes reachable.
//       ALL THREE 'rehearsal' literal sites move off the default (initial
//       $state + both form resets), or reopening the form would quietly
//       reintroduce it.
//     - the submitted `createEvent` input carries the canonical English key.
//     - the SERIES form is NOT touched by #242: seriesCreateType keeps its
//       'rehearsal' default and its select gains no placeholder (a series has
//       a genuine dominant type — ruling done-when 4).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// Every m.<key>() renders as the KEY, so "label is the localized message"
// is assertable as textContent === 'event_type_<key>' without pinning wording.
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
	getSeriesDefaultsMock
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
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// T1's write layer — the ONLY create seams the page may use.
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
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
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
import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

/** The canonical event types, pinned order — TEN since #266: trip and service
 *  join, service beside concert (performance family), trip beside retreat
 *  (travel family).
 *
 *  DELIBERATELY HAND-TYPED, never `import { CANONICAL_EVENT_TYPES }` from
 *  production: an imported-constant assertion is tautological — it would pass
 *  even when the production constant is wrong. The independent copy is the
 *  house test-integrity style; when the vocabulary changes, THIS list changes
 *  with intent. */
const CANONICAL_EVENT_TYPES = [
	'rehearsal',
	'concert',
	'service',
	'festival',
	'retreat',
	'trip',
	'workshop',
	'meeting',
	'social',
	'other'
];

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';
const NEW_SERIES_ID = 'series-new-1';

/** ISO calendar date `offsetDays` from now — keeps the gating fixtures
 *  time-bomb-free (the panel needs a season that is CURRENT at run time). */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: [],
		owners: [],
		editors: ['person-p']
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

/** The panel's existing lists (T3 shapes) — present so the panel renders. */
function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

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

/** Open the season-manage panel (the gear), then the [+ Series] form. */
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

/** Open the season-manage panel, then its [+ Event] (season pre-filled). */
async function openEventFormFromPanel(container: HTMLElement): Promise<void> {
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

/** The `<option>`s of a picker as [value, label] pairs, document order. */
function optionPairs(select: HTMLSelectElement): Array<[string, string]> {
	return [...select.querySelectorAll('option')].map((o) => [o.value, (o.textContent ?? '').trim()]);
}

/** The [value, label] pairs the canonical picker must offer: canonical English
 *  key + its paraglide message (the mock renders each message as its KEY, so a
 *  hard-coded English "Rehearsal" — or the raw key leaking through as the
 *  label source being skipped — fails this pin). */
function canonicalPairs(): Array<[string, string]> {
	return CANONICAL_EVENT_TYPES.map((key) => [key, `event_type_${key}`]);
}

/** #242 — the STANDALONE event picker's pairs: a leading, non-submittable ''
 *  placeholder labeled by the NEW event_create_type_placeholder message
 *  (asserted via the key mock, never a hard-coded literal — same discipline
 *  as canonicalPairs), then the 10 canonical pairs. The SERIES picker keeps
 *  canonicalPairs() unchanged — the placeholder does NOT extend there. */
function eventPickerPairs(): Array<[string, string]> {
	return [['', 'event_create_type_placeholder'], ...canonicalPairs()];
}

/** The minimum a VALID series submit needs beyond the prefills. #240 —
 *  generation is always on, so a weekly submit also needs a day: Mondays,
 *  which over this fixed range generate Sep 7 / 14 / 21. */
async function fillValidSeriesTemplate(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
	await selectValue(container, 'series-create-day', '1');
}

/** The input object the page handed createEventSeries on its most recent call. */
function lastSeriesInput(): CreateEventSeriesInput {
	const calls = createEventSeriesMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventSeriesInput;
}

/** The input object the page handed createEvent on its most recent call. */
function lastEventInput(): CreateEventInput {
	const calls = createEventMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventInput;
}

// ── series form: the type field is a canonical, localized <select> ──────────────

describe('series form — series-create-type is a localized canonical picker', () => {
	it('renders a <select>, not a text input', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type');
		expect(type).not.toBeNull();
		expect(type?.tagName).toBe('SELECT');
	});

	it('offers EXACTLY the 10 canonical types (#266), pinned order, canonical keys as values and the paraglide event_type_* messages as labels — no "" placeholder, no free-text prior types mixed in', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(optionPairs(type)).toEqual(canonicalPairs());
	});

	it('defaults to rehearsal — as the PICKER’s selection (the old shape, a text input pre-filled "rehearsal", is not this contract)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(type.tagName).toBe('SELECT');
		expect(type.value).toBe('rehearsal');
	});

	it('an untouched PICKER submits the canonical DEFAULT: createEventSeries gets eventType "rehearsal"', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		// The default must come off the canonical picker, not the legacy
		// free-text prefill — guard the shape before pinning the wire value.
		expect((q(container, 'series-create-type') as HTMLElement).tagName).toBe('SELECT');
		await fillValidSeriesTemplate(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().eventType).toBe('rehearsal');
	});

	// #242 GUARD — the ruling's done-when 4: the standalone form's empty-start
	// change does NOT extend here. seriesCreateType is a fully separate $state
	// and keeps its 'rehearsal' default; the series select gains NO '' option.
	// (The two pins above already assert exactly this — this test states the
	// guard EXPLICITLY so a future "consistency" sweep can't flip them all
	// without meeting a named counter-pin.)
	it('#242 guard — the series picker is UNTOUCHED by the standalone empty-start ruling: still defaults to rehearsal, still no "" placeholder option', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(type.value).toBe('rehearsal');
		expect(optionPairs(type)).toEqual(canonicalPairs());
	});

	it('a PICKED type stores the canonical ENGLISH key — the viewer who sees "Kontsert" writes "concert", onto the series AND every generated occurrence', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeriesTemplate(container);
		await selectValue(container, 'series-create-type', 'concert');
		// #240 — generation is always on; the helper already picked Mondays, so
		// Sep 7 / 14 / 21 generate within the fixed range above.
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});
		expect(lastSeriesInput().eventType).toBe('concert');
		for (const call of createEventMock.mock.calls) {
			expect((call[1] as CreateEventInput).eventType).toBe('concert');
		}
	});
});

// ── event form: the type field is the SAME canonical, localized <select> ────────

describe('event form — event-create-type is a localized canonical picker that STARTS EMPTY (#242)', () => {
	it('renders a <select> with the "" placeholder FIRST (labeled by the NEW event_create_type_placeholder message) then the 10 canonical types (#266), localized labels, on the real event-create form — #242 flips the old exactly-8 pin', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		const type = q(container, 'event-create-type');
		expect(type).not.toBeNull();
		expect(type?.tagName).toBe('SELECT');
		expect(optionPairs(type as HTMLSelectElement)).toEqual(eventPickerPairs());
	});

	it('STARTS EMPTY — no preselected type (#242 ruling; the old "defaults to rehearsal / Crede needs no type interaction" pin is retired): the "" placeholder is the initial selection', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		expect((q(container, 'event-create-type') as HTMLSelectElement).value).toBe('');
	});

	it('an untouched picker REFUSES the submit (#242 flips the old "untouched submits rehearsal" pin): createEvent is NEVER called, event_create_type_required RENDERS in event-create-error, and the select is aria-invalid + aria-describedby=event-create-error — #199\'s dead "defensive floor" becomes the reachable path', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		// Everything ELSE valid — season prefilled by the panel, name and start
		// filled — so the refusal below can only be the type's.
		await fill(container, 'event-create-name', 'Tuesday rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-08', '18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		// The MESSAGE renders — not just the validation branch: the refusal is
		// only real if the viewer can see it (research risk: no test exercised
		// this rendering while the path was unreachable).
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		const error = q(container, 'event-create-error') as HTMLElement;
		expect(error.textContent?.trim()).toBe('event_create_type_required');
		expect(error.getAttribute('role')).toBe('alert');
		const select = q(container, 'event-create-type') as HTMLSelectElement;
		expect(select.getAttribute('aria-invalid')).toBe('true');
		expect(select.getAttribute('aria-describedby')).toBe('event-create-error');
		expect(createEventMock).not.toHaveBeenCalled();
		// The form stays open with the work still in it.
		expect(q(container, 'event-create-form')).not.toBeNull();
	});

	it('REOPENING the form after a close starts empty again — the ruling\'s "a reset will quietly reintroduce the default" hazard: all three rehearsal literal sites (initial $state + open-form reset + close reset) are flipped', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await selectValue(container, 'event-create-type', 'concert');
		expect((q(container, 'event-create-type') as HTMLSelectElement).value).toBe('concert');

		// Close (exercises the closeEventCreateForm reset site)…
		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		// …reopen (exercises the open-form reset site): still empty, NOT
		// 'rehearsal' and NOT the previously chosen 'concert'. The season-manage
		// panel itself is UNTOUCHED by the form cancel (only eventCreateOpen
		// flips), so [+ Event] is already visible again — re-clicking the gear
		// here (as `openEventFormFromPanel` does for a FIRST open) would toggle
		// the still-open panel SHUT instead.
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect((q(container, 'event-create-type') as HTMLSelectElement).value).toBe('');
	});

	it('a PICKED type stores the canonical ENGLISH key: choose workshop (shown localized) → createEvent gets eventType "workshop"', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await selectValue(container, 'event-create-type', 'workshop');
		await fill(container, 'event-create-name', 'Score-reading workshop');
		await fillDateTime(container, 'event-create-datetime', '2026-09-10', '18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastEventInput().eventType).toBe('workshop');
	});

	it('choose a type, submit → succeeds with the chosen type on the wire: the FULL createEvent payload, byte-exact (partial assertions hide bugs)', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await selectValue(container, 'event-create-type', 'concert');
		await fill(container, 'event-create-name', 'Autumn concert');
		// 18:30 Europe/Tallinn on 10 Sep 2026 (EEST, UTC+3) = 15:30Z — TE.4.
		await fillDateTime(container, 'event-create-datetime', '2026-09-10', '18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		// FULL param shape — no seriesId/duration/location/description/
		// conductorRefs/capacity keys on an untouched standalone create.
		expect(createEventMock).toHaveBeenCalledWith(
			{ db: 'polyphony', token: 'jwt-abc' },
			{
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'concert',
				startDatetime: '2026-09-10T15:30:00.000Z',
				name: 'Autumn concert'
			}
		);
	});
});

// ── review F4: the picker names itself ON SCREEN ────────────────────────────────
//
// #199 F4's original rationale ("the picker is never blank, so it has no ''
// placeholder to name itself with") is SUPERSEDED for the STANDALONE form by
// the #242 ruling: that picker now starts blank and carries a '' placeholder.
// What F4 still pins — on BOTH forms — is the VISIBLE label element with the
// select INSIDE it (implicit association: no id, no `for`, nothing to drift);
// an aria-label alone is invisible. The series picker additionally keeps the
// original no-placeholder shape (see the #242 series guard above).

describe('both forms — the type picker carries a VISIBLE label, not an aria-label alone (review F4)', () => {
	it('series-create-type sits inside a <label> whose visible text is the localized field name', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const caption = q(container, 'series-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('series_create_type_label');
		const label = caption.closest('label');
		expect(label).not.toBeNull();
		expect((q(container, 'series-create-type') as HTMLElement).closest('label')).toBe(label);
	});

	// #242 DELIBERATELY INVERTS this test's old pin. Its #199-era title ended
	// "…and gains NO '' option in the process", with the comment "The label is
	// the fix; a blank placeholder option is NOT." — correct THEN (the fix
	// under review was the visible label, and the picker was never blank), but
	// the ruling now REQUIRES the '' placeholder as the initial, refusable
	// state. The visible-label half of the pin is unchanged.
	it('event-create-type sits inside a <label> whose visible text is the localized field name — and NOW carries the "" placeholder option first (#242 supersedes the old "gains NO empty option" pin)', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		const caption = q(container, 'event-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('event_create_type_label');
		const label = caption.closest('label');
		expect(label).not.toBeNull();
		const select = q(container, 'event-create-type') as HTMLSelectElement;
		expect(select.closest('label')).toBe(label);
		// The visible label AND the placeholder are both the contract now.
		expect(optionPairs(select)).toEqual(eventPickerPairs());
	});
});

// (*MVOX:Tallis* — #199 RED: canonical localized event-type picker contract;
//  #242 RED: standalone picker starts empty, one explicit choice — untouched
//  submit refused, series form untouched)
