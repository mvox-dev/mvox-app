// @vitest-environment happy-dom
//
// #298 RED — the create confirmation becomes VISIBLE without losing its
// announcement (integration: real +page.svelte; only the data seams are
// mocked — same harness family as page.event-create.spec.ts /
// page.season-create.spec.ts).
//
// The surface already exists: `season-create-status` and `event-create-status`
// are `role="status" aria-live="polite"`, always-mounted, carrying the right
// text at the right moment. The ONLY thing wrong with them is that
// `class="sr-only"` is unconditional. #298: keep the announcement, add the
// sight.
//
// ── THE HARD CONSTRAINT (issue body, verbatim intent) ───────────────────────
//
//   "Visibility must come from styling on content presence — NEVER from
//    wrapping the region in {#if}."
//
// A live region inserted into the DOM already populated is generally NOT
// announced; only a change to a present-and-empty one is. The codebase already
// contains the forbidden shape (`series-create-progress`,
// `event-convert-progress` — `{#if}`-mounted visible role="status"
// paragraphs); they are the ANTI-pattern here, not the model. This suite pins
// the constraint structurally:
//
//   * NODE IDENTITY — the element observed present-and-empty at first render
//     must be the IDENTICAL DOM node that later carries the success text. An
//     `{#if}` implementation mounts a fresh node at success time and fails
//     the `toBe` reference check.
//   * ONE ELEMENT — the success text must appear in exactly one place (the
//     region itself / its own ancestor-descendant chain). Adding a NEW
//     visible paragraph alongside the untouched sr-only region would read the
//     text to a screen-reader user twice: once announced, once met again as
//     static content. The issue says: reuse what is there.
//
// ── VISIBILITY MECHANISM (what GREEN must implement) ────────────────────────
//
// The empty region must occupy no visible space (Done-when #4) and stay in
// the accessibility tree (never `hidden`/`display:none` — those would silence
// the live region). The populated region must be visible. The pin is the
// `sr-only` class itself, toggled by content presence on the SAME element:
//
//     empty      → classList CONTAINS 'sr-only'  (out of flow, a11y-visible)
//     populated  → classList LACKS   'sr-only'  (on screen)
//
// GREEN guidance (research-verified, teams/mvox-dev research for #298):
//   * drive the class off the SAME state var the text already binds to
//     (`class:sr-only={!seasonCreateStatus}` or an equivalent reactive class
//     expression). This is the FIRST dynamic class binding in this file —
//     there is no local precedent to copy; follow the issue, not the
//     neighbours.
//   * do NOT reach for CSS `:empty` — Svelte compiles these divs with a
//     literal single-space text node and mutates its `.data` in place, and
//     whether a zero-length text node still counts as a child for `:empty`
//     is ambiguous in the spec text. The reactive class sidesteps it.
//   * the regions sit in a `rounded-lg bg-paper p-4` container with NO
//     flex/gap — a newly visible line needs a DELIBERATE spacing decision
//     (a margin utility in the populated branch); not pinned here, but do
//     not let it land flush against its neighbours by omission.
//
// ── CLEARING (Done-when #5 — event-driven, NO timer) ────────────────────────
//
// The message clears on the next thing that makes it untrue: another create,
// the form reopening, or a context change (collective switch). NEVER on a
// clock — a message that vanishes mid-read fails the readers who need it
// most. At HEAD two of these are GAPS this suite turns red:
//
//   * `openEventCreateForm` resets every other form field but NOT
//     `eventCreateStatus` (only `submitEventCreate` clears it);
//   * neither status var is cleared on a genuine collective switch
//     (`loadForSelected` touches neither).
//
// Harmless while sr-only; the moment the region is visible, a stale
// "Season X created" would sit on screen after a switch with nothing created.
//
// NOTE the flip side, pinned implicitly by the success tests: a create's OWN
// same-collective refresh (`loadForSelected()` runs right after the status is
// set, on both paths) must NOT wipe the just-set message. An unconditional
// clear inside `loadForSelected` is therefore the WRONG site — the clear
// belongs to the genuine context-change path.
//
// ── #244 / Done-when #6 — the excluded-by-filter case says so ───────────────
//
// When the active agenda type filter does not admit the created event's
// bucket, the plain "{name} created for {when}." is a lie of omission: the
// viewer stares at a list their new event is not in. The status must say:
// created successfully, AND the active filter is why it is not in the list.
//
// Pinned contract: a NEW message key `event_created_hidden_by_filter`,
// carrying the SAME `{name}` / `{when}` params as `event_created`, rendered
// into the SAME region — used exactly when `agendaTypeFilter` is active and
// does not admit the created type's bucket. (At HEAD `submitEventCreate` sets
// the status BEFORE computing `showableUnderFilter`, so the ordering must
// change.) Four-bundle rule applies: messages/{en,et,lv,uk}.json. Real copy
// is Comenius's; the en/et/lv/uk KEY presence + slots are pinned below.
//
// ── SCOPE ───────────────────────────────────────────────────────────────────
//
// Exactly the two regions #298 names: `season-create-status` and
// `event-create-status`. The roster's five sibling regions and
// `season-manage-delete-status` are built on the same idiom but are NOT in
// scope — the issue's own "Not scoped" section defers generalising.
// Failure paths keep their inline role="alert" paragraphs, untouched.
//
// `season-create-status` had ZERO test coverage before this file — its
// announcement pins here are new work, not a guard moved.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// The three keys under test ECHO their params, so the value the page hands
// the message has to survive into the rendered text (and the plain key vs the
// hidden-by-filter key stay distinguishable in the DOM).
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => {
				const k = String(key);
				if (k === 'season_created') return (p: { name: string }) => `season_created ${p.name}`;
				if (k === 'event_created')
					return (p: { name: string; when: string }) => `event_created ${p.name} @ ${p.when}`;
				if (k === 'event_created_hidden_by_filter')
					return (p: { name: string; when: string }) =>
						`event_created_hidden_by_filter ${p.name} @ ${p.when}`;
				return () => k;
			}
		}
	)
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
	createSeasonMock,
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
	createSeason: createSeasonMock,
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
import type { Season } from '$lib/seasons/types';
import type { AgendaItem } from '$lib/agenda/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The CURRENT season, viewer is an editor — both create surfaces available. */
function editorSeason(): Season {
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

function agendaResult(overrides: { upcoming?: AgendaItem[] } = {}) {
	return fullAgendaResult({
		seasons: [editorSeason()],
		upcoming: overrides.upcoming ?? []
	});
}

/** An upcoming REHEARSAL far in the future — puts the 'rehearsal' chip on the
 *  filter bar (chips derive from buckets PRESENT in the rendered agenda). */
function upcomingRehearsal(): AgendaItem {
	return {
		id: 'up-reh',
		name: 'Tavaline proov',
		startDatetime: '2030-06-10T16:00:00.000Z',
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	} as AgendaItem;
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

function deferred<T>() {
	let resolveFn!: (v: T) => void;
	let rejectFn!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolveFn = res;
		rejectFn = rej;
	});
	return { promise, resolve: resolveFn, reject: rejectFn };
}

