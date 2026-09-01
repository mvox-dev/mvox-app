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
//     - same 8 canonical options, same localized labels, same schema order.
//     - default selection 'rehearsal' — so the Crede flow (open form, fill
//       time, submit) yields an event the agenda's rehearsal filter FINDS
//       without the viewer touching the type at all.
//     - the submitted `createEvent` input carries the canonical English key.
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

/** The v4E canonical event types, schema order (schema.ts `event_type` note —
 *  the same order $lib/events/eventTypeLabels declares). */
const CANONICAL_EVENT_TYPES = [
	'rehearsal',
	'concert',
	'festival',
	'retreat',
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

/** The minimum a VALID series-only submit needs beyond the prefills. */
async function fillValidSeriesTemplate(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fill(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
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

	it('offers EXACTLY the 8 canonical v4E types, schema order, canonical keys as values and the paraglide event_type_* messages as labels — no "" placeholder, no free-text prior types mixed in', async () => {
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

	it('a PICKED type stores the canonical ENGLISH key — the viewer who sees "Kontsert" writes "concert", onto the series AND every generated occurrence', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeriesTemplate(container);
		await selectValue(container, 'series-create-type', 'concert');
		// Generation ON, Mondays: Sep 7 / 14 / 21 within the fixed range above.
		await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
		await selectValue(container, 'series-create-day', '1');
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

describe('event form — event-create-type is a localized canonical picker', () => {
	it('renders a <select> with EXACTLY the 8 canonical types, localized labels, on the real event-create form', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		const type = q(container, 'event-create-type');
		expect(type).not.toBeNull();
		expect(type?.tagName).toBe('SELECT');
		expect(optionPairs(type as HTMLSelectElement)).toEqual(canonicalPairs());
	});

	it('defaults to rehearsal — the Crede flow needs NO type interaction to produce an agenda-findable rehearsal', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		expect((q(container, 'event-create-type') as HTMLSelectElement).value).toBe('rehearsal');
	});

	it('an untouched picker submits eventType "rehearsal" (canonical key) to createEvent', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fill(container, 'event-create-name', 'Tuesday rehearsal');
		await fill(container, 'event-create-datetime', '2026-09-08T18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastEventInput().eventType).toBe('rehearsal');
	});

	it('a PICKED type stores the canonical ENGLISH key: choose workshop (shown localized) → createEvent gets eventType "workshop"', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await selectValue(container, 'event-create-type', 'workshop');
		await fill(container, 'event-create-name', 'Score-reading workshop');
		await fill(container, 'event-create-datetime', '2026-09-10T18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastEventInput().eventType).toBe('workshop');
	});
});

// ── review F4: the picker names itself ON SCREEN ────────────────────────────────
//
// The picker is never blank, so — unlike the season <select> — it has no ''
// placeholder option to name itself with, and the aria-label it inherited from
// the old Autocomplete is invisible. Both forms therefore carry a VISIBLE
// label element, and the select must sit INSIDE it (implicit association: no
// id, no `for`, nothing to drift).

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

	it('event-create-type sits inside a <label> whose visible text is the localized field name — and gains NO "" option in the process', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		const caption = q(container, 'event-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('event_create_type_label');
		const label = caption.closest('label');
		expect(label).not.toBeNull();
		const select = q(container, 'event-create-type') as HTMLSelectElement;
		expect(select.closest('label')).toBe(label);
		// The label is the fix; a blank placeholder option is NOT.
		expect(optionPairs(select)).toEqual(canonicalPairs());
	});
});

// (*MVOX:Tallis* — #199 RED: canonical localized event-type picker contract)
