// @vitest-environment happy-dom
//
// #196 RED — standalone event → series conversion on the ACTUAL agenda route
// (integration: real +page.svelte; only the data seams are mocked — same
// harness family as page.event-create.spec.ts / page.season-manage.spec.ts).
//
// WHY (#196, Joosep / Crede pilot 2026-08-31): "I started intuitively, created
// a standalone 'proov' expecting to make it recurring. The app doesn't offer a
// path from standalone to series — the standalone event was wasted effort."
// Two-phase fix, both pinned here:
//
//   PHASE 1 — THE HINT: the event-creation form says, while NO series is
//   selected, that recurring events want the series flow (localized key,
//   never hardcoded copy). The hint leaves the moment a series is chosen.
//
//   PHASE 2 — THE CONVERSION: every standalone event row in the season-manage
//   panel offers a convert control that opens a small recurrence form and
//   hands off to `convertEventToSeries` ($lib/events/eventConvert — the #196
//   data layer, pinned in eventConvert.spec.ts). The page derives the series'
//   start from the EVENT (Tallinn wall clock, the same Europe/Tallinn
//   convention every other datetime surface on this page uses); the operator
//   supplies only cadence, duration and the end date.
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA
//     - submit calls `convertEventToSeries(cfg, input)` — the ONE conversion
//       seam. dbEntityId from `resolveDatabaseEntityId` (never guessed),
//       seasonId = the panel's season, eventId = the row's event.
//       startTime/startDate derived from the event's `startDatetime` as
//       EUROPE/TALLINN wall clock ('2027-04-18T18:00:00.000Z' → '21:00' +
//       '2027-04-18' — April is EEST, UTC+3).
//     - the conversion is HALF the submit (#196 review F1): occurrences in
//       this app are materialized `event` entities, so the further ones the
//       operator asked for are written too — one serial `createEvent` per
//       `generateIntervalDates` date AFTER the event's own, each carrying the
//       new series and the EVENT's own event_type. Without them the operator
//       fills in "Repeat every (days)" / "Series ends", converts, and the
//       agenda still shows one event: the dead end #196 was filed about.
//     - success → the form closes AND the world refreshes: `loadFullAgenda`
//       re-invoked, and the panel's two lists re-read (the event must move
//       from the standalone list into the series' count).
//     - failure → inline error, role="alert", NAMING the failed step (the
//       EventConvertError's `step` is passed to the localized message as its
//       {step} param) — loud, form stays OPEN, no refresh.
//     - a blank/invalid field is refused BEFORE any write, naming its own box
//       (#196 review F2) — never a data-layer refusal reported under a step
//       that never ran.
//     - an occurrence failure stops the run, reports how far it got, and
//       records what is still owed so a re-submit FINISHES rather than
//       converting a second time.
//     - cancel closes the form; NOTHING written.
//
//   DIALOG (#196 review F3/F4) — the form keeps the contract its four siblings
//   on this page keep: focus moves into it on open, its own Escape dismisses
//   IT and not the season-manage panel around it, it is mutually exclusive with
//   the other creation forms, and its entry point is `disabled` while any
//   create is on the wire or a stopped run still owes occurrences.
//
//   TESTIDS
//     event-create-series-hint            the phase-1 hint INSIDE the event
//                                         creation form — rendered while the
//                                         series select holds '' (standalone),
//                                         gone while a series is chosen
//     season-manage-event-convert-<id>    the convert control INSIDE the
//                                         panel's standalone-event row
//     event-convert-form                  the inline conversion form
//     event-convert-interval              number input, default '7' (weekly)
//     event-convert-duration              number input (minutes)
//     event-convert-end-date              type="date" — the series' last day
//     event-convert-submit                fires convertEventToSeries
//     event-convert-cancel                closes the form; nothing written
//     event-convert-error                 inline error, role="alert"
//     event-convert-progress              "occurrence N of M" while the loop runs
//     event-convert-resume-notice         what a STOPPED run still owes
//
//   I18N — all new user-visible copy through Paraglide keys, present and
//   non-empty in ALL FOUR locales (en/et/lv/uk); `event_convert_failed`
//   carries the {step} placeholder in every locale (the loud-failure pin).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// Unlike the plain key-echo proxy elsewhere, this one appends the params as
// JSON so a spec can pin that a message RECEIVED its parameter (the
// event_convert_failed {step} contract) without pinning translated copy.
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
	createEventMock,
	convertEventToSeriesMock,
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
	createEventMock: vi.fn(),
	convertEventToSeriesMock: vi.fn(),
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
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
// #196 — the conversion seam. The real module's error class rides along so the
// page can discriminate EventConvertError from anything else.
vi.mock('$lib/events/eventConvert', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/events/eventConvert')>();
	return { ...actual, convertEventToSeries: convertEventToSeriesMock };
});
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
import { isMessageEmpty, everyPatternContains, type MessageFile } from '$lib/testing/messageFile.js';
import type { Season } from '$lib/seasons/types';
import type { ConvertEventToSeriesInput } from '$lib/events/eventConvert';
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

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
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

