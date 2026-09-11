// @vitest-environment happy-dom
//
// #244 RED — after a SUCCESSFUL event create: collapse the season panel and
// surface the new event on the agenda. Contract = issue #244 as AMENDED by
// Gama's last comment (issuecomment-5594475154), which replaced the body's
// collapse bullet:
//
//   - A successful create collapses the season panel ONLY when the created
//     event's row can actually be surfaced under the active type filter. If
//     the filter excludes it, the panel stays open and nothing else changes.
//   - No filter chip is written by the app, in either case.
//
// Everything else in the body stands: collapse only on SUCCESS (a failed
// create keeps the panel, the form and the error), never mid bulk-run
// (`seasonCardCollapseDisabled`'s condition — enforced by routing through
// `closeSeasonManagePanel()`, which re-checks `seriesRunUnfinished ||
// eventConvertRunUnfinished` itself), deliberate focus (never <body>), and
// scroll-and-transiently-mark the created row.
//
// NOTE ON THE ISSUE'S IDENTIFIERS — #261 removed the gear. The issue's
// `season-manage-gear` / `seasonManageGearDisabled` no longer exist; their
// successors (used throughout this suite) are `season-card-expand` /
// `season-card-collapse` / `seasonCardCollapseDisabled` /
// `closeSeasonManagePanel()`.
//
// RED-author decisions on the points the issue left open ("Not scoped
// further"):
//
//   THE MARK — a `data-testid="agenda-row-created-mark"` element rendered ON
//   or INSIDE the created event's agenda row (`agenda-row-{id}`), appearing
//   after a successful create and CLEARING on a setTimeout-driven timeout.
//   The clear is pinned under vitest fake timers (advance 15s), so the
//   timeout must be a real `setTimeout` and its duration at most 15s (pick
//   something humane, ~2-4s). A mark that never clears is a different bug —
//   the static `class:bg-highlight` day-group pattern is NOT the shape here.
//   The mark is DECORATIVE (the sr-only `event-create-status` live region
//   already announces the create — #132/T4 review F3), so it carries no new
//   copy and no new i18n keys. If GREEN does add visible copy anywhere, the
//   four-bundle rule applies (messages/{en,et,lv,uk}.json, snake_case
//   `<domain>_<subject>[_<detail>]`).
//
//   FOCUS — two cases, one deliberate landing spot each, never <body>:
//     collapsed  → the collapsed card's own `season-card-expand` button, i.e.
//                  exactly where `closeSeasonManagePanel()` already lands
//                  focus (#261). `restoreEventCreateFocus`'s panel-focus must
//                  NOT win this race: the panel is unmounting.
//     stayed open (filter excludes the type) → the panel itself
//                  (`season-manage-panel`), today's `restoreEventCreateFocus`
//                  behaviour, kept on purpose.
//
//   OUT OF SCOPE — a VISIBLE create confirmation. `event-create-status` is
//   sr-only and that gap is #298, filed separately. Nothing here may grow a
//   toast/notification pattern.
//
// Harness: the page.event-create.spec.ts family — real +page.svelte, real
// AgendaList, only the data seams mocked.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lenient message mock — structural assertions only; every key renders as
// itself (callable with params).
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => {
				const k = String(key);
				if (k === 'event_created')
					return (p: { name: string; when: string }) => `event_created ${p.name} @ ${p.when}`;
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
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
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
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: listSectionsMock
}));
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
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllEditions: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { fillDateTime } from '$lib/testing/timeControls';
import type { AgendaItem } from '$lib/agenda/types';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { setAgendaView } from '$lib/preferences/agendaView';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';
const NEW_EVENT_ID = 'ev-new-1';
const CREATED_MARK = 'agenda-row-created-mark';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function season(): Season {
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

function item(id: string, name: string, startDatetime: string, eventType: string): AgendaItem {
	return {
		id,
		name,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType
	} as AgendaItem;
}

// Far-future upcoming dates (the agenda-filter spec convention): AgendaList's
// relative-day decoration reads the real clock, so the fixtures stay ahead of
// it. One rehearsal + one concert so BOTH chips exist before the create.
const UP_REHEARSAL = item('up-reh', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const UP_CONCERT = item('up-con', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');
// What the create makes: the form below fills 2030-07-01 19:00 Tallinn
// (= 16:00 UTC in July, but the row's exact instant is irrelevant here).
const NEW_ROW = item(NEW_EVENT_ID, 'Uus kontsert', '2030-07-01T16:00:00.000Z', 'concert');

/** The world flips when createEvent lands: reloads AFTER a successful create
 *  include the new event's row, exactly as the real backend would. */
let worldHasNewEvent = false;

function agendaWorld() {
	return fullAgendaResult({
		upcoming: worldHasNewEvent ? [UP_REHEARSAL, UP_CONCERT, NEW_ROW] : [UP_REHEARSAL, UP_CONCERT],
		seasons: [season()]
	});
}

function fixtureRows(): RosterRow[] {
	return [
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
	worldHasNewEvent = false;
	loadFullAgendaMock.mockImplementation(async () => agendaWorld());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	createEventMock.mockImplementation(async () => {
		worldHasNewEvent = true;
		return NEW_EVENT_ID;
	});
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(null);
});

afterEach(() => {
	vi.useRealTimers();
	// `agendaViewStore` is a module-level store: a test that switched to month
	// mode would otherwise leak that choice into every test after it.
	setAgendaView('list');
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
		expect(q(container, 'agenda-skeleton')).toBeNull();
		expect(q(container, 'season-card-expand')).not.toBeNull();
		expect(q(container, `agenda-row-${UP_REHEARSAL.id}`)).not.toBeNull();
	});
	return container as HTMLElement;
}

async function openFormFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
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

/** A valid standalone CONCERT create — season prefilled from the panel. */
async function fillConcert(container: HTMLElement): Promise<void> {
	await selectValue(container, 'event-create-type', 'concert');
	await fillDateTime(container, 'event-create-datetime', '2030-07-01', '19:00');
	await fill(container, 'event-create-name', 'Uus kontsert');
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
}

/** Record receiver + options of every scrollIntoView (AttendanceSurface.scroll
 *  precedent) — a bare call count would pass a scroll of the wrong element. */
function spyScroll() {
	const calls: Array<{ el: Element; arg: boolean | ScrollIntoViewOptions | undefined }> = [];
	vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
		this: Element,
		arg?: boolean | ScrollIntoViewOptions
	) {
		calls.push({ el: this, arg });
	});
	return calls;
}