/** Drain the microtask queue so a just-settled promise chain fully lands
 *  (usable under fake timers, where waitFor's polling interval would hang). */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** TWO collectives — the context-change tests switch polyphony → bravura. */
function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', bravura: 'person-b' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'bravura', name: 'Bravura', personId: 'person-b' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
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
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	createSeasonMock.mockReset();
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

// ── helpers ─────────────────────────────────────────────────────────────────

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** The status region, asserted to exist. */
function region(container: HTMLElement, testid: string): HTMLElement {
	const el = q(container, testid);
	expect(el, `expected ${testid} to be in the DOM`).not.toBeNull();
	return el as HTMLElement;
}

/** Empty state: no announced text, out of visual flow via sr-only, IN the
 *  accessibility tree (no hidden/aria-hidden — those would kill the live
 *  region). */
function expectEmptyAndHidden(el: HTMLElement, label: string): void {
	expect(el.textContent?.trim(), `${label}: expected no text`).toBe('');
	expect(
		el.classList.contains('sr-only'),
		`${label}: an EMPTY region must carry sr-only — it may occupy no visible space`
	).toBe(true);
	expect(el.hasAttribute('hidden'), `${label}: hidden would silence the live region`).toBe(false);
	expect(el.getAttribute('aria-hidden'), `${label}: aria-hidden would silence the live region`).toBeNull();
}