function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

/** The standalone event #196 converts. Its UTC instant is 2027-04-18T18:00Z —
 *  Europe/Tallinn is EEST (UTC+3) in April, so the wall clock the operator
 *  knows this event by is 21:00 on 2027-04-18. */
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
	createEventMock.mockResolvedValue('ev-new-1');
	convertEventToSeriesMock.mockResolvedValue({ seriesId: 'series-new-9', eventType: 'concert' });
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue(seriesFixture());
	listEventsForSeasonMock.mockResolvedValue(standaloneFixture());
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: ''
	});
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createEventMock.mockReset();
	convertEventToSeriesMock.mockReset();
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

async function openEventCreateFromAgenda(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'event-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'event-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

/** Open the season-manage panel and wait for the standalone-event row. */
async function openPanel(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
	});
}

async function openConvertForm(container: HTMLElement): Promise<void> {
	await openPanel(container);
	await fireEvent.click(q(container, 'season-manage-event-convert-ev-9') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-convert-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

// ── phase 1 — the standalone hint on the event-creation form (#196 test 5) ─────

describe('event-creation form — the "recurring wants a series" hint', () => {
	it('renders INSIDE the form through its localized key while NO series is selected', async () => {
		const container = await renderReady();
		await openEventCreateFromAgenda(container);

		const form = q(container, 'event-create-form') as HTMLElement;
		const hint = form.querySelector('[data-testid="event-create-series-hint"]');
		expect(hint).not.toBeNull();
		// localized key, never hardcoded copy — the paraglide mock echoes keys
		expect(hint?.textContent).toContain('event_create_series_hint');
	});

	it('disappears the moment a series is chosen, and returns when the choice goes back to "" (standalone)', async () => {
		const container = await renderReady();
		await openEventCreateFromAgenda(container);

		await selectValue(container, 'event-create-season', SEASON_ID);
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(series.disabled).toBe(false);
		});
		// still standalone → hint stands
		expect(q(container, 'event-create-series-hint')).not.toBeNull();

		await selectValue(container, 'event-create-series', 'series-1');
		await waitFor(() => {
			expect(q(container, 'event-create-series-hint')).toBeNull();
		});

		await selectValue(container, 'event-create-series', '');
		await waitFor(() => {
			expect(q(container, 'event-create-series-hint')).not.toBeNull();
		});
	});
});

// ── phase 2 — the conversion entry point and wiring (#196 tests 1/3, page side) ─

