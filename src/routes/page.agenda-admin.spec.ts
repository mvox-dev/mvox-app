// @vitest-environment happy-dom
//
// #132/T6 RED — agenda admin controls: the wiring + consistency pass, on the
// ACTUAL agenda route (integration: real +page.svelte, real AgendaList, real
// manageRightsFrom; only the data seams are mocked — same
// harness family as page.season-create.spec.ts / page.event-create.spec.ts /
// page.series-create.spec.ts).
//
// WHY (#132): T2–T5 each added ONE admin affordance in isolation. T6 is the
// pass that verifies they behave as ONE admin surface: the three entry points
// gate consistently and fail closed together, only one creation form is ever
// open at a time, every successful create refreshes the agenda, and the whole
// surface holds up on a 375px phone.
//
// Pinned wiring contract (GREEN must implement):
//
//   ENTRY POINTS (#213 redesign — the toolbar is DOWN TO TWO members)
//     season-manage-gear   [⚙] right-aligned (ml-auto); a TOGGLE — first click
//                          opens season-manage-panel, second click closes it
//                          (the panel's internal season-manage-close button is
//                          GONE). The gear carries aria-expanded +
//                          aria-controls and inherits the close refusal: it
//                          renders DISABLED while a bulk run is unfinished
//                          (seriesRunUnfinished || eventConvertRunUnfinished —
//                          Gama ruling (1) on #213, the createEntryPointsBlocked
//                          precedent), and ONLY then: a merely in-flight
//                          season/event create does not disable it.
//     season-create        [+ Season] on the agenda → season-create-form (T2,
//                          gate UNCHANGED by #213)
//     event-create         REMOVED at page level by #213 — event creation
//                          lives inside the panel (season-manage-add-event)
//     Both survivors are page-level (never inside an agenda row) and
//     rights-gated as before. A non-editor gets NEITHER — absent from the DOM,
//     not hidden or disabled (fail-closed, #91 discipline). A rights/agenda
//     load ERROR is not a grant.
//     SPIKE finding on Gama ruling (2): the DEFAULT state (a current season
//     running, nothing queued behind it, viewer its editor) renders BOTH the
//     gear and [+ Season] at once, so the role="toolbar" + roving-tabindex
//     frame (#156) is NOT degenerate and is KEPT, at arity 2.
//
//   ONE CREATION FORM AT A TIME
//     season-create-form, event-create-form and series-create-form are
//     mutually exclusive: opening any one CLOSES whichever other was open.
//     The season-manage PANEL is a management surface, not a creation form —
//     it coexists with creation forms (a panel-born event form keeps its
//     panel; T4's contract, held to here).
//
//   REFRESH AFTER EVERY SUCCESSFUL CREATE
//     season create  → loadFullAgenda re-invoked (T2, held to here)
//     event create   → loadFullAgenda re-invoked (T4, held to here)
//     series create  → loadFullAgenda re-invoked — INCLUDING the generation-OFF
//                      series-only path (NEW: today only the panel's lists
//                      re-read; the agenda-refresh discipline must be uniform),
//                      and the panel it was born in survives the refresh.
//
//   MOBILE (375px) — class contract, because happy-dom computes no layout:
//     a real 375px scroll measurement needs a browser; what a unit test CAN
//     pin is the Tailwind contract that layout correctness follows from.
//     - TOUCH TARGETS: every admin control is at least 44x44px — Tailwind
//       `min-h-11` (2.75rem = 44px) on every admin button, plus `min-w-11` on
//       the icon-only ones (gear, panel close), whose text content is too
//       narrow to reach 44px on its own.
//       SCOPE, decided in #136 (fix shape option 2) and pinned here so the next
//       reader does not read the gap as an oversight: the contract covers every
//       admin BUTTON (#209 retired the Autocomplete and its `role="option"`
//       rows — every person picker is a native <select> now, whose option
//       touch targets are the platform's concern) — plus the one
//       CHECKBOX ROW (a checkbox's own 13px box is not sizable by a height
//       utility, so the floor rides on the <label> wrapping it — that label IS
//       the click target). Text inputs, selects and
//       textareas are DELIBERATELY EXEMPT: they stay at `px-1.5 py-1 text-xs`
//       (~28px). They are not tap-to-act controls — a mistap lands the caret
//       instead of firing an action, so the WCAG 2.5.5 rationale (undo cost)
//       does not bite, and floors on ~10 fields would add ~160px of height to
//       the series form alone. What DOES cover them is the fluid-width contract
//       immediately below.
//     - NO HORIZONTAL OVERFLOW: every field (input/select/textarea, checkboxes
//       exempt — they are intrinsically small) inside each creation form is
//       FLUID — carries `w-full`, `flex-1` or `min-w-0` — so no intrinsic
//       width (date/datetime controls are the notorious ones) can floor the
//       form wider than the ~343px a 375px viewport leaves inside the page
//       padding. And NO element in any form subtree carries a fixed pixel
//       width class of 344px or more.
import { render, cleanup, createEvent, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
	createSeasonMock,
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
	listSectionsMock: vi.fn(),
	createSeasonMock: vi.fn(),
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
// T1's write layer — the ONE create seam for all three entity kinds.
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: createEventSeriesMock,
	createEvent: createEventMock
}));
// T3/T4's season-panel read/write seams.
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
// Only the ONE entity-rights round-trip is stubbed (`manageRightsFrom` and every
// other helper stays real) — the empty-collective season-create fallback would
// otherwise be a live request from a unit test.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
// #209 — the section tree behind roster-ordered person selects; only the
// NETWORK read is stubbed (groupBySection stays real).
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
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { fillDateTime, fillTime } from '$lib/testing/timeControls';
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

/** The CURRENT season: running now, no upcoming one — the one fixture where
 *  ALL THREE entry points may render for an editor. */
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

function agendaResult(opts: { editor?: boolean; conductors?: string[] } = {}) {
	const { editor = true, conductors = [] } = opts;
	const season = { ...currentSeason(editor), conductors };
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

/** NO season at all — the only state whose season-create gate needs the
 *  organization-rights round-trip (and the only place its 'error' can leak). */
function noSeasonsResult() {
	return fullAgendaResult();
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
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
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
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventSeriesMock.mockResolvedValue('series-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue(seriesFixture());
	listEventsForSeasonMock.mockResolvedValue([]);
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: null
	});
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	createSeasonMock.mockReset();
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

/** Every admin control/surface this pass is about — the fail-closed sweeps
 *  assert ALL of them absent, so a new leak cannot slip past one-by-one checks. */
const ADMIN_TESTIDS = [
	'agenda-admin-card', // #222 — the ONE bordered card wrapping header row + panel
	'season-manage-gear',
	'season-manage-label', // #222 — visible 'Manage season' text beside the gear
	'season-manage-panel',
	'season-manage-repertoire', // #234 — the panel's season-repertoire section
	'season-create',
	'season-create-form',
	'event-create',
	'event-create-form',
	'series-create-form'
] as const;

function expectNoAdminControls(container: HTMLElement): void {
	for (const testid of ADMIN_TESTIDS) {
		expect(q(container, testid), `${testid} must be ABSENT from the DOM (fail-closed)`).toBeNull();
	}
}

async function openSeasonForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-create-form')).not.toBeNull();
	});
}

/** #213 — the page-level [+ Event] is GONE; the ONLY way into the event form
 *  is the panel's own [+ Event] (season-manage-add-event). */