/** Scroll calls whose receiver sits ON or INSIDE the created event's row. */
function rowScrolls(calls: Array<{ el: Element }>): Array<{ el: Element }> {
	return calls.filter((c) => c.el.closest(`[data-testid="agenda-row-${NEW_EVENT_ID}"]`) !== null);
}

/** Flush the microtask queue several turns — every mock resolves immediately,
 *  so this settles the whole submit → reload → tick cascade without timers
 *  (needed where fake timers make waitFor unusable). */
async function settleMicro(turns = 20): Promise<void> {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

/** Hold the NEXT `loadFullAgenda()` open until the returned release is called.
 *
 *  #244 review F1 — the focus assertions below are meaningless without this.
 *  Every mock here resolves within microtasks, so a post-create reload lands
 *  before any `tick()` fires and a collapse-then-focus that only works because
 *  of that ordering passes anyway. With a real round trip in the window, a
 *  collapse decided before the reload lands unmounts the whole
 *  `agenda-admin-card` (`resetManagement()` has already blanked
 *  `manageableSeasonRights`, so `showSeasonCard` is false and
 *  `seasonManageOpen` was the only thing holding it up) and strands focus on
 *  <body>. */
function deferNextAgendaReload(): () => void {
	let release!: () => void;
	const gate = new Promise<void>((r) => {
		release = r;
	});
	let armed = true;
	loadFullAgendaMock.mockImplementation(async () => {
		if (armed) {
			armed = false;
			await gate;
		}
		return agendaWorld();
	});
	return release;
}

/** Active filter pin: which chip is pressed, straight off aria-pressed. */
function pressedChips(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid^="agenda-filter-"]'))
		.filter((el) => el.getAttribute('aria-pressed') === 'true')
		.map((el) => el.getAttribute('data-testid') as string);
}

// ── 1. collapse on success — when the agenda can show the result ────────────────