describe('season-manage panel — the standalone-event convert control', () => {
	it('every standalone row carries its convert control; clicking opens the form (interval pre-filled 7 = weekly) and writes NOTHING yet', async () => {
		const container = await renderReady();
		await openPanel(container);

		const row = q(container, 'season-manage-event-ev-9') as HTMLElement;
		const control = row.querySelector('[data-testid="season-manage-event-convert-ev-9"]');
		expect(control).not.toBeNull();

		await fireEvent.click(control as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).not.toBeNull();
		});

		const interval = q(container, 'event-convert-interval') as HTMLInputElement;
		expect(interval.type).toBe('number');
		expect(interval.value).toBe('7');
		const duration = q(container, 'event-convert-duration') as HTMLInputElement;
		expect(duration.type).toBe('number');
		const endDate = q(container, 'event-convert-end-date') as HTMLInputElement;
		expect(endDate.type).toBe('date');

		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form and NOTHING is written', async () => {
		const container = await renderReady();
		await openConvertForm(container);

		await fireEvent.click(q(container, 'event-convert-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});

	it('submit hands convertEventToSeries the FULL input — eventId/dbEntityId/seasonId, the typed cadence, and startTime/startDate derived from the event as TALLINN wall clock', async () => {
		const container = await renderReady();
		await openConvertForm(container);

		await fill(container, 'event-convert-duration', '90');
		await fill(container, 'event-convert-end-date', '2027-06-30');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);

		await waitFor(() => {
			expect(convertEventToSeriesMock).toHaveBeenCalledTimes(1);
		});
		const expected: ConvertEventToSeriesInput = {
			eventId: 'ev-9',
			dbEntityId: ORG_EFK,
			seasonId: SEASON_ID,
			intervalDays: 7,
			startTime: '21:00',
			startDate: '2027-04-18',
			endDate: '2027-06-30',
			durationMinutes: 90
		};
		expect(convertEventToSeriesMock).toHaveBeenCalledWith(CFG, expected);
		// The conversion is only the FIRST half of the submit (see the occurrence
		// block below) — let the run finish inside the test rather than leaving a
		// loop POSTing into torn-down mocks.
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
	});

	it('success → the form closes AND the world refreshes: loadFullAgenda re-invoked, the panel’s series + standalone lists re-read', async () => {
		const container = await renderReady();
		await openConvertForm(container);
		const agendaLoads = loadFullAgendaMock.mock.calls.length;
		const seriesReads = listEventSeriesForSeasonMock.mock.calls.length;
		const standaloneReads = listEventsForSeasonMock.mock.calls.length;

		await fill(container, 'event-convert-duration', '90');
		await fill(container, 'event-convert-end-date', '2027-06-30');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(agendaLoads);
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReads);
			expect(listEventsForSeasonMock.mock.calls.length).toBeGreaterThan(standaloneReads);
		});
	});

	it('failure → role="alert" inline error NAMING the failed step (the EventConvertError step feeds the message’s {step} param); form stays OPEN, no refresh', async () => {
		convertEventToSeriesMock.mockRejectedValue(
			Object.assign(new Error('convertEventToSeries: link-event failed — HTTP 500'), {
				name: 'EventConvertError',
				step: 'link-event',
				seriesId: 'series-orphan-1'
			})
		);
		const container = await renderReady();
		await openConvertForm(container);
		const agendaLoads = loadFullAgendaMock.mock.calls.length;

		await fill(container, 'event-convert-duration', '90');
		await fill(container, 'event-convert-end-date', '2027-06-30');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('event_convert_failed');
		expect(error.textContent).toContain('link-event');

		expect(q(container, 'event-convert-form')).not.toBeNull();
		expect(loadFullAgendaMock.mock.calls.length).toBe(agendaLoads);
	});

	// ── review F3 — a failure BEFORE the conversion names its own stage ───────────
	//
	// The collective lookup runs before `convertEventToSeries` is called, so it can
	// fail without any conversion step having run. Reporting it as "read-event"
	// sent anyone debugging from the message to the event read instead of the org
	// lookup — the same defect review F2 removed at the data layer.

	it('the COLLECTIVE lookup rejecting names "resolve-collective", never a conversion step that did not run', async () => {
		resolveDatabaseEntityIdMock.mockRejectedValue(new Error('HTTP 401'));
		const container = await renderReady();
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('event_convert_failed');
		expect(error.textContent).toContain('resolve-collective');
		expect(error.textContent).not.toContain('read-event');
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});

	it('an UNRESOLVABLE collective (null, no throw) names the same stage', async () => {
		resolveDatabaseEntityIdMock.mockResolvedValue(null);
		const container = await renderReady();
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('resolve-collective');
		expect(error.textContent).not.toContain('read-event');
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});

	it('a rejection carrying NO step names "unknown" — never the choreography’s first step by default', async () => {
		convertEventToSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('unknown');
		expect(error.textContent).not.toContain('read-event');
	});
});

// ── review F1 — the conversion actually MAKES the event recur ───────────────────
//
// Occurrences in this app are materialized `event` entities (the series-create
// bulk loop writes one per generated date), not read-time-generated. Creating
// the event_series alone therefore changes nothing an operator can see: the
// agenda still shows exactly one event — the dead end #196 was filed about. The
// conversion must write the FURTHER occurrences too.