/** Populated state: the text is there AND the region is on screen — sr-only
 *  gone from the SAME element (visibility from styling on content presence). */
function expectVisibleWithText(el: HTMLElement, text: string, label: string): void {
	expect(el.textContent?.trim(), `${label}: expected the success text`).toBe(text);
	expect(
		el.classList.contains('sr-only'),
		`${label}: a POPULATED region must NOT carry sr-only — the confirmation is for sighted users too (#298)`
	).toBe(false);
	expect(el.hasAttribute('hidden'), label).toBe(false);
	expect(el.getAttribute('aria-hidden'), label).toBeNull();
}

/** The success text must live in ONE place: the region itself (plus its own
 *  ancestor/descendant chain). A second element carrying the same sentence —
 *  e.g. a new visible paragraph added beside the untouched sr-only region —
 *  is a duplicated read for a screen-reader user: announced once, then met
 *  again as static content. */
function expectSingleRendering(container: HTMLElement, node: HTMLElement, text: string): void {
	const matches = Array.from(container.querySelectorAll('*')).filter(
		(el) => el.textContent?.trim() === text
	);
	expect(matches.length, 'the success text must exist somewhere').toBeGreaterThanOrEqual(1);
	for (const el of matches) {
		expect(
			el === node || el.contains(node) || node.contains(el),
			'the success text must render ONLY inside the status region — no second element may carry it (reuse what is there, #298)'
		).toBe(true);
	}
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

/** Render with an upcoming rehearsal so the 'rehearsal' filter chip exists. */
async function renderReadyWithRehearsal(): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(agendaResult({ upcoming: [upcomingRehearsal()] }));
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-filter-rehearsal')).not.toBeNull();
	});
	return container;
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

// ── season create ───────────────────────────────────────────────────────────

async function openSeasonForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-create-form')).not.toBeNull();
	});
}

async function submitSeasonCreate(container: HTMLElement, name: string): Promise<void> {
	await openSeasonForm(container);
	await fill(container, 'season-create-name', name);
	await fill(container, 'season-create-start', '2031-09-01');
	await fill(container, 'season-create-end', '2032-06-30');
	await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
	await waitFor(() => {
		expect(createSeasonMock).toHaveBeenCalled();
	});
}

// ── event create (panel-born — #213: the only entry point) ──────────────────

async function openEventFormFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

async function fillEventForm(
	container: HTMLElement,
	opts: { type?: string; name?: string } = {}
): Promise<void> {
	await selectValue(container, 'event-create-season', SEASON_ID);
	await selectValue(container, 'event-create-type', opts.type ?? 'concert');
	if (opts.name !== undefined) await fill(container, 'event-create-name', opts.name);
	await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
}

async function submitEventCreate(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
}

const EVENT_SUCCESS = 'event_created Spring concert @ 2027-04-18 19:00';
const SEASON_SUCCESS = 'season_created Season 2031';

// ═════════════════════════════════════════════════════════════════════════════
// 1 — mounted, empty, occupying no space (the empty-state guards)
// ═════════════════════════════════════════════════════════════════════════════