async function openEventFormFromPanel(container: HTMLElement): Promise<void> {
	if (!q(container, 'season-manage-panel')) await openPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

async function openPanel(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
}

/** Open the panel (if not already open), then the [+ Series] form inside it. */
async function openSeriesForm(container: HTMLElement): Promise<void> {
	if (!q(container, 'season-manage-panel')) await openPanel(container);
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

/** #209 — pick a roster person in the NATIVE conductor <select> inside `scope`
 *  (a form, or the conductor FIELD). Changing the select to the person id adds
 *  the chip and the select resets to its prompt. */
async function addConductorChip(scope: HTMLElement, personId: string): Promise<void> {
	const select = scope.querySelector(
		'select[data-testid$="-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'the scope must contain a native conductor select').not.toBeNull();
	await fireEvent.change(select, { target: { value: personId } });
}

/** Minimal VALID season-create fill. */
async function fillValidSeason(container: HTMLElement): Promise<void> {
	await fill(container, 'season-create-name', 'Autumn 2026');
	await fill(container, 'season-create-start', '2026-09-01');
	await fill(container, 'season-create-end', '2026-12-20');
}

/** Minimal VALID event-create fill: season, type (#199: the canonical
 *  <select> — 'rehearsal' is already its default, kept explicit here for
 *  readability), start, name (standalone events need one). */
async function fillValidEvent(container: HTMLElement): Promise<void> {
	await selectValue(container, 'event-create-season', SEASON_ID);
	await selectValue(container, 'event-create-type', 'rehearsal');
	await fillDateTime(container, 'event-create-datetime', '2026-09-15', '19:00');
	await fill(container, 'event-create-name', 'Extra rehearsal');
}

/** Minimal VALID series-only fill (generation stays OFF — its default). */
async function fillValidSeries(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
}

// ── entry point consistency: one surface, three doors, one gate ─────────────────

describe('agenda admin — the entry points render together for a season editor (#213: two, not three)', () => {
	it('[⚙] + [+ Season] render, each page-level (never inside an agenda row); the page-level [+ Event] is GONE; merely rendering writes NOTHING', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
			expect(q(container, 'season-create')).not.toBeNull();
		});
		// #213 — the standalone [+ Event] button no longer exists for ANYONE;
		// event creation lives inside the panel (season-manage-add-event).
		expect(q(container, 'event-create')).toBeNull();

		for (const testid of ['season-manage-gear', 'season-create']) {
			const control = q(container, testid) as HTMLElement;
			expect(control.closest('[data-testid^="agenda-row-"]'), testid).toBeNull();
			expect(control.closest('[data-testid^="agenda-recent-row-"]'), testid).toBeNull();
		}

		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		// No surface pre-opened either.
		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it('each entry point opens ITS surface: gear → panel (and the gear again CLOSES it — no internal close button any more), [+ Season] → season form — all inline, no navigation, still nothing written', async () => {
		const container = await renderReady();

		await openPanel(container);
		// #213 — the panel carries NO internal close button; the gear is the
		// close control.
		expect(q(container, 'season-manage-close')).toBeNull();
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openEventFormFromPanel(container);
		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		// Leave the panel again so the season-form leg starts from the base state.
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openSeasonForm(container);
		await fireEvent.click(q(container, 'season-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});

		expect(gotoMock).not.toHaveBeenCalled();
		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

// ── #213 — the gear is a TOGGLE (disclosure pattern) ────────────────────────────
//
// One button opens AND closes the panel. The button never unmounts on open (it
// is the close control now), announces its state via aria-expanded, and names
// the surface it controls via aria-controls. Closing through the gear honours
// the SAME refusal guards closeSeasonManagePanel always had — pinned further
// down with the mid-run blocks.

describe('agenda admin — #213: the gear toggles the season-manage panel', () => {
	it('the gear is a native <button type="button"> and announces its state: aria-expanded false while closed, true while open', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		const gear = q(container, 'season-manage-gear') as HTMLButtonElement;

		expect(gear.tagName).toBe('BUTTON');
		expect(gear.getAttribute('type')).toBe('button');
		expect(gear.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(gear);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).not.toBeNull();
		});
		expect(gear.getAttribute('aria-expanded')).toBe('true');
	});

	it('aria-controls names the panel: while open, the id it points at IS the season-manage-panel element', async () => {
		const container = await renderReady();
		await openPanel(container);

		const gear = q(container, 'season-manage-gear') as HTMLButtonElement;
		const controlsId = gear.getAttribute('aria-controls');
		expect(controlsId, 'the gear must declare aria-controls').toBeTruthy();
		const target = container.querySelector(`[id="${controlsId}"]`);
		expect(target, 'aria-controls must resolve to an element').not.toBeNull();
		expect((target as HTMLElement).getAttribute('data-testid')).toBe('season-manage-panel');
	});

	it('a second click CLOSES the panel (aria-expanded back to false); the gear survives its own click and keeps focus; nothing was written', async () => {
		const container = await renderReady();
		await openPanel(container);

		const gear = q(container, 'season-manage-gear') as HTMLButtonElement;
		await fireEvent.click(gear);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		// The gear does NOT unmount on close (unlike the old ×) — same element,
		// state flipped back.
		expect(q(container, 'season-manage-gear')).toBe(gear);
		expect(gear.getAttribute('aria-expanded')).toBe('false');
		// Focus ends on the gear — the behavior the old close path already had
		// (closeSeasonManagePanel refocuses the gear), kept through the toggle.
		expect(document.activeElement).toBe(gear);

		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the gear STAYS rendered while the panel is open — it is the only close control left', async () => {
		const container = await renderReady();
		await openPanel(container);

		expect(q(container, 'season-manage-gear')).not.toBeNull();
		expect(
			q(container, 'season-manage-close'),
			'#213 removed the panel-internal close button'
		).toBeNull();
	});

	it('Escape on the panel STILL closes it (unchanged by #213) and the gear reports closed again', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});

		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		const gear = q(container, 'season-manage-gear') as HTMLButtonElement;
		expect(gear.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(gear);
	});

	it('toggle round-trip: open → close → open again lands a fresh, working panel', async () => {
		const container = await renderReady();
		await openPanel(container);
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
			expect(q(container, 'season-manage-add-series')).not.toBeNull();
		});
	});
});

// ── #149 — the entry points share ONE toolbar frame ────────────────────────────
//
// #132/T6 above pins that each control EXISTS and is page-level (not inside an
// agenda row) — which passes identically whether the two sit in one toolbar or
// in two loose divs. #149 is exactly the difference those tests cannot see, so
// it gets its own pins: one shared frame (parentElement identity), the class
// contract the layout follows from (happy-dom computes no layout), no empty
// frame for a non-editor, and the frame surviving with the sibling that remains
// while one control's form is open. #213 reshapes the frame: exactly TWO
// members at most ([⚙] + [+ Season]) and the gear is RIGHT-ALIGNED (ml-auto).

const TOOLBAR = 'agenda-admin-toolbar';

describe('agenda admin — #149/#213: the entry points live in one shared admin toolbar', () => {
	it('[⚙] and [+ Season] are DIRECT children of the same agenda-admin-toolbar element — and they are ALL of its buttons', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, TOOLBAR)).not.toBeNull();
		});
		const toolbar = q(container, TOOLBAR) as HTMLElement;

		for (const testid of ['season-manage-gear', 'season-create']) {
			const control = q(container, testid) as HTMLElement;
			expect(control, testid).not.toBeNull();
			expect(
				control.parentElement,
				`${testid} must sit INSIDE the shared toolbar frame — not as a loose sibling`
			).toBe(toolbar);
		}
		// #213 — no third button: the page-level [+ Event] is gone.
		expect(toolbar.querySelectorAll('button')).toHaveLength(2);
	});

	it('the gear is RIGHT-ALIGNED: it carries ml-auto, and the frame does NOT hug its content (w-fit would make ml-auto inert)', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, TOOLBAR)).not.toBeNull();
		});
		const toolbarClasses = Array.from((q(container, TOOLBAR) as HTMLElement).classList);
		const gearClasses = Array.from((q(container, 'season-manage-gear') as HTMLElement).classList);

		expect(toolbarClasses, 'the toolbar must be a flex row').toContain('flex');
		expect(
			gearClasses,
			'#213 — the gear must be pushed to the right edge of the toolbar row (ml-auto)'
		).toContain('ml-auto');
		// A fit-content frame hugs its buttons and leaves ml-auto nothing to push
		// against — right alignment needs the row to span.
		expect(
			toolbarClasses,
			'w-fit defeats right-alignment: the frame must span the row, not hug the buttons'
		).not.toContain('w-fit');
		// #213 review F1 — the class alone is not the contract, and happy-dom
		// computes no layout to catch the difference. `margin-left:auto` on the
		// FIRST flex item absorbs the free space BEFORE it, packing BOTH buttons
		// against the right edge in DOM order — the rightmost control was then
		// [+ Season], not the gear. The gear must come LAST.
		const buttons = Array.from(
			(q(container, TOOLBAR) as HTMLElement).querySelectorAll<HTMLButtonElement>('button')
		);
		expect(
			buttons[buttons.length - 1].getAttribute('data-testid'),
			'ml-auto only right-aligns the gear if the gear is the LAST member of the row'
		).toBe('season-manage-gear');
		expect(buttons[0].getAttribute('data-testid'), '[+ Season] stays on the left').toBe(
			'season-create'
		);
	});

	it('a NON-editor gets no toolbar at all — not an empty frame', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expectNoAdminControls(container);
		expect(
			q(container, TOOLBAR),
			'an empty bordered frame must not render for a non-editor'
		).toBeNull();
	});

	it('with the [+ Season] form open, the toolbar survives holding the control that remains (the gear)', async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		const toolbar = q(container, TOOLBAR) as HTMLElement;
		expect(
			toolbar,
			'the toolbar must not vanish when one of its controls opens its form'
		).not.toBeNull();
		expect(q(container, 'season-create'), 'the open form replaces its own trigger').toBeNull();
		expect((q(container, 'season-manage-gear') as HTMLElement)?.parentElement).toBe(toolbar);
	});

	it('with the panel open and its [+ Event] form up, the toolbar still holds [⚙] + [+ Season]', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		const toolbar = q(container, TOOLBAR) as HTMLElement;
		expect(toolbar).not.toBeNull();
		expect((q(container, 'season-manage-gear') as HTMLElement)?.parentElement).toBe(toolbar);
		expect((q(container, 'season-create') as HTMLElement)?.parentElement).toBe(toolbar);
	});
});