/** The event's own date is 2027-04-18 (Tallinn 21:00); with interval 7 and an
 *  end date of 2027-06-30 the cadence lands on 11 dates, of which the FIRST is
 *  the converted event itself — 10 further occurrences are written. */
const FURTHER_OCCURRENCE_UTC = [
	'2027-04-25T18:00:00.000Z',
	'2027-05-02T18:00:00.000Z',
	'2027-05-09T18:00:00.000Z',
	'2027-05-16T18:00:00.000Z',
	'2027-05-23T18:00:00.000Z',
	'2027-05-30T18:00:00.000Z',
	'2027-06-06T18:00:00.000Z',
	'2027-06-13T18:00:00.000Z',
	'2027-06-20T18:00:00.000Z',
	'2027-06-27T18:00:00.000Z'
];

async function fillAndSubmitConvert(
	container: HTMLElement,
	over: { duration?: string; endDate?: string; interval?: string } = {}
): Promise<void> {
	if (over.interval !== undefined) await fill(container, 'event-convert-interval', over.interval);
	await fill(container, 'event-convert-duration', over.duration ?? '90');
	await fill(container, 'event-convert-end-date', over.endDate ?? '2027-06-30');
	await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);
}

describe('the converted event actually REPEATS — the occurrences are written', () => {
	it('creates one event per further occurrence, serially, each carrying the new series and the EVENT’S own type; the converted event itself is NOT re-created', async () => {
		const container = await renderReady();
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(FURTHER_OCCURRENCE_UTC.length);
		});
		// Full shape on the first occurrence — an `objectContaining` here would
		// hide exactly the wire-shape bugs this loop can produce.
		expect(createEventMock).toHaveBeenNthCalledWith(1, CFG, {
			dbEntityId: ORG_EFK,
			seriesId: 'series-new-9',
			extraParentIds: [SEASON_ID],
			// The converted event's own event_type, handed back by the conversion —
			// every reader takes the EVENT's type, never the series' (#194/#202).
			eventType: 'concert',
			startDatetime: FURTHER_OCCURRENCE_UTC[0]
		});
		// ...and the whole cadence, in ascending order, starting AFTER the event.
		expect(
			createEventMock.mock.calls.map((call) => (call[1] as { startDatetime: string }).startDatetime)
		).toEqual(FURTHER_OCCURRENCE_UTC);
		// The run finishes inside the test — a loop still POSTing after teardown
		// would write into reset mocks (and hide its own failures).
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
	});

	it('a typed interval no named pattern can express (every 10 days) is honoured', async () => {
		const container = await renderReady();
		await openConvertForm(container);

		await fillAndSubmitConvert(container, { interval: '10', endDate: '2027-05-08' });

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(2);
		});
		expect(
			createEventMock.mock.calls.map((call) => (call[1] as { startDatetime: string }).startDatetime)
		).toEqual(['2027-04-28T18:00:00.000Z', '2027-05-08T18:00:00.000Z']);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
	});

	it('an event with NO event_type is refused BEFORE any write, saying why — nothing to resume, nothing stranded (#196 review F1)', async () => {
		// The data layer refuses a typeless event in `read-event`, so no series
		// exists, the event is untouched, and the operator is told the actual
		// reason — not the retryable "the run stopped" copy behind a series that
		// violates v4E and an event that has left the standalone list.
		convertEventToSeriesMock.mockRejectedValue(
			Object.assign(
				new Error(
					'convertEventToSeries: read-event failed — event has no event_type — an event_series with no event_type violates v4E'
				),
				{ name: 'EventConvertError', step: 'read-event', reason: 'missing-event-type' }
			)
		);
		const container = await renderReady();
		await openConvertForm(container);
		const agendaLoads = loadFullAgendaMock.mock.calls.length;

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('event_convert_missing_type');
		// NOT the "series was created, the run stopped" copy — nothing was created.
		expect(error.textContent).not.toContain('event_convert_generate_failed');
		expect(error.textContent).not.toContain('event_convert_failed');
		expect(q(container, 'event-convert-resume-notice')).toBeNull();
		expect(createEventMock).not.toHaveBeenCalled();
		// Nothing changed, so nothing is refreshed, and the form stays open.
		expect(loadFullAgendaMock.mock.calls.length).toBe(agendaLoads);
		expect(q(container, 'event-convert-form')).not.toBeNull();
	});

	it('a NAMELESS event is refused the same way, with its own reason', async () => {
		convertEventToSeriesMock.mockRejectedValue(
			Object.assign(new Error('convertEventToSeries: read-event failed — event has no name'), {
				name: 'EventConvertError',
				step: 'read-event',
				reason: 'missing-name'
			})
		);
		const container = await renderReady();
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		expect((q(container, 'event-convert-error') as HTMLElement).textContent).toContain(
			'event_convert_missing_name'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('an occurrence failure STOPS the run, says how far it got, keeps the form open with a resume notice — and a re-submit FINISHES it instead of converting a second time', async () => {
		createEventMock.mockResolvedValueOnce('ev-new-1').mockRejectedValueOnce(new Error('HTTP 500'));
		const container = await renderReady();
		await openConvertForm(container);
		const standaloneReads = listEventsForSeasonMock.mock.calls.length;

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('event_convert_generate_failed');
		expect(error.textContent).toContain('"created":1');
		expect(error.textContent).toContain('"total":10');
		// The form is still on screen with what the run still owes — and the
		// panel's standalone list is deliberately NOT re-read: the converted event
		// has left it, so the row (which RENDERS this form) would unmount.
		expect(q(container, 'event-convert-form')).not.toBeNull();
		expect(q(container, 'event-convert-resume-notice')?.textContent).toContain('"remaining":9');
		expect(listEventsForSeasonMock.mock.calls.length).toBe(standaloneReads);

		createEventMock.mockResolvedValue('ev-new-n');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		// Re-converting would leave a duplicate series behind — the resume path
		// must not call the conversion again.
		expect(convertEventToSeriesMock).toHaveBeenCalledTimes(1);
		// 1 landed + 1 failed + 9 on the resume run = 11 attempts, 10 occurrences.
		expect(createEventMock).toHaveBeenCalledTimes(11);
		expect(
			createEventMock.mock.calls.slice(2).map((call) => (call[1] as { startDatetime: string }).startDatetime)
		).toEqual(FURTHER_OCCURRENCE_UTC.slice(1));
	});

	// ── review F2 — a failed agenda refresh must not eat the resume record ────────
	//
	// The occurrence failure fires `loadForSelected({ keepSeasonManage: true })`,
	// and that read can hit the SAME flakiness that stopped the run. Its `.catch`
	// calls `resetSeasonManage()`, which used to clear `eventConvertResume` — the
	// ONLY record of what the run still owes — along with the error and the form.
	// The converted event has left the standalone list, so its convert control is
	// gone and there is no series-extend affordance: the run became unfinishable
	// with nothing on screen saying so.

	it('an occurrence failure followed by a FAILED agenda refresh keeps the resume record, and a retry brings the form and its notice back', async () => {
		createEventMock.mockResolvedValueOnce('ev-new-1').mockRejectedValueOnce(new Error('HTTP 500'));
		const container = await renderReady();
		await openConvertForm(container);

		// The refresh the failure path fires hits the same flakiness and rejects.
		loadFullAgendaMock.mockRejectedValue(new Error('HTTP 500'));
		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'agenda-error')).not.toBeNull();
		});
		// The agenda error swaps the whole agenda subtree, so the panel is off
		// screen — but the RUN is remembered, which is what makes it recoverable.
		loadFullAgendaMock.mockResolvedValue(agendaResult());
		await fireEvent.click(q(container, 'agenda-retry') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'event-convert-form')).not.toBeNull();
		});
		expect(q(container, 'event-convert-resume-notice')?.textContent).toContain('"remaining":9');
		expect((q(container, 'event-convert-error') as HTMLElement).textContent).toContain(
			'event_convert_generate_failed'
		);
		// Still blocking every other entry point, because the run is still unfinished.
		expect((q(container, 'season-manage-add-event') as HTMLButtonElement).disabled).toBe(true);

		// ...and the run genuinely finishes from there — no second conversion.
		createEventMock.mockResolvedValue('ev-new-n');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		expect(convertEventToSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventMock).toHaveBeenCalledTimes(11);
	});
});