describe('#298 — both regions are mounted-empty-hidden from first render', () => {
	it('season-create-status and event-create-status: present before any create, role=status aria-live=polite, no text, sr-only (no visible space), not silenced', async () => {
		const container = await renderReady();
		for (const testid of ['season-create-status', 'event-create-status']) {
			const el = region(container, testid);
			expect(el.getAttribute('role'), testid).toBe('status');
			expect(el.getAttribute('aria-live'), testid).toBe('polite');
			expectEmptyAndHidden(el, testid);
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — season create: the announcement (NEW coverage) + the sight, on ONE node
// ═════════════════════════════════════════════════════════════════════════════

describe('#298 — season create: a successful create is announced AND seen', () => {
	it('the SAME always-mounted node goes empty → populated (the announcement), loses sr-only (the sight), and no second element carries the text', async () => {
		const container = await renderReady();

		// Captured BEFORE the create: present and EMPTY. This node — this very
		// reference — must be the one that later carries the text. An {#if}
		// implementation (visible to the eye, silent to a screen reader) mounts
		// a different node and fails the identity check below.
		const node = region(container, 'season-create-status');
		expectEmptyAndHidden(node, 'season-create-status at mount');

		await submitSeasonCreate(container, 'Season 2031');

		await waitFor(() => {
			expect(q(container, 'season-create-status')?.textContent?.trim()).toBe(SEASON_SUCCESS);
		});
		expect(
			q(container, 'season-create-status'),
			'the populated region must be the IDENTICAL DOM node observed empty at mount — never an {#if}-mounted replacement (a live region inserted already-populated is not announced)'
		).toBe(node);
		expectVisibleWithText(node, SEASON_SUCCESS, 'season-create-status after create');
		expect(container.querySelectorAll('[data-testid="season-create-status"]').length).toBe(1);
		expectSingleRendering(container, node, SEASON_SUCCESS);
	});

	it('clears on form REOPEN: opening [+ Season] again empties the region and returns it to sr-only', async () => {
		const container = await renderReady();
		await submitSeasonCreate(container, 'Season 2031');
		const node = region(container, 'season-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, SEASON_SUCCESS, 'season-create-status before reopen');
		});

		await openSeasonForm(container);
		expectEmptyAndHidden(node, 'season-create-status after reopen');
	});

	it('clears on a COLLECTIVE SWITCH: "Season X created" must not survive into a collective it never happened in', async () => {
		const container = await renderReady();
		await submitSeasonCreate(container, 'Season 2031');
		const node = region(container, 'season-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, SEASON_SUCCESS, 'season-create-status before switch');
		});

		selectedCollectiveDbStore.set('bravura');
		await waitFor(() => {
			expect(
				q(container, 'season-create-status')?.textContent?.trim(),
				'a genuine context change makes the message untrue — it must clear (Done-when #5)'
			).toBe('');
		});
		expectEmptyAndHidden(
			region(container, 'season-create-status'),
			'season-create-status after switch'
		);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — event create: the existing announcement gains the sight, on ONE node
// ═════════════════════════════════════════════════════════════════════════════

describe('#298 — event create: a successful create is announced AND seen', () => {
	it('the SAME always-mounted node goes empty → populated, loses sr-only, and no second element carries the text', async () => {
		const container = await renderReady();
		const node = region(container, 'event-create-status');
		expectEmptyAndHidden(node, 'event-create-status at mount');

		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(EVENT_SUCCESS);
		});
		expect(
			q(container, 'event-create-status'),
			'the populated region must be the IDENTICAL DOM node observed empty at mount — never an {#if}-mounted replacement'
		).toBe(node);
		expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status after create');
		expect(container.querySelectorAll('[data-testid="event-create-status"]').length).toBe(1);
		expectSingleRendering(container, node, EVENT_SUCCESS);
	});

	it('a FAILED write keeps the region empty and hidden — failure has its own role="alert", not this surface', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expectEmptyAndHidden(
			region(container, 'event-create-status'),
			'event-create-status after failed write'
		);
	});

	it('clears on form REOPEN (the HEAD gap: openEventCreateForm resets every field EXCEPT the status): reopening [+ Event] empties the region and returns it to sr-only', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);
		const node = region(container, 'event-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status before reopen');
		});

		// The panel survived the panel-born create (keepSeasonManage) — reopen
		// the form from it WITHOUT creating anything.
		await openEventFormFromPanel(container);
		expectEmptyAndHidden(node, 'event-create-status after reopen with nothing created');
	});

	it('clears on a COLLECTIVE SWITCH: the message must not sit on screen over a collective it does not belong to', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });
		await submitEventCreate(container);
		const node = region(container, 'event-create-status');
		await waitFor(() => {
			expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status before switch');
		});

		selectedCollectiveDbStore.set('bravura');
		await waitFor(() => {
			expect(
				q(container, 'event-create-status')?.textContent?.trim(),
				'a genuine context change makes the message untrue — it must clear (Done-when #5)'
			).toBe('');
		});
		expectEmptyAndHidden(
			region(container, 'event-create-status'),
			'event-create-status after switch'
		);
	});

	it('NO timer: the visible confirmation survives two full minutes — it clears on events, never on a clock', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillEventForm(container, { name: 'Spring concert' });

		// Hold the write in flight, then settle it UNDER fake timers: any
		// auto-dismiss setTimeout the success path registers is now trapped
		// where advanceTimersByTime can spring it.
		const write = deferred<string>();
		createEventMock.mockReturnValueOnce(write.promise);
		await submitEventCreate(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});

		vi.useFakeTimers();
		write.resolve('ev-new-1');
		await flushMicrotasks();
		const node = region(container, 'event-create-status');
		expectVisibleWithText(node, EVENT_SUCCESS, 'event-create-status on settle');

		vi.advanceTimersByTime(120_000);
		await flushMicrotasks();
		expectVisibleWithText(
			node,
			EVENT_SUCCESS,
			'event-create-status after 120s — a message that vanishes mid-read fails the readers who need it most (Done-when #5: no timer)'
		);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — #244 / Done-when #6: the excluded-by-filter case has somewhere to say so