describe('#244 — a successful create collapses the season panel (filter admits the type)', () => {
	it('filter = All: the panel unmounts and the collapsed card returns; the created row is on the agenda', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fillConcert(container);
		await submit(container);

		await waitFor(() => {
			expect(
				q(container, 'season-manage-panel'),
				'the editor has done its job — after a successful create it must get out of the way'
			).toBeNull();
		});
		expect(q(container, 'season-card-expand'), 'the collapsed card is the way back').not.toBeNull();
		// The result the collapse exists to uncover:
		await waitFor(() => {
			expect(q(container, `agenda-row-${NEW_EVENT_ID}`)).not.toBeNull();
		});
		// No filter chip was written: All is still the pressed chip.
		expect(pressedChips(container)).toEqual(['agenda-filter-all']);
		expect(createEventMock).toHaveBeenCalledTimes(1);
	});

	it('an ACTIVE chip that admits the created type also collapses (filter = concert, create concert) — and the chip is untouched', async () => {
		const container = await renderReady();
		await fireEvent.click(q(container, 'agenda-filter-concert') as HTMLElement);
		await waitFor(() => {
			expect(q(container, `agenda-row-${UP_REHEARSAL.id}`)).toBeNull();
		});

		await openFormFromPanel(container);
		await fillConcert(container);
		await submit(container);

		await waitFor(() => {
			expect(
				q(container, 'season-manage-panel'),
				'admitted-by-the-active-chip is admitted — "showable" is not filter === all'
			).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, `agenda-row-${NEW_EVENT_ID}`)).not.toBeNull();
		});
		// The concert chip the USER pressed is still the pressed one; the
		// rehearsal row is still filtered out — nothing rewrote the filter.
		expect(pressedChips(container)).toEqual(['agenda-filter-concert']);
		expect(q(container, `agenda-row-${UP_REHEARSAL.id}`)).toBeNull();
	});

	it('focus lands on the collapsed card’s own expand control — never <body>, and never the unmounting panel', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fillConcert(container);
		// #244 review F1 — a REAL round trip in the reload window, not the
		// microtask-ordering luck every other mock here provides.
		const release = deferNextAgendaReload();
		await submit(container);

		// In flight: the create landed and the form is gone, but the agenda has
		// not come back yet. `resetManagement()` already blanked
		// `manageableSeasonRights`, so `showSeasonCard` is false and
		// `seasonManageOpen` is the ONLY thing holding the card up — collapsing
		// here would unmount the card, the `season-card-expand` that
		// `closeSeasonManagePanel()` focuses would not exist, and focus would
		// sit on <body> for the whole round trip (and stay there).
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await settleMicro();
		// The gate is genuinely holding — without these the in-flight
		// assertions below would be a post-reload snapshot wearing a costume.
		expect(loadFullAgendaMock, 'the post-create reload was issued').toHaveBeenCalledTimes(2);
		expect(
			q(container, `agenda-row-${NEW_EVENT_ID}`),
			'…and has NOT landed yet: the created row is not on the agenda'
		).toBeNull();
		expect(
			q(container, 'agenda-admin-card'),
			'the season card must not vanish for the length of the post-create reload'
		).not.toBeNull();
		expect(
			q(container, 'season-manage-panel'),
			'nothing is uncovered yet — the panel stays until the created row is actually there'
		).not.toBeNull();
		expect(document.activeElement, 'focus dropped to <body> mid-reload').not.toBe(document.body);
		expect(
			document.activeElement?.getAttribute('data-testid'),
			'the still-open panel holds focus while the reload is in flight'
		).toBe('season-manage-panel');

		release();

		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
			expect(q(container, `agenda-row-${NEW_EVENT_ID}`)).not.toBeNull();
		});
		// The deliberate landing spot for the collapsed case is exactly where
		// closeSeasonManagePanel() already lands focus (#261): the expand
		// button — which exists precisely because the collapse waited for the
		// reload that restored the card's rights.
		await waitFor(() => {
			const active = document.activeElement;
			expect(active, 'focus dropped to <body>').not.toBe(document.body);
			expect(
				active?.getAttribute('data-testid'),
				'the collapsed case focuses season-card-expand'
			).toBe('season-card-expand');
		});
	});

});

// ── 2. surface the row: scroll + transient mark ────────────────────────────────