// ── review F2 — blank fields are refused HERE, naming the box ───────────────────
//
// Both the duration and the end date start EMPTY, so this is the default path.
// Passing a blank through meant `requireNumber`/`requireDateRange` threw a plain
// Error with no `.step`, and the page's duck-typed fallback reported
// "read-event" — a step that never ran — for an empty box.

describe('conversion form validation — before any write, naming the field', () => {
	const cases: Array<[string, { duration?: string; endDate?: string; interval?: string }, string, string]> = [
		['a blank duration', { duration: '' }, 'event_convert_duration_required', 'event-convert-duration'],
		['a zero duration', { duration: '0' }, 'event_convert_duration_required', 'event-convert-duration'],
		['a blank end date', { endDate: '' }, 'event_convert_end_required', 'event-convert-end-date'],
		[
			'an end date BEFORE the event’s own date',
			{ endDate: '2027-01-01' },
			'event_convert_end_before_start',
			'event-convert-end-date'
		],
		['a blank interval', { interval: '' }, 'event_convert_interval_required', 'event-convert-interval'],
		['an interval below 1', { interval: '0' }, 'event_convert_interval_required', 'event-convert-interval']
	];

	it.each(cases)(
		'%s → refused with its OWN message, the field marked invalid and described by it; NOTHING is written',
		async (_label, over, expectedKey, fieldTestid) => {
			const container = await renderReady();
			await openConvertForm(container);

			await fillAndSubmitConvert(container, over);

			await waitFor(() => {
				expect(q(container, 'event-convert-error')).not.toBeNull();
			});
			const error = q(container, 'event-convert-error') as HTMLElement;
			expect(error.textContent).toContain(expectedKey);
			// NOT the "(read-event)" failure copy for a step that never ran.
			expect(error.textContent).not.toContain('event_convert_failed');
			expect(error.id).toBe('event-convert-error');

			const field = q(container, fieldTestid) as HTMLElement;
			expect(field.getAttribute('aria-invalid')).toBe('true');
			expect(field.getAttribute('aria-describedby')).toBe('event-convert-error');

			expect(convertEventToSeriesMock).not.toHaveBeenCalled();
			expect(createEventMock).not.toHaveBeenCalled();
		}
	);

	it('typing in a refused field clears the message, so a retry is not read against the old complaint', async () => {
		const container = await renderReady();
		await openConvertForm(container);
		await fillAndSubmitConvert(container, { duration: '' });
		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});

		await fill(container, 'event-convert-duration', '90');
		await waitFor(() => {
			expect(q(container, 'event-convert-error')).toBeNull();
		});
		expect((q(container, 'event-convert-duration') as HTMLElement).getAttribute('aria-invalid')).toBeNull();
	});
});