// ── #222 — ONE CARD: the panel opens INSIDE the admin toolbar's frame ──────────
//
// Mihkel live-gate feedback: the season-manage panel used to render as a SECOND
// stacked bordered frame below the toolbar, and the collapsed toolbar never
// named what the gear opens. #222 merges the two into ONE card:
//
//   agenda-admin-card        NEW outer wrapper — carries THE single border
//                            frame (the border/rounded classes that used to
//                            sit on the toolbar element).
//     agenda-admin-toolbar   the header row — KEEPS role="toolbar" + the #156
//                            roving tabindex scoped to its 2 buttons, but
//                            draws NO border of its own any more.
//     season-manage-panel    when open: the header row's SIBLING inside the
//                            card — NEVER a DOM descendant of the
//                            role="toolbar" element. Keeps id="season-manage-
//                            panel" / role="dialog" / testid (the gear's
//                            aria-controls still resolves, #213 untouched);
//                            loses its own border classes (no second frame).
//
// WHY the panel must NOT nest inside the role="toolbar" element (the naive
// merge): handleAdminToolbarKeydown roves over
// `toolbar.querySelectorAll('button:not([disabled])')` — a FULL-SUBTREE query,
// not direct children. Nesting the open panel there would pull every panel
// button (add-event, add-series, delete confirms, field pencils…) into
// arrow-key roving, and ARIA forbids role="dialog" content inside
// role="toolbar" anyway. The arity-2 test above only runs panel-CLOSED, so it
// cannot see that regression — the panel-OPEN pins below are what make the
// safe structure load-bearing.

const CARD = 'agenda-admin-card';

describe('agenda admin — #222: one card — the panel opens inside the toolbar frame', () => {
	it('the card carries THE single border frame; the toolbar header row inside it draws none', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, CARD)).not.toBeNull();
		});
		const card = q(container, CARD) as HTMLElement;
		const toolbar = q(container, TOOLBAR) as HTMLElement;

		expect(toolbar, 'the header row keeps its testid').not.toBeNull();
		expect(card.contains(toolbar), 'the header row lives inside the card').toBe(true);

		const cardClasses = Array.from(card.classList);
		expect(cardClasses, 'the card is the bordered frame now').toContain('border');
		expect(cardClasses, 'the frame keeps the rounded look').toContain('rounded-md');
		expect(
			Array.from(toolbar.classList),
			'no border-in-border: the header row must NOT draw its own frame'
		).not.toContain('border');
	});

	it("panel OPEN: season-manage-panel renders inside the card as the header row's SIBLING — never a descendant of role=\"toolbar\" — and draws no second frame", async () => {
		const container = await renderReady();
		await openPanel(container);

		const card = q(container, CARD) as HTMLElement;
		const toolbar = q(container, TOOLBAR) as HTMLElement;
		const panel = q(container, 'season-manage-panel') as HTMLElement;
		expect(card).not.toBeNull();
		expect(toolbar).not.toBeNull();
		expect(panel).not.toBeNull();

		expect(card.contains(panel), 'ONE card: the open panel expands INSIDE the frame').toBe(true);
		expect(
			toolbar.contains(panel),
			'the panel must NEVER nest inside the role="toolbar" element (roving + ARIA)'
		).toBe(false);
		expect(panel.parentElement, 'panel and header row are SIBLINGS in the card').toBe(card);
		expect(toolbar.parentElement, 'the header row is a direct child of the card').toBe(card);

		expect(
			Array.from(panel.classList),
			'no second stacked frame: the panel draws no border of its own'
		).not.toContain('border');
	});

	it("panel OPEN: the role=\"toolbar\" element still holds EXACTLY its 2 header buttons — the panel's many buttons never join the roving pool", async () => {
		const container = await renderReady();
		await openPanel(container);

		const card = q(container, CARD) as HTMLElement;
		const toolbar = q(container, TOOLBAR) as HTMLElement;
		// Non-vacuous: the card as a whole now holds MANY buttons (the panel's)…
		expect(card.querySelectorAll('button').length).toBeGreaterThan(2);
		// …but the roving query's root still sees exactly the 2 header members,
		// in the #213 order ([+ Season] left, gear last for ml-auto).
		const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'));
		expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual([
			'season-create',
			'season-manage-gear'
		]);
	});

	it('panel OPEN: arrow keys on a panel-internal button do NOT rove focus into the header row', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});

		const addEvent = q(container, 'season-manage-add-event') as HTMLButtonElement;
		addEvent.focus();
		expect(document.activeElement).toBe(addEvent);

		await fireEvent.keyDown(addEvent, { key: 'ArrowRight' });
		expect(
			document.activeElement,
			'ArrowRight inside the panel must not jump focus to a header control'
		).toBe(addEvent);
		expect(document.activeElement).not.toBe(q(container, 'season-manage-gear'));
		expect(document.activeElement).not.toBe(q(container, 'season-create'));

		await fireEvent.keyDown(addEvent, { key: 'ArrowLeft' });
		expect(
			document.activeElement,
			'ArrowLeft inside the panel must not jump focus to a header control'
		).toBe(addEvent);
	});

	// #222 review F1 — the one-card merge put the panel's `{#if seasonManageOpen}`
	// INSIDE the card's rights conditional. That conditional is the whole reason
	// this pin exists: `loadForSelected()` calls `resetManagement()` SYNCHRONOUSLY,
	// which blanks `manageableSeasonRights` AND `seasonCreateRights` to
	// 'not-editor' for the entire duration of the async `loadFullAgenda()`
	// round-trip. Both disjuncts of the card gate therefore go false mid-refresh,
	// and a card that mounts only on rights would take the open panel down with it
	// and re-mount it on the other side — exactly the teardown that every
	// `keepSeasonManage: true` caller exists to prevent (series-only create, event
	// create from the panel, event-convert occurrence failure, the season-manage
	// delete flows). $state survives a remount; the DOM does not — focus drops to
	// <body>, the panel's focus $effect re-fires and steals it back to the dialog,
	// scroll position and caret state are lost, and it routes clean around
	// `closeSeasonManagePanel`'s deliberate mid-run refusal (`seriesRunUnfinished
	// || eventConvertRunUnfinished`, #196 review F1/F3) — the conversion form and
	// the stopped-run 'N of M' notice live inside the panel.
	//
	// The existing survives-the-refresh pin (`every successful create refreshes
	// the agenda` → series-only create) cannot see this: its `loadFullAgenda` mock
	// resolves in the same microtask, so the rights-blank window never flushes to
	// the DOM. Holding the refresh OPEN is what makes the window observable.
	it('panel OPEN: the card survives the mid-refresh rights blank — a keepSeasonManage reload never unmounts the open panel while loadFullAgenda is in flight', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);

		// Hold the post-create refresh open: while this promise is pending,
		// resetManagement() has already blanked BOTH rights signals.
		let releaseAgenda!: () => void;
		loadFullAgendaMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseAgenda = () => resolve(agendaResult());
				})
		);

		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});

		// The rights-blank window, mid-flight — the gear is legitimately gone here
		// (it was gone pre-#222 too), but the PANEL must still be mounted.
		expect(
			q(container, 'season-manage-gear'),
			'non-vacuous: the rights blank really is in effect — the gear is gone'
		).toBeNull();
		const panel = q(container, 'season-manage-panel');
		expect(
			panel,
			'the open panel must NOT be torn down by the transient rights blank of its own refresh'
		).not.toBeNull();

		releaseAgenda();

		// …and it is the SAME node on the other side: never unmounted, never
		// remounted, so focus / scroll / caret inside it are undisturbed.
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		expect(
			q(container, 'season-manage-panel'),
			'the panel node survived the whole refresh — not a teardown + remount'
		).toBe(panel);
	});
});