describe('#244 — the created row is scrolled into view and transiently marked', () => {
	it('scrollIntoView fires with the created row (agenda-row-ev-new-1) as its receiver', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fillConcert(container);
		const calls = spyScroll();
		await submit(container);

		await waitFor(() => {
			expect(q(container, `agenda-row-${NEW_EVENT_ID}`)).not.toBeNull();
			expect(
				rowScrolls(calls).length,
				'the created row must be scrolled into view — the collapse justifies itself by showing the result'
			).toBeGreaterThan(0);
		});
	});

	it('the mark appears on the created row and CLEARS on a timeout (≤ 15s, setTimeout-driven) — the row itself stays', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fillConcert(container);

		// Timers faked from the submit on, so the clear timeout is advanceable.
		// Everything else in the cascade is microtasks (all mocks resolve
		// immediately) — settled by hand, since waitFor needs real timers.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		await submit(container);
		await settleMicro();
		await vi.advanceTimersByTimeAsync(50); // any zero-ish deferrals, far below a humane highlight duration
		await settleMicro();

		const row = q(container, `agenda-row-${NEW_EVENT_ID}`);
		expect(row, 'the created row renders after the post-create reload').not.toBeNull();
		const mark = q(container, CREATED_MARK);
		expect(mark, 'the just-created mark renders after a successful create').not.toBeNull();
		expect(
			(mark as HTMLElement).closest(`[data-testid="agenda-row-${NEW_EVENT_ID}"]`),
			'the mark sits ON or INSIDE the created row — it marks THIS event, not the list'
		).not.toBeNull();

		await vi.advanceTimersByTimeAsync(15_000);
		await settleMicro();
		expect(
			q(container, CREATED_MARK),
			'the mark is TRANSIENT — a highlight that never clears is a different bug'
		).toBeNull();
		expect(q(container, `agenda-row-${NEW_EVENT_ID}`), 'only the mark clears').not.toBeNull();
	});
});

// ── 3. the amendment: the filter excludes the type → the panel stays open ──────

describe('#244 amendment — when the active filter excludes the created type, the panel stays open and nothing else changes', () => {
	it('filter = rehearsal, create concert: the panel STAYS, the form closes, no row, no scroll, no mark, no filter write', async () => {
		const container = await renderReady();
		await fireEvent.click(q(container, 'agenda-filter-rehearsal') as HTMLElement);
		await waitFor(() => {
			expect(q(container, `agenda-row-${UP_CONCERT.id}`)).toBeNull();
		});

		await openFormFromPanel(container);
		await fillConcert(container);
		const calls = spyScroll();
		await submit(container);

		// The form still closes on success (pre-#244 contract, untouched)…
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(1);
		// …but the panel does NOT collapse: with the row filtered out there is
		// no uncovered result, so the collapse's premise fails. Collapsing here
		// would remove the one thing still on screen.
		expect(
			q(container, 'season-manage-panel'),
			'no result to uncover → the panel stays open'
		).not.toBeNull();

		// Let any late collapse/scroll that WOULD have landed run before
		// pinning the absences (the event-create.spec flush idiom).
		await new Promise((r) => setTimeout(r, 0));
		await settleMicro();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		// Nothing else changes:
		expect(q(container, `agenda-row-${NEW_EVENT_ID}`), 'the row stays filtered out').toBeNull();
		expect(rowScrolls(calls), 'nothing scrolls toward a row that is not there').toEqual([]);
		expect(q(container, CREATED_MARK), 'no mark without a row').toBeNull();
		// And — the amendment's second bullet — no filter chip was written:
		// the user's rehearsal chip is still the pressed one, the concert row
		// (pre-existing) is still hidden, the rehearsal row still shows.
		expect(pressedChips(container)).toEqual(['agenda-filter-rehearsal']);
		expect(q(container, `agenda-row-${UP_CONCERT.id}`)).toBeNull();
		expect(q(container, `agenda-row-${UP_REHEARSAL.id}`)).not.toBeNull();
	});

	it('stayed-open focus is deliberate too: the panel keeps focus (today’s restoreEventCreateFocus outcome) — never <body>', async () => {
		const container = await renderReady();
		await fireEvent.click(q(container, 'agenda-filter-rehearsal') as HTMLElement);
		await openFormFromPanel(container);
		await fillConcert(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			const active = document.activeElement;
			expect(active, 'focus dropped to <body>').not.toBe(document.body);
			expect(
				active?.getAttribute('data-testid'),
				'the stayed-open case keeps focus on the panel'
			).toBe('season-manage-panel');
		});
	});
});

// ── 4. only on SUCCESS — a failed create changes nothing ───────────────────────

describe('#244 — a failed create leaves the panel open, the form intact and the error visible', () => {
	it('createEvent rejects: no collapse, no scroll, no mark — collapsing would hide the error', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromPanel(container);
		await fillConcert(container);
		const calls = spyScroll();
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-form'), 'the form stays open with its state').not.toBeNull();
		expect(q(container, 'season-manage-panel'), 'a failure never collapses').not.toBeNull();
		await new Promise((r) => setTimeout(r, 0));
		await settleMicro();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(rowScrolls(calls)).toEqual([]);
		expect(q(container, CREATED_MARK)).toBeNull();
		expect(pressedChips(container)).toEqual(['agenda-filter-all']);
	});
});