// ═════════════════════════════════════════════════════════════════════════════

describe('#298 — the active filter excluding the new event is SAID, not implied', () => {
	it('filter active (rehearsal) + a CONCERT created → the region carries event_created_hidden_by_filter with the same {name}/{when}, visibly', async () => {
		const container = await renderReadyWithRehearsal();

		await fireEvent.click(q(container, 'agenda-filter-rehearsal') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'agenda-filter-rehearsal')?.getAttribute('aria-pressed')).toBe('true');
		});

		await openEventFormFromPanel(container);
		await fillEventForm(container, { type: 'concert', name: 'Spring concert' });
		await submitEventCreate(container);

		const HIDDEN = 'event_created_hidden_by_filter Spring concert @ 2027-04-18 19:00';
		await waitFor(() => {
			expect(
				q(container, 'event-create-status')?.textContent?.trim(),
				'created-but-filtered must say BOTH halves: created successfully, and the active filter is why it is not in the list (#244 / Done-when #6)'
			).toBe(HIDDEN);
		});
		const node = region(container, 'event-create-status');
		expectVisibleWithText(node, HIDDEN, 'event-create-status, excluded-by-filter');
		expectSingleRendering(container, node, HIDDEN);
	});

	it('filter active (rehearsal) + a REHEARSAL created → the plain event_created message: the filter admits it, nothing to explain', async () => {
		const container = await renderReadyWithRehearsal();

		await fireEvent.click(q(container, 'agenda-filter-rehearsal') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'agenda-filter-rehearsal')?.getAttribute('aria-pressed')).toBe('true');
		});

		await openEventFormFromPanel(container);
		await fillEventForm(container, { type: 'rehearsal', name: 'Extra rehearsal' });
		await submitEventCreate(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Extra rehearsal @ 2027-04-18 19:00'
			);
		});
	});
});

// ── the new key exists in ALL FOUR locales (the render-time mock above hides
//    a missing key, so the message FILES are pinned directly — same guard
//    family as page.event-create.spec.ts's #208 locale block) ────────────────

describe('#298 — locale coverage for the hidden-by-filter confirmation', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('event_created_hidden_by_filter exists in en/et/lv/uk, is non-empty, and carries the {name} and {when} slots', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['event_created_hidden_by_filter'];
			expect(msg, `${locale}.json is missing event_created_hidden_by_filter`).toBeDefined();
			expect(msg, `${locale}.json event_created_hidden_by_filter is empty`).toMatch(/\S/);
			expect(msg, `${locale}.json event_created_hidden_by_filter lacks {name}`).toContain(
				'{name}'
			);
			expect(msg, `${locale}.json event_created_hidden_by_filter lacks {when}`).toContain(
				'{when}'
			);
		}
	});
});

// (*MVOX:Tallis*)