// ── #222 — the collapsed header NAMES the card: visible 'Manage season' ────────
//
// Until the app manages more than one season (YAGNI), the collapsed header row
// shows the 'Manage season' text beside the gear — reusing the EXISTING
// season_manage_gear_label copy, no new key. The gear's accessible name then
// COMES FROM that visible element (aria-labelledby), so the copy is authored
// exactly once — no aria-label duplicate to drift per locale.

describe("agenda admin — #222: visible 'Manage season' in the collapsed header", () => {
	it('season-manage-label renders the season_manage_gear_label copy as visible PLAIN TEXT in the header row — not a button, not sr-only, not aria-hidden', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-manage-label')).not.toBeNull();
		});
		const label = q(container, 'season-manage-label') as HTMLElement;
		const toolbar = q(container, TOOLBAR) as HTMLElement;

		expect(label.parentElement, 'the label sits IN the header row').toBe(toolbar);
		expect(label.tagName, 'plain text, not another control').not.toBe('BUTTON');
		// The message mock renders keys verbatim — this pins WHICH key feeds the
		// label (the existing gear copy, no new key). The real four-locale copy
		// ('Manage season' / 'Halda hooaega' / …) is pinned by the i18n test below.
		expect(label.textContent?.trim()).toBe('season_manage_gear_label');
		expect(Array.from(label.classList), 'VISIBLE text — not sr-only').not.toContain('sr-only');
		expect(label.getAttribute('aria-hidden'), 'VISIBLE to AT too').toBeNull();
	});

	it("the gear's accessible name COMES FROM the visible label — aria-labelledby → season-manage-label, no duplicated aria-label — and still resolves with the panel open", async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		const gear = q(container, 'season-manage-gear') as HTMLButtonElement;
		const label = q(container, 'season-manage-label') as HTMLElement;
		expect(label, 'the visible label must exist for the gear to point at').not.toBeNull();

		expect(label.id, 'the label needs an id to be pointed at').toBeTruthy();
		expect(gear.getAttribute('aria-labelledby')).toBe(label.id);
		expect(
			gear.hasAttribute('aria-label'),
			'ONE authored copy: aria-labelledby replaces the aria-label, no duplicate'
		).toBe(false);
		// The real accname algorithm (testing-library runs it) resolves the gear
		// BY the label's text — a dangling id or empty label cannot pass this.
		expect(within(container).getByRole('button', { name: 'season_manage_gear_label' })).toBe(gear);

		// The label is gated WITH the gear (same {#if showSeasonManageGear}), so
		// the name cannot dangle while the panel is open either.
		await openPanel(container);
		expect(q(container, 'season-manage-label'), 'label stays mounted while open').not.toBeNull();
		expect(
			(q(container, 'season-manage-gear') as HTMLElement).getAttribute('aria-labelledby')
		).toBe(label.id);
	});

	it("create-rights-only (no manageable season): the header shows [+ Season] but NO 'Manage season' label and NO gear", async () => {
		// showSeasonCreate and showSeasonManageGear are INDEPENDENT gates: a fresh
		// collective can have create rights with nothing to manage. The label must
		// ride the GEAR's gate, not the card's outer OR-conditional — 'Manage
		// season' beside a control that does not exist is a lie.
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, CARD), 'the card still mounts for its one control').not.toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'season-manage-label')).toBeNull();
	});
});

// ── #222 — i18n: the reused visible-label copy, exact, all four locales ────────

describe('agenda admin — #222: season_manage_gear_label copy exists in all four locales (reused key, no new copy)', () => {
	it('the exact agreed copy per locale', () => {
		const expected = {
			en: 'Manage season',
			et: 'Halda hooaega',
			lv: 'Pārvaldīt sezonu',
			uk: 'Керувати сезоном'
		} as const;
		for (const [locale, copy] of Object.entries(expected)) {
			const msgs = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, string>;
			expect(msgs.season_manage_gear_label, `${locale}.json season_manage_gear_label`).toBe(copy);
		}
	});
});

// ── rights-gate: fail-closed, uniformly ─────────────────────────────────────────

describe('agenda admin — the rights gate fails closed across ALL controls', () => {
	it('editor: both entry points present (the affirmative half of the gate) — and the page-level [+ Event] is gone even for an editor', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();
	});

	it('NON-editor (no _owner/_editor visible to this caller): EVERY admin control is absent from the DOM — not hidden, not disabled', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expectNoAdminControls(container);
		// And nothing sneaks in behind a disabled/hidden attribute either — the
		// controls simply do not exist for a non-editor.
		expect(container.querySelector('[data-testid="season-manage-add-series"]')).toBeNull();
		expect(container.querySelector('[data-testid="season-manage-add-event"]')).toBeNull();
	});

	it("a rights read that ERRORS is not a grant: no seasons at all + organization rights resolve to 'error' → every admin control absent", async () => {
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('error');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expectNoAdminControls(container);
	});

	it('a FAILED agenda load (rights unknowable) shows agenda-error and NO admin controls — fail-closed, never fail-open', async () => {
		loadFullAgendaMock.mockRejectedValue(new Error('boom'));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'agenda-error')).not.toBeNull();
		});
		expectNoAdminControls(container);
	});
});

// ── state management: only ONE creation form open at a time ─────────────────────