// ── 4b. review fixes: the collapse follows the ROW, in every view ──────────────

describe('#244 review F2 — month mode is a persisted view choice, and gets the same surfacing', () => {
	it('the created event’s MONTH row is scrolled into view and marked, and the panel still collapses', async () => {
		const container = await renderReady();
		await fireEvent.click(q(container, 'agenda-view-month') as HTMLElement);
		await waitFor(() => {
			expect(q(container, `agenda-month-row-${UP_REHEARSAL.id}`)).not.toBeNull();
			expect(q(container, `agenda-row-${UP_REHEARSAL.id}`)).toBeNull();
		});

		await openFormFromPanel(container);
		await fillConcert(container);
		const calls = spyScroll();
		await submit(container);

		const monthRow = `[data-testid="agenda-month-row-${NEW_EVENT_ID}"]`;
		await waitFor(() => {
			expect(q(container, `agenda-month-row-${NEW_EVENT_ID}`)).not.toBeNull();
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		// The scroll targets the row that ACTUALLY exists in this view — the
		// day list's `agenda-row-{id}` is not rendered at all here, so a
		// list-only query would have found nothing and scrolled nowhere.
		await waitFor(() => {
			expect(
				calls.filter((c) => c.el.closest(monthRow) !== null).length,
				'the created month row must be scrolled into view'
			).toBeGreaterThan(0);
		});
		const mark = q(container, CREATED_MARK);
		expect(mark, 'the mark renders in month mode too').not.toBeNull();
		expect(
			(mark as HTMLElement).closest(monthRow),
			'the mark sits ON or INSIDE the created MONTH row'
		).not.toBeNull();
	});
});

describe('#244 review F3 — a create whose row is never listed must not collapse over nothing', () => {
	it('the type filter admits it but the reload lists it nowhere: the panel stays, no scroll, no mark', async () => {
		// The amendment's own case, reached without a filter: `listFullAgenda`
		// builds `upcoming` from FUTURE events and `recent` from the CURRENT
		// season only (empty outright when no season is current), so a
		// past-dated create in a non-current season is listed in neither. The
		// filter is All and admits the type — which is exactly why deciding the
		// collapse from the TYPE alone collapsed the panel over an empty
		// agenda, removing the last thing on screen.
		createEventMock.mockImplementation(async () => NEW_EVENT_ID);
		const container = await renderReady();
		await openFormFromPanel(container);
		await fillConcert(container);
		const calls = spyScroll();
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(1);
		// Let every late collapse/scroll that WOULD have landed run first.
		await new Promise((r) => setTimeout(r, 0));
		await settleMicro();
		expect(
			q(container, `agenda-row-${NEW_EVENT_ID}`),
			'the reload genuinely does not list the created event'
		).toBeNull();
		expect(
			q(container, 'season-manage-panel'),
			'nothing to uncover → the panel stays open'
		).not.toBeNull();
		expect(rowScrolls(calls), 'nothing scrolls toward a row that is not there').toEqual([]);
		expect(q(container, CREATED_MARK), 'no mark without a row').toBeNull();
		expect(
			document.activeElement?.getAttribute('data-testid'),
			'and focus stays deliberate on the still-open panel'
		).toBe('season-manage-panel');
	});
});

// ── 5. structural pins: the route, and the filter-write absence ────────────────
//
// CONDITION 3 (never mid-run) cannot be driven end-to-end through this page's
// UI in a single collective: while a bulk series/conversion run is unfinished,
// `createEntryPointsBlocked` refuses opening the event-create form at all, and
// the creation forms are mutually exclusive — so "an event create succeeds
// while a run is unfinished" has no single-db UI choreography, and the cross-db
// resume choreography (#138) does not discriminate end states (the restored
// run re-opens the panel either way). The enforceable pin is therefore the
// ROUTE: the success path must collapse via `closeSeasonManagePanel()`, whose
// own `seriesRunUnfinished || eventConvertRunUnfinished` re-check (already
// behaviourally pinned mid-run by page.season-card.spec.ts) refuses tearing
// down the panel that is showing a run's progress — and must NOT flip
// `seasonManageOpen` by hand, which would route around that refusal exactly
// as the issue forbids. Source-scan structural pins are the house idiom for
// sole-path guarantees (src/lib/testing/soleLiteralGuard.ts family).

const PAGE_SOURCE = () => readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf-8');

/** These pins forbid identifiers that the surrounding DOC COMMENTS name on
 *  purpose (they explain why the call does not belong there), so every scan
 *  below runs on CODE only — a pin a comment can flip is not a pin. */
function stripComments(body: string): string {
	return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function submitEventCreateBody(source: string): string {
	const start = source.indexOf('async function submitEventCreate');
	expect(start, 'submitEventCreate exists in +page.svelte').toBeGreaterThan(-1);
	const end = source.indexOf('$effect(', start);
	expect(end, 'a bounded slice for the create path').toBeGreaterThan(start);
	return stripComments(source.slice(start, end));
}

/** The collapse's home after #244 review F1/F3: the watcher that waits for the
 *  created row to actually render. The pin FOLLOWED it — the guarantee has
 *  always been about the ROUTE (`closeSeasonManagePanel()` is the one owner of
 *  the mid-run refusal), never about which function the call sits in. */
function surfaceWatcherBody(source: string): string {
	const start = source.indexOf('function surfaceCreatedEvent');
	expect(start, 'surfaceCreatedEvent exists in +page.svelte').toBeGreaterThan(-1);
	const end = source.indexOf('/** Cancel / Escape:', start);
	expect(end, 'a bounded slice for the surfacing watcher').toBeGreaterThan(start);
	return stripComments(source.slice(start, end));
}

describe('#244 — structural: the collapse routes through closeSeasonManagePanel(), and the create path never writes the filter', () => {
	it('the collapse calls closeSeasonManagePanel() — the ONE owner of the mid-run refusal — and nothing on either path assigns seasonManageOpen directly', () => {
		const source = PAGE_SOURCE();
		const watcher = surfaceWatcherBody(source);
		expect(
			watcher.includes('closeSeasonManagePanel('),
			'the auto-collapse must route through closeSeasonManagePanel(), inheriting its seriesRunUnfinished || eventConvertRunUnfinished refusal'
		).toBe(true);
		for (const [label, body] of [
			['the surfacing watcher', watcher],
			['the create path', submitEventCreateBody(source)]
		] as const) {
			expect(
				/seasonManageOpen\s*=[^=]/.test(body),
				`a direct seasonManageOpen assignment in ${label} would route around the mid-run refusal`
			).toBe(false);
		}
	});

	it('the create path arms the surfacing watcher instead of collapsing on the spot (review F1/F3)', () => {
		const body = submitEventCreateBody(PAGE_SOURCE());
		expect(
			body.includes('surfaceCreatedEvent('),
			'the create path hands the decision to the watcher that observes the row'
		).toBe(true);
		// A synchronous collapse here is the regression itself: `resetManagement()`
		// has already blanked `manageableSeasonRights`, so the whole
		// `agenda-admin-card` unmounts for the length of the reload and focus is
		// stranded on <body> — and the collapse would be decided from the created
		// event's TYPE, which does not imply the row gets listed at all.
		expect(
			body.includes('closeSeasonManagePanel('),
			'the create path must NOT collapse before the created row is observed'
		).toBe(false);
	});

	it('the create path never assigns agendaTypeFilter, and the page gains no new write site for it', () => {
		const source = PAGE_SOURCE();
		expect(
			/agendaTypeFilter\s*=[^=]/.test(submitEventCreateBody(source)),
			'the create path must READ the filter to decide showability, never write it'
		).toBe(false);
		// The five existing `agendaTypeFilter =` sites are all legitimate:
		// the $state declaration, the user's own chip toggle
		// (selectAgendaTypeFilter), the vanished-chip auto-reset $effect, and
		// the two collective-switch / no-agenda resets. None narrows the
		// filter to fit a new event, and per the #244 ruling this path must
		// not become the first — so the write-site count is pinned. A future
		// LEGITIMATE reset may bump this number consciously, with its reason.
		const writes = source.match(/agendaTypeFilter\s*=[^=]/g) ?? [];
		expect(writes.length, 'no new agendaTypeFilter write site').toBe(5);
	});
});

// (*MVOX:Tallis* — #244 RED: collapse-on-success gated by the amendment's
// showability condition, scroll + transient mark on the created row, deliberate
// focus both ways, and the no-filter-write / closeSeasonManagePanel-route
// structural pins)