// ── review F3 — the dialog contract its four siblings keep ──────────────────────

describe('the conversion form as a dialog', () => {
	it('takes focus when it opens — a role="dialog" nothing is focused inside promises a container that is not there', async () => {
		const container = await renderReady();
		await openConvertForm(container);

		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'event-convert-form'));
		});
		expect((q(container, 'event-convert-form') as HTMLElement).getAttribute('tabindex')).toBe('-1');
	});

	it('Escape dismisses the FORM ONLY — the season-manage panel around it stays open (two Escapes to leave, not one) — and focus goes back to the control that opened it', async () => {
		const container = await renderReady();
		await openConvertForm(container);

		await fireEvent.keyDown(q(container, 'event-convert-form') as HTMLElement, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-event-convert-ev-9'));
		});
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});
});

// ── review F4 — the panel's create discipline, which this entry point skipped ───

describe('the convert entry point obeys the panel’s create discipline', () => {
	it('opening the conversion form closes the event-create form, and opening event-create closes the conversion form — only ONE creation form at a time', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-event-convert-ev-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).not.toBeNull();
		});
		expect(q(container, 'event-create-form')).toBeNull();

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect(q(container, 'event-convert-form')).toBeNull();
	});

	it('while a stopped run still owes occurrences, every creation entry point (this one included) is visibly blocked — and Cancel is the way out', async () => {
		createEventMock.mockRejectedValue(new Error('HTTP 500'));
		const container = await renderReady();
		await openConvertForm(container);

		await fillAndSubmitConvert(container);
		await waitFor(() => {
			expect(q(container, 'event-convert-resume-notice')).not.toBeNull();
		});

		// #212 — while the conversion form is open the panel is ONE action
		// context: every row ⟳/× is unmounted entirely (see the #212 block
		// below), so "visibly blocked" for THIS entry point now means GONE.
		expect(q(container, 'season-manage-event-convert-ev-9')).toBeNull();
		expect((q(container, 'season-manage-add-event') as HTMLButtonElement).disabled).toBe(true);
		expect((q(container, 'season-manage-add-series') as HTMLButtonElement).disabled).toBe(true);
		// The panel cannot be torn down around the only record of what the run owes.
		await fireEvent.keyDown(q(container, 'season-manage-panel') as HTMLElement, { key: 'Escape' });
		expect(q(container, 'season-manage-panel')).not.toBeNull();

		await fireEvent.click(q(container, 'event-convert-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		expect((q(container, 'season-manage-add-event') as HTMLButtonElement).disabled).toBe(false);
	});
});