describe('agenda admin — creation forms are mutually exclusive', () => {
	it("[+ Season] form open, then the panel's [+ Event] (#213 — the only event entry point left): the event form opens and the season form CLOSES (nothing written)", async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		await openEventFormFromPanel(container);

		expect(q(container, 'event-create-form')).not.toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('[+ Event] form open (via the panel), then [+ Season]: the season form opens and the event form CLOSES', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		await openSeasonForm(container);

		expect(q(container, 'season-create-form')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it("series form open (in the panel), then the panel's [+ Event]: the event form opens, the series form CLOSES — and the PANEL survives (it is management, not creation)", async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		await openEventFormFromPanel(container);

		expect(q(container, 'event-create-form')).not.toBeNull();
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});

	it('[+ Season] form open, then the panel’s [+ Series]: the series form opens, the season form CLOSES', async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		await openSeriesForm(container);

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
	});

	it('series form open, then [+ Season]: the season form opens, the series form CLOSES, the panel survives', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		await openSeasonForm(container);

		expect(q(container, 'season-create-form')).not.toBeNull();
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});

	// The panel's [+ Event] is the one entry point that used to render regardless
	// of which form was open — so it could wipe the very form it had opened.
	it('the panel’s [+ Event] is gone while the event form it opened is up (same gate as the other three entry points)', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});

		expect(q(container, 'season-manage-add-event')).toBeNull();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
});

// ── mutual exclusion never overrides an IN-FLIGHT write ─────────────────────────
//
// #132/T6 review F1. Each form refuses its own dismissal while its write is on
// the wire; mutual exclusion must not be a second, un-guarded way in. The bulk
// series run is the case that matters — many serial POSTs, and a resume record
// that exists nowhere but this form's state.

/** Generation ON, Mondays. Over `fillValidSeries`'s 2026-09-01…09-21 range that
 *  is exactly 3 occurrences: Sep 7, Sep 14, Sep 21. */
async function enableMondayGeneration(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'series-create-generate') as HTMLElement);
	await selectValue(container, 'series-create-day', '1');
}

describe('agenda admin — an in-flight create is never torn down by another entry point', () => {
	it('mid bulk-generation run: every other entry point is DISABLED, and clicking one anyway leaves the series form and its run untouched', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		// The first occurrence's POST is on the wire and stays there.
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		expect(q(container, 'series-create-progress')).not.toBeNull();

		const entryPoints = ['season-create', 'season-manage-add-event'] as const;
		for (const testid of entryPoints) {
			const btn = q(container, testid) as HTMLButtonElement | null;
			expect(btn, `${testid} must still render while the run is in flight`).not.toBeNull();
			expect(
				(btn as HTMLButtonElement).disabled,
				`${testid} must be disabled while a create is in flight`
			).toBe(true);
		}
		// …and a click that reaches the handler anyway changes nothing.
		for (const testid of entryPoints) {
			await fireEvent.click(q(container, testid) as HTMLElement);
		}

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-progress')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
		expect(createEventMock).toHaveBeenCalledTimes(1); // the loop is untouched

		// Let the run finish so the form closes on its own terms.
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
		// #213 — with the run finished, the gear is a live toggle again.
		await waitFor(() => {
			expect((q(container, 'season-manage-gear') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	// The series form is rendered INSIDE the panel, so the panel's close path is
	// a teardown hazard too — the same hazard by a different door. #213 moved
	// that door onto the GEAR (the internal × is gone): Gama ruling (1) — the
	// gear renders DISABLED while the run is unfinished, so the panel stays open
	// to show progress; an enabled no-op would lie about it.
	it('mid bulk-generation run: the GEAR is disabled and cannot unmount the series form the panel hosts', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		const gear = q(container, 'season-manage-gear') as HTMLButtonElement;
		expect(gear.disabled, 'the gear must be VISIBLY refused mid-run, not an enabled no-op').toBe(
			true
		);
		await fireEvent.click(gear);

		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(gear.getAttribute('aria-expanded')).toBe('true');
		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-progress')).not.toBeNull();
	});

	it('mid RESUME run: the stopped run’s remainder survives the interference — the resumed loop still creates exactly the 2 occurrences it owed, on the SAME series', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(() => {
			const call = createEventMock.mock.calls.length;
			if (call === 1) return Promise.resolve('ev-new-1');
			if (call === 2) return Promise.reject(new Error('boom'));
			return new Promise<string>((resolve) => {
				resolvers.push(resolve);
			});
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		// Occurrence 2 of 3 failed: the series exists, 2 occurrences still owed.
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		// Re-submit RESUMES; interfere while its first POST is on the wire
		// (#213: through the panel's [+ Event] — the only event entry point).
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-resume')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();

		resolvers[0]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		resolvers[1]('ev-new-3');
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		// 1 landed + 1 failed + the 2 the resume owed — and never a second series.
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
	});
});

// ── the STOPPED-but-idle window (#132/T6 review F1, follow-up) ──────────────────
//
// The tests above cover the run while it is ON THE WIRE. A run that STOPS partway
// leaves that window: `seriesCreateResume` is set and `seriesCreateSubmitting` is
// released in the same `finally`, so an "is a write in flight?" guard is FALSE at
// exactly the moment the resume record — the only record of what the run still
// owes — is most destructible. Every other entry point calls
// `closeSeriesCreateForm()`, which nulls it.

/** Run 3 Mondays with occurrence #2 (and everything after) failing, and wait for
 *  the resume notice. Leaves the form open with 2 occurrences still owed and
 *  NOTHING on the wire. */
async function stopBulkRunPartway(container: HTMLElement): Promise<void> {
	createEventMock.mockImplementation(() => {
		const call = createEventMock.mock.calls.length;
		if (call === 1) return Promise.resolve('ev-new-1');
		return Promise.reject(new Error('boom'));
	});
	await openSeriesForm(container);
	await fillValidSeries(container);
	await enableMondayGeneration(container);
	await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-resume')).not.toBeNull();
	});
}

describe('agenda admin — a STOPPED series run still owes work, and the entry points respect that', () => {
	it('nothing on the wire, but a resume record outstanding: the other entry points are still DISABLED, and a click cannot discard it', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		// The distinguishing fact: no write is in flight any more — the form's own
		// submit is live again, so "in flight" cannot be what protects the resume.
		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);

		const entryPoints = ['season-create', 'season-manage-add-event'] as const;
		for (const testid of entryPoints) {
			const btn = q(container, testid) as HTMLButtonElement | null;
			expect(btn, `${testid} must still render after a stopped run`).not.toBeNull();
			expect(
				(btn as HTMLButtonElement).disabled,
				`${testid} must be disabled while a stopped run still owes occurrences`
			).toBe(true);
			// …and a click that reaches the handler anyway changes nothing.
			await fireEvent.click(btn as HTMLElement);
		}

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-resume')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
	});

	it('the resumed run finishes on the SAME series after the interference — no duplicate series, no re-POST of the occurrence that landed', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await fireEvent.click(q(container, 'season-create') as HTMLElement);

		// Now let the retry succeed and finish the run from the resume record.
		createEventMock.mockImplementation(() => Promise.resolve('ev-retry'));
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		// 1 landed + 1 failed + exactly the 2 the resume owed.
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
	});

	it('Cancel is the operator’s explicit exit: dismissing the stopped run frees every other entry point again', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		const cancel = q(container, 'series-create-cancel') as HTMLButtonElement;
		expect(cancel.disabled, 'cancel is live once nothing is on the wire').toBe(false);
		await fireEvent.click(cancel);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});

		await waitFor(() => {
			for (const testid of ['season-create', 'season-manage-add-event'] as const) {
				const btn = q(container, testid) as HTMLButtonElement | null;
				expect(btn, `${testid} must render again`).not.toBeNull();
				expect(
					(btn as HTMLButtonElement).disabled,
					`${testid} must be live again once the stopped run is dismissed`
				).toBe(false);
			}
			// #213 — and the gear is a live toggle again.
			expect((q(container, 'season-manage-gear') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	// #135 pinned this on the panel's own ×, which was narrower than the
	// entry-point guard once. #213 removes the × entirely and the GEAR carries
	// the refusal now (Gama ruling (1) — createEntryPointsBlocked precedent):
	// disabled the whole time the run is unfinished, wire or no wire, so the
	// resume notice — the ONLY visible reason every other entry point is
	// disabled — cannot be discarded.
	it('the GEAR cannot discard the panel while a resume record is outstanding — the panel is the only surviving explanation for the disabled entry points', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		const gear = q(container, 'season-manage-gear') as HTMLButtonElement;
		expect(gear.disabled, 'the gear must be visibly refused while a resume is outstanding').toBe(
			true
		);
		await fireEvent.click(gear);

		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(gear.getAttribute('aria-expanded')).toBe('true');
		expect(q(container, 'series-create-resume')).not.toBeNull();
	});
});

// ── a form never tears ITSELF down while its write is on the wire ───────────────
//
// #132/T6 review F2. `dismissSeriesCreateForm` established this invariant; the
// season and event forms' own Cancel/Escape did not hold it. `seasonCreateError`
// / `eventCreateError` render ONLY inside their `{#if …Open}` block, so a
// mid-flight teardown turns a FAILED create into a completely silent one.

describe('agenda admin — Cancel/Escape is refused while the form’s own create is on the wire', () => {
	it('season create: Cancel is disabled mid-flight, Escape is refused, and the failure still surfaces as a visible error', async () => {
		let rejectCreate!: (err: Error) => void;
		createSeasonMock.mockImplementation(
			() =>
				new Promise<string>((_resolve, reject) => {
					rejectCreate = reject;
				})
		);
		const container = await renderReady();
		await openSeasonForm(container);
		await fillValidSeason(container);
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});

		const cancel = q(container, 'season-create-cancel') as HTMLButtonElement;
		expect(cancel.disabled, 'cancel must be visibly refused, not a dead click').toBe(true);
		await fireEvent.click(cancel);
		expect(q(container, 'season-create-form')).not.toBeNull();

		// Escape reaches the same handler — the same refusal must apply.
		await fireEvent.keyDown(q(container, 'season-create-form') as HTMLElement, { key: 'Escape' });
		expect(q(container, 'season-create-form')).not.toBeNull();

		// #213 — the gear's disabled gate is the RUN formula
		// (seriesRunUnfinished || eventConvertRunUnfinished), NOT
		// createEntryPointsBlocked: a merely in-flight season create must not
		// freeze the panel toggle.
		expect((q(container, 'season-manage-gear') as HTMLButtonElement).disabled).toBe(false);

		rejectCreate(new Error('boom'));
		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
	});

	it('event create: Cancel is disabled mid-flight, Escape is refused, and the failure still surfaces as a visible error', async () => {
		let rejectCreate!: (err: Error) => void;
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((_resolve, reject) => {
					rejectCreate = reject;
				})
		);
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillValidEvent(container);
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});

		const cancel = q(container, 'event-create-cancel') as HTMLButtonElement;
		expect(cancel.disabled, 'cancel must be visibly refused, not a dead click').toBe(true);
		await fireEvent.click(cancel);
		expect(q(container, 'event-create-form')).not.toBeNull();

		await fireEvent.keyDown(q(container, 'event-create-form') as HTMLElement, { key: 'Escape' });
		expect(q(container, 'event-create-form')).not.toBeNull();

		rejectCreate(new Error('boom'));
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
	});
});

// ── a collective switch tears down ALL THREE creation forms ─────────────────────
//
// #132/T6 review F3. `loadForSelected` closed the season and event forms but not
// the series form, and `resetSeasonManage` does not touch it either: the PANEL
// closed while `seriesCreateOpen` / `seriesCreateSeasonId` / `seriesCreateResume`
// survived into the next collective. Re-opening the gear then re-rendered the
// previous collective's form verbatim, and a submit would have sent that db's
// season id as `extraParentIds` against the NEW db's cfg.

describe('agenda admin — a collective switch leaves no creation form behind', () => {
	function setAuthedWithTwoCollectives() {
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

	it('series form open in A, then a same-route switch to B: re-opening the panel in B does NOT resurrect A’s form', async () => {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});

		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		// The load-bearing half: the panel closing merely UNMOUNTS the form. What
		// must not survive is the state behind it.
		await openPanel(container);
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});

	it('a stopped series run does NOT survive a collective switch either (its seriesId belongs to the previous db)', async () => {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await stopBulkRunPartway(container);

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openPanel(container);
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'series-create-resume')).toBeNull();
		// …and with no resume record outstanding, B's entry points are live
		// (#213: the panel's [+ Event] is the event entry point now).
		await waitFor(() => {
			expect((q(container, 'season-manage-add-event') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	// #137 — the two tests above cover a run that has already STOPPED (nothing on
	// the wire) when the switch lands. The bug this one pins is narrower and
	// worse: a switch WHILE an occurrence's POST is still in flight. The switch's
	// own `loadForSelected` tears the form down synchronously (proven above), but
	// the bulk loop inside `submitSeriesCreate` is a closure holding its OWN `cfg`
	// (pinned to org-a) — nothing stopped it from resolving and looping straight
	// into a second, third… `createEvent(cfg, …)` against a db the viewer had
	// already left, or from writing its outcome into state a form that belonged
	// to org-a (and is now unmounted) used to render.
	it('a LIVE bulk run stops issuing POSTs the moment the viewer switches away mid-generation, and writes no outcome into the old form', async () => {
		setAuthedWithTwoCollectives();
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});

		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		// The first occurrence's POST is on the wire, against org-a.
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		// The viewer switches collectives WHILE that POST is still in flight.
		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		// Let the in-flight POST resolve — the loop's next turn is where a stale
		// closure would fire occurrence #2 against org-a.
		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			createEventMock,
			'the loop must stop at the switch — no further occurrence may land in the db the viewer left'
		).toHaveBeenCalledTimes(1);

		// Re-opening the panel in B is a clean slate: no resume record bled over
		// from the run that stopped when the viewer left org-a, and B's own entry
		// points are live.
		await openPanel(container);
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'series-create-resume')).toBeNull();
		await waitFor(() => {
			expect((q(container, 'season-manage-add-event') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	// #213 review F2 — the gear's `disabled` gate is a CLOSE refusal (Gama ruling
	// (1)): it protects a panel that hosts the only record of an unfinished run.
	// Gated on the run flags ALONE it also refused to OPEN — and
	// `seriesCreateSubmitting` is a GLOBAL flag, not a per-db one, so a run still
	// finishing in the collective the viewer LEFT disabled the gear in the
	// collective she is now IN, whose panel hosts nothing. With
	// `createEntryPointsBlocked` (the same global flag) already holding
	// [+ Season] down, org-b had no reachable admin control at all and nothing on
	// screen saying why — the shape #138 review F2 and #135 exist to prevent.
	it('a switch away mid-run: the gear in the NEW collective still OPENS its panel — the close refusal does not travel across collectives', async () => {
		setAuthedWithTwoCollectives();
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		// org-a's occurrence POST is STILL on the wire — the state that used to
		// freeze org-b's gear.
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
		});
		expect(
			(q(container, 'season-manage-gear') as HTMLButtonElement).disabled,
			'with no panel open there is nothing to discard: the gear must still open one'
		).toBe(false);
		await openPanel(container);

		// Let the abandoned run finish its turn so nothing dangles past the test.
		resolvers[0]('ev-new-1');
	});
});

// ── panel ↔ creation-form coexistence ───────────────────────────────────────────

describe('agenda admin — the season panel coexists with a panel-born creation form', () => {
	it('panel → [+ Event]: the form opens WITH the panel still up; cancel closes only the form and hands focus back to the panel', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();

		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
	});
});

// ── refresh after EVERY successful create ───────────────────────────────────────

describe('agenda admin — every successful create refreshes the agenda', () => {
	it('season create → loadFullAgenda re-invoked (full call shape held to T2’s pin)', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openSeasonForm(container);
		await fillValidSeason(container);
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		expect(createSeasonMock).toHaveBeenCalledWith(CFG, {
			name: 'Autumn 2026',
			dbEntityId: ORG_EFK,
			startDate: '2026-09-01',
			endDate: '2026-12-20',
			conductorRefs: []
		});
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('event create → loadFullAgenda re-invoked (full call shape held to T4’s pin: Tallinn wall clock → UTC instant)', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openEventFormFromPanel(container);
		await fillValidEvent(container);
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventMock).toHaveBeenCalledWith(CFG, {
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-15T16:00:00.000Z', // 19:00 EEST (+3)
			name: 'Extra rehearsal'
		});
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('series-only create (generation OFF) → loadFullAgenda re-invoked TOO — the refresh discipline is uniform — and the panel it was born in survives the refresh', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openSeriesForm(container);
		await fillValidSeries(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventMock).not.toHaveBeenCalled(); // generation OFF — series only
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		// The NEW pin: the agenda re-reads the world after a series create, same
		// as after a season or event create — not only the panel's own lists.
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		// …and the refresh keeps the panel (keepSeasonManage — the T4/T5 shape),
		// so the series that was just made is visible where it was made.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
});

// ── mobile (375px): touch targets — the Tailwind 44px contract ──────────────────
//
// happy-dom computes no layout, so a pixel measurement would read 0 for every
// element; the testable truth is the CLASS contract the layout follows from.
// Tailwind's spacing 11 is 2.75rem = 44px — the WCAG 2.5.5 / platform-HIG
// minimum touch target.

/** Asserts the 44px touch-target contract on one control. Icon-only controls
 *  (a gear, an ×) also need the WIDTH floor — text buttons get their width
 *  from their label + padding, but a lone glyph does not.
 *
 *  `onWrappingLabel` moves the assertion off the testid'd element and onto the
 *  <label> around it. That is the honest target for a CHECKBOX: the box itself
 *  is a ~13px UA-drawn widget that a height utility does not grow, while the
 *  whole label is clickable (clicking the text toggles it). Asserting on the
 *  input would pin a class that changes nothing on screen. */
function expectTouchTarget(
	container: HTMLElement,
	testid: string,
	opts: { iconOnly?: boolean; onWrappingLabel?: boolean } = {}
): void {
	const found = q(container, testid);
	expect(found, `${testid} must be in the DOM`).not.toBeNull();
	const el = opts.onWrappingLabel
		? (found as HTMLElement).closest('label')
		: (found as HTMLElement);
	expect(
		el,
		`${testid} must sit inside a <label> — that label is what carries the touch target`
	).not.toBeNull();
	const what = opts.onWrappingLabel ? `the <label> wrapping ${testid}` : testid;
	const classes = Array.from((el as HTMLElement).classList);
	expect(classes, `${what} must reserve a 44px-tall touch target (min-h-11)`).toContain('min-h-11');
	if (opts.iconOnly) {
		expect(classes, `${testid} is icon-only — it must also floor its width (min-w-11)`).toContain(
			'min-w-11'
		);
	}
}

describe('agenda admin — every admin control is a 44x44px touch target', () => {
	it('page-level entry points (#213: two left): [⚙] (icon-only: height AND width), [+ Season]', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-manage-gear')).not.toBeNull();
			expect(q(container, 'season-create')).not.toBeNull();
		});

		expectTouchTarget(container, 'season-manage-gear', { iconOnly: true });
		expectTouchTarget(container, 'season-create');
	});

	it('panel controls (#213: the internal close × is gone): [+ Series], [+ Event]', async () => {
		const container = await renderReady();
		await openPanel(container);

		expectTouchTarget(container, 'season-manage-add-series');
		expectTouchTarget(container, 'season-manage-add-event');
	});

	it('season form: submit + cancel', async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		expectTouchTarget(container, 'season-create-submit');
		expectTouchTarget(container, 'season-create-cancel');
	});

	it('event form: submit + cancel', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		expectTouchTarget(container, 'event-create-submit');
		expectTouchTarget(container, 'event-create-cancel');
	});

	it('series form: submit + cancel', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expectTouchTarget(container, 'series-create-submit');
		expectTouchTarget(container, 'series-create-cancel');
	});

	// #132/T6 review F2 — the contract is EVERY admin button, not only the entry
	// points and the submit/cancel pairs. These are the rest of them: the panel's
	// three inline-edit pencils, the conductor chip × in all three places it
	// appears, and (#215) the series preview's date-toggle chips, which replaced
	// the skip-date input + [Add] + removable chips wholesale.
	it('panel inline-edit activators (#205 — whole-field now, no icon-only width floor: name, start date, end date)', async () => {
		const container = await renderReady();
		await openPanel(container);

		// #205 retired the icon-only pencil shape: these are whole-field
		// activators (`w-full`, value inside — pinned in
		// page.season-manage-whole-field.spec.ts), so the min-w-11 floor no
		// longer applies; the 44px height floor still does.
		expectTouchTarget(container, 'season-edit-btn-name');
		expectTouchTarget(container, 'season-edit-btn-start_date');
		expectTouchTarget(container, 'season-edit-btn-end_date');
	});

	it('panel conductor chip × (icon-only)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ conductors: ['p-ada'] }));
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-remove-p-ada')).not.toBeNull();
		});

		expectTouchTarget(container, 'season-manage-conductor-remove-p-ada', { iconOnly: true });
	});

	it('season form conductor chip × (icon-only)', async () => {
		const container = await renderReady();
		await openSeasonForm(container);
		await addConductorChip(q(container, 'season-create-form') as HTMLElement, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-create-conductor-remove-p-ada')).not.toBeNull();
		});

		expectTouchTarget(container, 'season-create-conductor-remove-p-ada', { iconOnly: true });
	});

	it('event form conductor chip × (icon-only)', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await addConductorChip(q(container, 'event-create-conductors-field') as HTMLElement, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'event-create-conductor-remove-p-ada')).not.toBeNull();
		});

		expectTouchTarget(container, 'event-create-conductor-remove-p-ada', { iconOnly: true });
	});

	it('#215 series preview date-toggle chips: every chip carries the FULL 44x44 floor (min-h-11 AND min-w-11 — a tap target, not a text link), skipped or not; the retired skip-add/skip-remove controls are gone', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(q(container, 'series-create-date-2026-09-07')).not.toBeNull();
		});

		for (const iso of ['2026-09-07', '2026-09-14', '2026-09-21']) {
			expectTouchTarget(container, `series-create-date-${iso}`, { iconOnly: true });
		}

		// A SKIPPED chip is still a tap target — restoring it is the same tap.
		await fireEvent.click(q(container, 'series-create-date-2026-09-14') as HTMLElement);
		await waitFor(() => {
			expect(
				q(container, 'series-create-date-2026-09-14')?.getAttribute('aria-pressed')
			).toBe('false');
		});
		expectTouchTarget(container, 'series-create-date-2026-09-14', { iconOnly: true });

		// The controls this grid replaced must be gone from the form entirely.
		expect(q(container, 'series-create-skip-add')).toBeNull();
		expect(q(container, 'series-create-skip-date')).toBeNull();
		expect(container.querySelector('[data-testid^="series-create-skip-remove-"]')).toBeNull();
	});

	// #136 — the generate checkbox, the one non-button the contract covers (see
	// the SCOPE note in the header). The testid rides on the <input>, but the
	// input is the ~13px UA widget; the <label> around it is the click target and
	// therefore where the floor has to live. Resolving through `.closest('label')`
	// is the point of the case: an assertion on the input would pass while the
	// row on screen stayed 16px tall.
	it('series form generate checkbox: its wrapping label row is the 44px target', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expectTouchTarget(container, 'series-create-generate', { onWrappingLabel: true });
	});

	// #209 — the Autocomplete option-row touch-target cases that lived here are
	// GONE with the component: all five person pickers are native <select>
	// elements now (PO standing rule 1), and a native select's option touch
	// targets are the platform's concern, not this app's CSS floor — the same
	// posture #199 took for event-create-type and every other native select on
	// this page (event-create-season, series-create-repeat).
});