// ── #212 — the form SHOWS the series' fixed start, and OWNS the panel while open ─
//
// Gama's ruling on #212 (last comment):
//   (1) the form carries the event's own date — labelled, rendered as plain
//       YYYY-MM-DD TEXT (never an input: the start is derived from the event,
//       not operator-editable), above the end-date picker; and
//   (2) while the form is open the panel is a SINGLE action context: every
//       row's ⟳ and × (event rows AND series rows) is gone, any armed delete
//       confirmation is disarmed, and closing or submitting the form brings
//       every row's buttons back.
//
//   TESTIDS
//     event-convert-start-date   a <p> INSIDE event-convert-form: the
//                                event_convert_start_date_label key + the
//                                Tallinn wall-clock ISO date of the event —
//                                derived in the template, no new state.

describe('#212 — the convert form shows the series’ fixed start (the event’s own date)', () => {
	it('renders event-convert-start-date as labelled TEXT — the label key + the Tallinn wall-clock ISO date — above the end-date picker, and it is NOT an input', async () => {
		// 2026-03-14 is EET (UTC+2, before the late-March DST switch): the UTC
		// instant 16:00Z is the 18:00 Tallinn wall clock the operator knows the
		// event by. The date shown must be the TALLINN date, ISO-formatted.
		listEventsForSeasonMock.mockResolvedValue([
			{ id: 'ev-9', name: 'Winter concert', startDatetime: '2026-03-14T16:00:00.000Z' }
		]);
		const container = await renderReady();
		await openConvertForm(container);

		const start = q(container, 'event-convert-start-date');
		expect(start).not.toBeNull();
		// Plain text in a <p> — the start is derived from the event and not the
		// operator's to edit, so it must never render as a form control.
		expect((start as HTMLElement).tagName).toBe('P');
		expect((start as HTMLElement).querySelector('input, select, textarea')).toBeNull();
		// FULL textContent: the localized label (the paraglide mock echoes keys)
		// plus the ISO date — nothing else, no hardcoded copy.
		expect((start as HTMLElement).textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'event_convert_start_date_label 2026-03-14'
		);
		// It sits INSIDE the form, ABOVE the end-date picker it gives meaning to.
		const form = q(container, 'event-convert-form') as HTMLElement;
		expect(form.contains(start)).toBe(true);
		const endDate = q(container, 'event-convert-end-date') as HTMLElement;
		expect(
			(start as HTMLElement).compareDocumentPosition(endDate) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});
});

describe('#212 — one action context: the open form takes every row’s ⟳/× off the table', () => {
	/** Count every element whose testid starts with `prefix` — the armed
	 *  confirm/cancel testids share the plain ×'s prefix, so a 0 here means NO
	 *  delete affordance in ANY posture. */
	function countByPrefix(container: HTMLElement, prefix: string): number {
		return container.querySelectorAll(`[data-testid^="${prefix}"]`).length;
	}

	it('opening the convert form on one row hides EVERY row’s action buttons — event rows and series rows alike — and cancel brings every one back', async () => {
		listEventsForSeasonMock.mockResolvedValue([
			{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' },
			{ id: 'ev-10', name: 'Autumn concert', startDatetime: '2027-09-12T15:00:00.000Z' }
		]);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-10')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});

		// Baseline: two event rows (⟳ + × each), one series row (×).
		expect(countByPrefix(container, 'season-manage-event-convert-')).toBe(2);
		expect(countByPrefix(container, 'season-manage-event-delete-')).toBe(2);
		expect(countByPrefix(container, 'season-manage-series-delete-')).toBe(1);

		await fireEvent.click(q(container, 'season-manage-event-convert-ev-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).not.toBeNull();
		});

		// ONE action context: no ⟳, no ×, no confirm/cancel — on ANY row.
		expect(countByPrefix(container, 'season-manage-event-convert-')).toBe(0);
		expect(countByPrefix(container, 'season-manage-event-delete-')).toBe(0);
		expect(countByPrefix(container, 'season-manage-series-delete-')).toBe(0);

		await fireEvent.click(q(container, 'event-convert-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		// Every button back, exactly as many as before.
		await waitFor(() => {
			expect(countByPrefix(container, 'season-manage-event-convert-')).toBe(2);
		});
		expect(countByPrefix(container, 'season-manage-event-delete-')).toBe(2);
		expect(countByPrefix(container, 'season-manage-series-delete-')).toBe(1);
	});

	it('a SUBMITTED form restores the buttons too — the run finishes, the form closes, the listed rows get their actions back', async () => {
		const container = await renderReady();
		await openConvertForm(container);

		await fill(container, 'event-convert-duration', '90');
		await fill(container, 'event-convert-end-date', '2027-06-30');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});

		// The panel's lists re-read after success; the (static) fixture still
		// lists ev-9 and series-1, so their actions must be rendered again.
		await waitFor(() => {
			expect(q(container, 'season-manage-event-convert-ev-9')).not.toBeNull();
		});
		expect(q(container, 'season-manage-event-delete-ev-9')).not.toBeNull();
		expect(q(container, 'season-manage-series-delete-series-1')).not.toBeNull();
	});
});

// ── i18n — the #196 keys exist, non-empty, in ALL FOUR locales ──────────────────

describe('locale parity — every #196 key present and non-empty in en/et/lv/uk', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const KEYS = [
		'event_create_series_hint',
		'season_manage_event_convert',
		'event_convert_form_label',
		'event_convert_interval_label',
		'event_convert_duration_label',
		'event_convert_end_date_label',
		'event_convert_submit',
		'event_convert_cancel',
		'event_convert_failed',
		// #196 review F1/F2 — the occurrence run and the per-field refusals.
		'event_convert_interval_required',
		'event_convert_duration_required',
		'event_convert_end_required',
		'event_convert_end_before_start',
		'event_convert_start_missing',
		// #196 review F1 — the two pre-write refusals say WHY, not "(read-event)".
		'event_convert_missing_name',
		'event_convert_missing_type',
		'event_convert_progress',
		'event_convert_generate_failed',
		'event_convert_resume_notice'
	] as const;

	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s carries every key, none empty', (locale) => {
		const file = messages(locale);
		for (const key of KEYS) {
			expect(isMessageEmpty(file[key]), `messages/${locale}.json: ${key}`).toBe(false);
		}
	});

	it.each(LOCALES)('%s: event_convert_failed keeps its {step} placeholder — the loud-failure pin', (locale) => {
		expect(everyPatternContains(messages(locale)['event_convert_failed'], '{step}')).toBe(true);
	});
});

// ── i18n — the #212 start-date label, present in ALL FOUR locales ───────────────

describe('#212 locale parity — event_convert_start_date_label present and non-empty in en/et/lv/uk', () => {
	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(['en', 'et', 'lv', 'uk'] as const)('%s carries the key, non-empty', (locale) => {
		expect(
			isMessageEmpty(messages(locale)['event_convert_start_date_label']),
			`messages/${locale}.json: event_convert_start_date_label`
		).toBe(false);
	});

	// Gama named the en/et copy in the #212 ruling; lv/uk stay Comenius's call.
	it('en reads "Starts", et reads "Algus" — the copy the #212 ruling pinned', () => {
		expect(messages('en')['event_convert_start_date_label']).toBe('Starts');
		expect(messages('et')['event_convert_start_date_label']).toBe('Algus');
	});
});

// (*MVOX:Tallis* — #196 RED: conversion page wiring + standalone hint + i18n keys;
//  #212 RED: start-date display + single-action-context mutual exclusion)