// ── mobile (375px): no horizontal overflow — the fluid-width contract ───────────

/** Every field in the form must be shrinkable/fluid: `w-full`, `flex-1` or
 *  `min-w-0`. Without one of those, a native date/datetime/select control's
 *  INTRINSIC width floors the row (flex items default to min-width:auto) and
 *  the form scrolls sideways at 375px. Checkboxes are exempt (intrinsically
 *  small). And no element in the subtree may carry a fixed pixel width class
 *  that alone exceeds the ~343px a 375px viewport leaves inside the page's
 *  px-4 gutter. */
function expectFormFluid(container: HTMLElement, formTestid: string): void {
	const form = q(container, formTestid) as HTMLElement;
	expect(form, formTestid).not.toBeNull();

	const fields = form.querySelectorAll<HTMLElement>('input, select, textarea');
	expect(fields.length, `${formTestid} should contain fields`).toBeGreaterThan(0);
	for (const field of fields) {
		if (field.getAttribute('type') === 'checkbox') continue;
		const classes = Array.from(field.classList);
		const fluid =
			classes.includes('w-full') || classes.includes('flex-1') || classes.includes('min-w-0');
		const label =
			field.getAttribute('data-testid') ?? field.getAttribute('aria-label') ?? field.tagName;
		expect(
			fluid,
			`${formTestid} › ${label} must be fluid (w-full | flex-1 | min-w-0) — an intrinsic-width field forces horizontal scroll at 375px`
		).toBe(true);
	}

	for (const el of Array.from(form.querySelectorAll<HTMLElement>('*'))) {
		for (const cls of Array.from(el.classList)) {
			const fixedPx = /^w-\[(\d+(?:\.\d+)?)px\]$/.exec(cls);
			if (fixedPx) {
				expect(
					Number(fixedPx[1]),
					`${formTestid} contains a fixed width ${cls} — wider than a 375px viewport's usable ~343px`
				).toBeLessThan(344);
			}
		}
	}
}

describe('agenda admin — creation forms stay inside a 375px viewport (class contract)', () => {
	it('season form: every field fluid, no oversized fixed widths', async () => {
		const container = await renderReady();
		await openSeasonForm(container);
		expectFormFluid(container, 'season-create-form');
	});

	it('event form: every field fluid (the datetime-local control is the notorious offender), no oversized fixed widths', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		expectFormFluid(container, 'event-create-form');
	});

	it('series form: every field fluid, no oversized fixed widths', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		expectFormFluid(container, 'series-create-form');
	});
});

// (*MVOX:Tallis* — #132/T6 RED: agenda admin controls — entry-point + rights-gate
// consistency, one-form-at-a-time, refresh-on-create, 44px touch targets, 375px
// fluid-width contract)
// (*MVOX:Palestrina* — #149 review F1/F2: shared admin-toolbar pins — one frame,
// wrap-not-overflow + w-fit hug, no empty frame for a non-editor, frame survives
// an open sibling form)

// ---------------------------------------------------------------------------
// #156 — roving tabindex on the admin toolbar. WAI-APG TOOLBAR: no member is
// ever "selected", so the stop is simply last-focused-else-first-ENABLED, and
// arrows only move focus. The disabled-safety matters here: [+ Season] (and
// #213's gear, mid-run) disable, and a disabled button cannot hold focus — a
// stop parked on one would strand the whole toolbar from the keyboard.
//
// #213 / Gama ruling (2): the toolbar pattern would be DROPPED if at most one
// member were ever visible at once. The SPIKE proved the opposite — the
// DEFAULT state (a current season running, nothing queued behind it, viewer
// its editor: exactly this suite's beforeEach fixture) renders the gear AND
// [+ Season] together — so role="toolbar" and the roving tabindex are KEPT,
// at arity 2. Reported back on the issue per the ruling's escape clause:
// mvox-dev/mvox-app#213 (issuecomment-5507858508).
// ---------------------------------------------------------------------------
describe('agenda admin toolbar — roving tabindex (#156, arity 2 after #213)', () => {
	function toolbarButtons(container: HTMLElement): HTMLButtonElement[] {
		return Array.from(
			(q(container, 'agenda-admin-toolbar') as HTMLElement).querySelectorAll<HTMLButtonElement>(
				'button'
			)
		);
	}
	function stops(container: HTMLElement): HTMLButtonElement[] {
		return toolbarButtons(container).filter((b) => b.getAttribute('tabindex') === '0');
	}

	async function renderToolbar(): Promise<HTMLElement> {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'agenda-admin-toolbar')).not.toBeNull();
			expect(q(container, 'season-manage-gear')).not.toBeNull();
			expect(q(container, 'season-create')).not.toBeNull();
		});
		return container;
	}

	it('the toolbar declares role="toolbar" with an accessible name', async () => {
		const container = await renderToolbar();
		const toolbar = q(container, 'agenda-admin-toolbar') as HTMLElement;
		expect(toolbar.getAttribute('role')).toBe('toolbar');
		expect(toolbar.getAttribute('aria-label')).toBeTruthy();
	});

	it('exactly ONE control is the Tab stop, and it is the first member (of the two #213 leaves)', async () => {
		const container = await renderToolbar();
		const btns = toolbarButtons(container);
		expect(btns).toHaveLength(2);
		expect(stops(container)).toEqual([btns[0]]);
	});

	it('ArrowRight moves focus forward and WRAPS; ArrowLeft wraps backwards; the stop travels along', async () => {
		const container = await renderToolbar();
		const btns = toolbarButtons(container);

		btns[0].focus();
		await fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(btns[1]);
		await waitFor(() => {
			expect(stops(container)).toEqual([btns[1]]);
		});

		await fireEvent.keyDown(btns[1], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(btns[0]);

		await fireEvent.keyDown(btns[0], { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(btns[1]);
	});

	it('arrows MOVE ONLY — no form or panel opens from arrow navigation', async () => {
		const container = await renderToolbar();
		const btns = toolbarButtons(container);
		btns[0].focus();
		await fireEvent.keyDown(btns[0], { key: 'ArrowRight' });
		await fireEvent.keyDown(btns[1], { key: 'ArrowRight' });
		expect(q(container, 'season-create-form')).toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
		expect(q(container, 'season-manage-panel')).toBeNull();
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus leaves the toolbar and the button still activates', async () => {
		const container = await renderToolbar();
		const btn = toolbarButtons(container)[0];
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(btn, { key });
			fireEvent(btn, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});

	it('with a create form open, the shrunken toolbar still holds exactly one ENABLED Tab stop — never a disabled one', async () => {
		const container = await renderToolbar();
		await openSeasonForm(container);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		const remaining = stops(container);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].disabled, 'the sole Tab stop must be operable').toBe(false);
	});
});

// (*MVOX:Tallis* — #213 RED: single right-aligned cogwheel TOGGLE — aria-expanded
// + aria-controls, no internal panel close, page-level [+ Event] removed, gear
// disabled while a bulk run is unfinished, toolbar kept at arity 2 per the SPIKE
// finding on Gama ruling 2)
