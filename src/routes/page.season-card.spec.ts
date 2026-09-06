// @vitest-environment happy-dom
//
// #261 RED — the season-card rework, on the ACTUAL agenda route (integration:
// real +page.svelte; only the data seams are mocked — same harness family as
// page.agenda-admin.spec.ts / page.season-manage-delete.spec.ts).
//
// Mihkel's ruling (2026-09-06, verbatim on the issue):
//
//   "+ Hooaeg" — when there are no seasons yet, then this is only control
//   there is for admin to act on. if there are, then these season cards are
//   below this control.
//   collapsed season card displays only the name and unfolds on click (whole
//   card). opened season card can be collapsed back by clicking on its title
//   row. opened season card also features the right-aligned red trashcan on
//   title row. gear not needed.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS (new)
//     season-card-expand    the COLLAPSED card's whole-card click target: a
//                           real native <button type="button"> spanning the
//                           card (w-full, min-h-11 — the #205 whole-field
//                           precedent), visible text = the season's NAME,
//                           aria-expanded="false", own aria-label from the NEW
//                           season_manage_expand_label key. Clicking it opens
//                           season-manage-panel.
//     season-card-collapse  the OPENED card's title-row click target: likewise
//                           a real <button> carrying the season name,
//                           aria-expanded="true" + aria-controls → the panel,
//                           min-h-11, own aria-label from the NEW
//                           season_manage_collapse_label key. Clicking it
//                           collapses the card. It inherits the gear's close
//                           refusal: DISABLED while seriesRunUnfinished ||
//                           eventConvertRunUnfinished.
//
//   SHAPE
//     - [+ Season] (season-create, testid unchanged) leaves the card and
//       stands ABOVE it as a standalone page-level control; its gate
//       (showSeasonCreate) is unchanged. With ZERO seasons + an editor it is
//       the ONLY control on the surface: the onboarding banner's own CTA
//       (agenda-onboarding-cta) is retired — the banner's explanatory steps
//       may stay, its second create button may not. The NON-editor zero-season
//       path (agenda-empty) is byte-untouched.
//     - COLLAPSED card = the season name and NOTHING else: no trashcan, no
//       gear, no plus, no describing words. Exception (PO reading 1): a
//       RUNNING cascade's counter (season-manage-delete-progress) and the
//       season-branch error slot stay visible at card level while collapsed;
//       when nothing runs, the name alone.
//     - OPENED title row = the collapse control (season name) + the red
//       trashcan, right-aligned (ml-auto, last button of the row). The armed
//       confirm/cancel pair renders ADJACENT on the opened title row, never
//       replacing the season name (PO reading 2), and is UNREACHABLE while
//       collapsed (the #236 collapsed-arming design is REVERSED).
//     - the GEAR (season-manage-gear) is REMOVED for everyone; role="toolbar"
//       and the #156 roving tabindex go with it (stated choice: at 1–2
//       controls the pattern is degenerate — plain buttons in natural tab
//       order). season_manage_gear_label and agenda_admin_toolbar_label are
//       dead keys, deleted from all four locales.
//     - FOCUS: closing the panel (title-row click OR Escape) returns focus to
//       the collapsed card's expand control — the gear was the old anchor.
//     - a COLLECTIVE SWITCH resets the card to collapsed (alongside
//       resetSeasonManage's existing seasonManageOpen reset).
//     - PANEL INTERNALS are byte-untouched (out of scope by the ruling).
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
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
	getSeriesDefaultsMock,
	deleteEventMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
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
	getSeriesDefaultsMock: vi.fn(),
	deleteEventMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: createEventSeriesMock,
	createEvent: createEventMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEvent: deleteEventMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock,
	countSeasonScope: countSeasonScopeMock,
	deleteSeason: deleteSeasonMock
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
	listMyAttendance: vi.fn().mockResolvedValue([]),
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
	listWorks: vi.fn().mockResolvedValue([]),
	listAllEditions: vi.fn().mockResolvedValue([]),
	listAllCopies: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fillTime } from '$lib/testing/timeControls';
import {
	openSeasonCardPanel,
	collapseSeasonCard,
	SEASON_CARD_EXPAND,
	SEASON_CARD_COLLAPSE
} from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
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
const CARD = 'agenda-admin-card';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

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

function upcomingSeason(): Season {
	return {
		id: 'season-2',
		name: 'Season 2027',
		startDate: isoDate(90),
		endDate: isoDate(200),
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

function noSeasonsResult() {
	return fullAgendaResult();
}

function setAuthedWithOneCollective(): void {
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

function setAuthedWithTwoCollectives(): void {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', 'org-b': 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'org-b', name: 'Org B', personId: 'person-p' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue([]);
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventSeriesMock.mockResolvedValue('series-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue([]);
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: '',
		durationMinutes: null,
		defaultLocation: '',
		defaultDescription: ''
	});
	deleteEventMock.mockResolvedValue(undefined);
	deleteEventSeriesMock.mockResolvedValue(0);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
	deleteSeasonMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
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
	deleteEventMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── helpers ─────────────────────────────────────────────────────────────────────

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** The text a SIGHTED user reads — the ruling's "displays only the name" is
 *  about the visible face, so this drops what only AT consumes (`.sr-only`
 *  action verbs, #205 review F1) and what only sighted users consume as a
 *  state indicator, never as words (`aria-hidden` disclosure glyphs, #261
 *  review F2). Both are pinned positively on the controls themselves. */
function visibleText(el: HTMLElement): string {
	const clone = el.cloneNode(true) as HTMLElement;
	for (const hidden of clone.querySelectorAll('.sr-only, [aria-hidden="true"]')) hidden.remove();
	return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

/** Open the panel and start a HANGING weekly bulk-series run (3 Mondays; the
 *  first occurrence POST stays on the wire). Returns the per-occurrence
 *  resolvers so the test can finish the run. */
async function startHangingSeriesRun(container: HTMLElement): Promise<Array<(id: string) => void>> {
	const resolvers: Array<(id: string) => void> = [];
	createEventMock.mockImplementation(
		() =>
			new Promise<string>((res) => {
				resolvers.push(res);
			})
	);
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
	await selectValue(container, 'series-create-day', '1');
	await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
	await waitFor(() => {
		expect(resolvers.length).toBe(1);
	});
	return resolvers;
}

/** deleteSeason mock the tests drive by hand (the delete-spec idiom). */
type PageOnProgress = (current: number, total: number, kind: string) => void;
type PageScope = { series: number; events: number; repertoireItems: number };
function hangingDeleteSeason() {
	let onProgress: PageOnProgress | undefined;
	let resolveWith!: (scope: PageScope) => void;
	let rejectWith!: (reason: unknown) => void;
	deleteSeasonMock.mockImplementation(
		async (
			_cfg: unknown,
			_seasonId: string,
			_impl: unknown,
			opts?: { onProgress?: PageOnProgress }
		) => {
			onProgress = opts?.onProgress;
			return await new Promise<PageScope>((res, rej) => {
				resolveWith = res;
				rejectWith = rej;
			});
		}
	);
	return {
		tick: (current: number, total: number, kind: string) => onProgress?.(current, total, kind),
		finish: (scope: PageScope) => resolveWith(scope),
		fail: (reason: unknown) => rejectWith(reason)
	};
}

/** Arm the season delete on the OPENED title row (the only place it exists). */
async function armSeasonDelete(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season-confirm')).not.toBeNull();
	});
}

// ── (1) "+ Hooaeg" stands ABOVE the card ────────────────────────────────────────

describe('season card #261 — [+ Season] stands above the card as a standalone control', () => {
	it('season-create renders OUTSIDE agenda-admin-card and PRECEDES it in DOM order; testid + min-h-11 + gate unchanged; clicking it opens the season form (integration)', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
			expect(q(container, CARD)).not.toBeNull();
		});

		const create = q(container, 'season-create') as HTMLElement;
		const card = q(container, CARD) as HTMLElement;
		expect(
			create.closest(`[data-testid="${CARD}"]`),
			'#261 — the create trigger no longer lives inside the season card'
		).toBeNull();
		expect(
			create.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
			'#261 — the season card sits BELOW the [+ Season] control'
		).toBeTruthy();
		expect(Array.from(create.classList), '44px floor survives the move').toContain('min-h-11');

		// The trigger still opens the same page-level form, wired on the route.
		await fireEvent.click(create);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		expect(gotoMock).not.toHaveBeenCalled();
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('gate unchanged: an UPCOMING season hides [+ Season]; the card (its expand control) stays', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(q(container, 'season-create')).toBeNull();
	});
});

// ── (1b) zero seasons + editor: THE only control ────────────────────────────────

describe('season card #261 — zero seasons: [+ Season] is the ONLY control for an editor', () => {
	it('no card, no second create button: agenda-admin-card is GONE, the onboarding banner presents NO cta of its own (agenda-onboarding-cta retired), season-create stands alone and opens the form', async () => {
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		// Nothing to manage → no card, no mini-frame around the lone button.
		expect(q(container, CARD), '#261 — no season, no season card').toBeNull();
		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		// The banner's redundant second create control is GONE — the standalone
		// [+ Season] is the one and only way in. (The banner's explanatory
		// steps may stay; a second button may not.)
		expect(
			q(container, 'agenda-onboarding-cta'),
			'#261 — the onboarding CTA merges into the standalone [+ Season]'
		).toBeNull();

		await fireEvent.click(q(container, 'season-create') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
	});

	it('NON-editor zero-season path byte-untouched: agenda-empty renders, no onboarding, no create control, no card', async () => {
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'agenda-empty')).not.toBeNull();
		expect(q(container, 'agenda-onboarding')).toBeNull();
		expect(q(container, 'season-create')).toBeNull();
		expect(q(container, CARD)).toBeNull();
	});
});

// ── (2) collapsed card = season name ONLY ───────────────────────────────────────

describe('season card #261 — the collapsed card displays only the season name', () => {
	it('the card text is the season name and NOTHING else — no trashcan, no gear, no plus, no confirm/cancel, no describing words', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, CARD)).not.toBeNull();
		});
		const card = q(container, CARD) as HTMLElement;

		// The whole visible face is the name — "no describing words".
		expect(visibleText(card)).toBe('Season 2026');
		// EXACTLY one control: the expand target. Nothing else to tap.
		expect(card.querySelectorAll('button')).toHaveLength(1);
		expect(q(container, 'season-manage-delete-season'), 'no trashcan collapsed').toBeNull();
		expect(q(container, 'season-manage-gear'), 'the gear is removed').toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).toBeNull();
		expect(
			card.querySelector('[data-testid="season-create"]'),
			'#261 — [+ Season] left the card'
		).toBeNull();
		// No counter/error either while nothing runs.
		expect(q(container, 'season-manage-delete-progress')).toBeNull();
		expect(q(container, 'season-manage-delete-error')).toBeNull();
	});

	it('the expand control is a real, keyboard-reachable native button spanning the card: BUTTON/type=button, w-full + min-h-11, aria-expanded=false, NEW accessible-name key; merely rendering writes nothing', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		const expand = q(container, SEASON_CARD_EXPAND) as HTMLButtonElement;

		expect(expand.tagName).toBe('BUTTON');
		expect(expand.getAttribute('type')).toBe('button');
		// The #205 whole-field precedent: the WHOLE card face is the target.
		const classes = Array.from(expand.classList);
		expect(classes, 'whole-card click target (w-full)').toContain('w-full');
		expect(classes, '44px touch-target floor (min-h-11)').toContain('min-h-11');
		// TAB-reachable: a native button with no roving −1 (the toolbar roving
		// pattern is retired with the gear).
		expect(expand.getAttribute('tabindex')).not.toBe('-1');
		expect(expand.disabled).toBe(false);
		expect(expand.getAttribute('aria-expanded')).toBe('false');
		// #261 review F1 — the accessible name SUPPLEMENTS the visible name, it
		// does not replace it. An `aria-label` supersedes the button's contents,
		// so "Open season card" alone left the visible "Season 2026" outside the
		// accname: WCAG 2.1 AA 2.5.3 (Label in Name) fails and a voice-control
		// user cannot say "click Season 2026". The #205 review F1 idiom instead:
		// sr-only verb + visible value, both INSIDE the button.
		expect(expand.hasAttribute('aria-label'), 'no accname-superseding aria-label').toBe(false);
		const expandName = expand.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(expandName, 'the NEW key rides inside as the sr-only verb').toContain(
			'season_manage_expand_label'
		);
		expect(expandName, 'the visible season name is part of the accessible name').toContain(
			'Season 2026'
		);
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2026/ })
		).toBe(expand);
		// The sr-only verb is genuinely sr-only: the visible text is the name.
		const srOnly = expand.querySelector('.sr-only') as HTMLElement;
		expect(srOnly, 'the verb is visually hidden').not.toBeNull();
		expect(srOnly.textContent?.trim()).toBe('season_manage_expand_label');

		// #261 review F2 — the card SAYS it is a target: the #205 `group` +
		// hover-cue treatment, plus an aria-hidden disclosure glyph. Without it
		// the card renders exactly like the static <h2> it replaced, and with
		// the gear gone this is the ONLY way into season management.
		expect(classes, 'the #205 group-hover cue harness').toContain('group');
		expect(
			classes.some((c) => c.startsWith('hover:')),
			'a hover affordance on the whole-card target'
		).toBe(true);
		const glyph = expand.querySelector('[aria-hidden="true"]') as HTMLElement;
		expect(glyph, 'a disclosure glyph marks the card as unfoldable').not.toBeNull();
		expect(
			Array.from(glyph.classList).some((c) => c.startsWith('group-hover:')),
			'the glyph emphasises on hover (the #205 ✎ treatment)'
		).toBe(true);

		// #261 review F3 — the card keeps its place in the heading outline: on
		// main the season name was an <h2> (#238), and folding it into a button
		// must not cost the agenda's only admin heading. WAI-APG Accordion: the
		// heading WRAPS the button.
		const heading = expand.closest('h2');
		expect(heading, 'the collapsed card is a heading (H-key / rotor reachable)').not.toBeNull();
		expect(within(container).getByRole('heading', { level: 2, name: /Season 2026/ })).toBe(
			heading
		);

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no card, no expand control, no title row — absent from the DOM, not hidden (fail-closed)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, CARD)).toBeNull();
		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, SEASON_CARD_COLLAPSE)).toBeNull();
		expect(q(container, 'season-manage-delete-season')).toBeNull();
	});
});

// ── (3) the whole collapsed card unfolds on click ───────────────────────────────

describe('season card #261 — clicking the collapsed card expands it', () => {
	it('click → season-manage-panel opens INLINE (no navigation) and the panel loads THIS season’s lists (integration: real route wiring)', async () => {
		const container = await renderReady();
		const panel = await openSeasonCardPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(panel.getAttribute('role')).toBe('dialog');
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});
		expect(listEventsForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		// The collapsed-state control yields to the opened title row.
		expect(q(container, SEASON_CARD_EXPAND), 'expand control is the COLLAPSED face').toBeNull();
	});
});

// ── (4)+(5) the opened title row: collapse control + right-aligned trashcan ─────

describe('season card #261 — the opened card’s title row', () => {
	it('the title row is a real collapse button carrying the season name: BUTTON/type=button, min-h-11, aria-expanded=true, aria-controls → the panel, NEW accessible-name key', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement;
		expect(collapse, 'the opened card offers its title row as the collapse target').not.toBeNull();
		expect(collapse.tagName).toBe('BUTTON');
		expect(collapse.getAttribute('type')).toBe('button');
		expect(Array.from(collapse.classList)).toContain('min-h-11');
		expect(collapse.getAttribute('tabindex')).not.toBe('-1');
		expect(collapse.getAttribute('aria-expanded')).toBe('true');
		// #261 review round 2 F1 — the OPENED target spans the title row, the
		// same contract the COLLAPSED face gets from `w-full` above. Two states
		// of one card must not offer two radically different target sizes (the
		// #205 review round 3 F3 rule). The heading absorbs the row's free space
		// and the button fills the heading, so the whole row up to the trashcan
		// is live rather than only the name's own width.
		expect(
			Array.from(collapse.classList),
			'the collapse button fills its heading (w-full), as the expand control fills the card'
		).toContain('w-full');
		const collapseRowHeading = collapse.closest('h2') as HTMLElement;
		expect(
			Array.from(collapseRowHeading.classList),
			'the heading absorbs the row’s free space (flex-1) so the target reaches the trashcan'
		).toContain('flex-1');
		// #261 review round 2 F2 — the two row contracts the retired
		// agenda-admin toolbar test carried, re-homed onto the title row that
		// replaced it. happy-dom computes no layout, so the classes ARE the
		// contract here and the live 375px lv/uk check stays a browser-gate job.
		const collapseRow = collapseRowHeading.parentElement as HTMLElement;
		const collapseRowClasses = Array.from(collapseRow.classList);
		expect(collapseRowClasses, 'the title row is a flex row').toContain('flex');
		expect(
			collapseRowClasses,
			'the long lv/uk locales must be allowed to wrap at 375px, not overflow the card'
		).toContain('flex-wrap');
		expect(
			collapseRowClasses,
			'w-fit hugs the content and leaves the trashcan’s ml-auto nothing to push against'
		).not.toContain('w-fit');
		// #261 review F1 — same Label-in-Name contract as the expand control:
		// the NEW key supplements the season name inside the button, it does
		// not supersede it via aria-label.
		expect(collapse.hasAttribute('aria-label'), 'no accname-superseding aria-label').toBe(false);
		const collapseName = collapse.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(collapseName).toContain('season_manage_collapse_label');
		expect(collapseName).toContain('Season 2026');
		expect(
			within(container).getByRole('button', { name: /season_manage_collapse_label.*Season 2026/ })
		).toBe(collapse);
		// #261 review F2 — the title row carries the same affordance cue.
		const collapseClasses = Array.from(collapse.classList);
		expect(collapseClasses, 'the #205 group-hover cue harness').toContain('group');
		expect(
			collapseClasses.some((c) => c.startsWith('hover:')),
			'a hover affordance on the title-row target'
		).toBe(true);
		expect(
			collapse.querySelector('[aria-hidden="true"]'),
			'a disclosure glyph marks the title row as foldable'
		).not.toBeNull();
		// #261 review F3 — the opened card keeps its heading too, and the
		// heading's accessible name is the season (the sr-only verb rides in
		// the button, but the H-key landing target is the card's identity).
		const collapseHeading = collapse.closest('h2');
		expect(collapseHeading, 'the opened title row is a heading').not.toBeNull();
		expect(within(container).getByRole('heading', { level: 2, name: /Season 2026/ })).toBe(
			collapseHeading
		);
		// The trashcan is the heading's SIBLING, not part of the title.
		expect(
			collapseHeading?.contains(q(container, 'season-manage-delete-season')),
			'the destructive control is not inside the heading'
		).toBe(false);
		const controlsId = collapse.getAttribute('aria-controls');
		expect(controlsId, 'the collapse control declares aria-controls').toBeTruthy();
		const target = container.querySelector(`[id="${controlsId}"]`);
		expect((target as HTMLElement | null)?.getAttribute('data-testid')).toBe(
			'season-manage-panel'
		);
	});

	it('the red trashcan rides the OPENED title row, right-aligned (ml-auto, last button of the row), never inside the panel — TrashIcon substance pins survive', async () => {
		const container = await renderReady();
		const panel = await openSeasonCardPanel(container);

		const trashcan = q(container, 'season-manage-delete-season') as HTMLButtonElement;
		expect(trashcan, 'opened: the trashcan exists').not.toBeNull();
		expect(panel.contains(trashcan), 'title row, not panel internals').toBe(false);
		expect((q(container, CARD) as HTMLElement).contains(trashcan)).toBe(true);

		// Right-aligned on the title row: same row as the collapse control,
		// pushed to the edge, the row's LAST button.
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		const row = trashcan.parentElement as HTMLElement;
		expect(row.contains(collapse), 'trashcan and title text share ONE row').toBe(true);
		expect(
			collapse.compareDocumentPosition(trashcan) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the name leads, the trashcan trails'
		).toBeTruthy();
		expect(
			Array.from(trashcan.classList),
			'right-aligned via ml-auto (the retired gear’s slot)'
		).toContain('ml-auto');
		const rowButtons = Array.from(row.querySelectorAll<HTMLButtonElement>('button'));
		expect(rowButtons[rowButtons.length - 1]).toBe(trashcan);

		// #238's substance pins, re-homed: THE TrashIcon component, tintable,
		// decorative SVG, red tokens, 44px floors, named button.
		const svgs = trashcan.querySelectorAll('svg');
		expect(svgs).toHaveLength(1);
		expect(svgs[0].getAttribute('data-icon')).toBe('trash');
		expect(svgs[0].getAttribute('aria-hidden')).toBe('true');
		expect(svgs[0].outerHTML).toContain('currentColor');
		expect((trashcan.textContent ?? '').trim(), 'icon-only').toBe('');
		const classes = Array.from(trashcan.classList);
		expect(classes).toContain('text-red-700');
		expect(classes).toContain('hover:text-red-800');
		expect(classes).toContain('min-h-11');
		expect(classes).toContain('min-w-11');
		expect(trashcan.getAttribute('aria-label')).toContain('season_manage_season_delete');
	});

	it('clicking the title row collapses the card back to the name-only face; nothing was written by open + close', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await collapseSeasonCard(container);

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(q(container, SEASON_CARD_COLLAPSE)).toBeNull();
		expect(q(container, 'season-manage-delete-season'), 'the trashcan folds away').toBeNull();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(visibleText(q(container, CARD) as HTMLElement)).toBe('Season 2026');
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});
});

// ── (PO reading 2) the armed pair on the OPENED title row only ──────────────────

describe('season card #261 — arming the season delete lives on the opened title row', () => {
	it('arming renders confirm/cancel ADJACENT on the title row: the season name STAYS visible, the collapse control stays mounted, the panel stays open', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const cancel = q(container, 'season-manage-delete-season-cancel') as HTMLElement;
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		expect(collapse, 'arming must NOT replace the title row').not.toBeNull();
		expect(collapse.textContent?.trim(), 'the season name never leaves the row').toContain(
			'Season 2026'
		);
		// Adjacent: the armed pair shares the title row with the name.
		const row = confirm.parentElement as HTMLElement;
		expect(row.contains(cancel)).toBe(true);
		expect(row.contains(collapse), 'confirm/cancel render beside the name, not instead').toBe(
			true
		);
		expect(q(container, 'season-manage-panel'), 'arming does not collapse the card').not.toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('while COLLAPSED there is nothing to arm: no trashcan, no armed pair — the #236 collapsed-arming flow is retired', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});

		expect(q(container, 'season-manage-delete-season')).toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).toBeNull();
		expect(countSeasonScopeMock).not.toHaveBeenCalled();
	});

	it('collapsing while armed disarms (existing close contract): re-expanding shows the idle trashcan, not a live confirm', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		await collapseSeasonCard(container);
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();

		await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});
});

// ── (6) the gear is removed ─────────────────────────────────────────────────────

describe('season card #261 — the gear is gone, and its close-refusal moved to the title row', () => {
	it('season-manage-gear exists in NO state (collapsed, opened, armed) and the gear-label copy feeds nothing', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, CARD)).not.toBeNull();
		});
		expect(q(container, 'season-manage-gear')).toBeNull();

		await openSeasonCardPanel(container);
		expect(q(container, 'season-manage-gear')).toBeNull();

		await armSeasonDelete(container);
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(container.innerHTML).not.toContain('season_manage_gear_label');
	});

	it('role="toolbar" and the roving tabindex retire with it: no toolbar role inside the card, and the title-row buttons are plain tab stops', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		const card = q(container, CARD) as HTMLElement;
		expect(card.querySelector('[role="toolbar"]'), '#261 — no toolbar frame left').toBeNull();
		expect(container.innerHTML).not.toContain('agenda_admin_toolbar_label');
		// Natural tab order: neither title-row control parks at tabindex -1.
		expect(
			(q(container, SEASON_CARD_COLLAPSE) as HTMLElement).getAttribute('tabindex')
		).not.toBe('-1');
		expect(
			(q(container, 'season-manage-delete-season') as HTMLElement).getAttribute('tabindex')
		).not.toBe('-1');
	});

	it('mid bulk-series run the title-row collapse is VISIBLY refused (disabled), a click cannot discard the panel, Escape is refused too — and the refusal lifts when the run finishes', async () => {
		const container = await renderReady();
		const resolvers = await startHangingSeriesRun(container);

		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement;
		expect(
			collapse.disabled,
			'the close control must be visibly refused mid-run, not an enabled no-op'
		).toBe(true);
		await fireEvent.click(collapse);
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'series-create-form')).not.toBeNull();

		await fireEvent.keyDown(q(container, 'season-manage-panel') as HTMLElement, {
			key: 'Escape'
		});
		expect(q(container, 'season-manage-panel'), 'Escape honours the same refusal').not.toBeNull();

		// Finish the run (3 Mondays over the fixture range) — the refusal lifts.
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
		await waitFor(() => {
			expect(
				(q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement).disabled
			).toBe(false);
		});
		await collapseSeasonCard(container);
	});
});

// ── (7) focus management: the expand control is the new anchor ──────────────────

describe('season card #261 — closing returns focus to the collapsed card’s expand control', () => {
	it('title-row collapse: focus lands on season-card-expand (the collapse control unmounts; a keyboard user is not dropped at <body>)', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await collapseSeasonCard(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
		});
	});

	it('Escape at the focused panel still closes (the panel keydown route survives) and focus lands on the expand control', async () => {
		const container = await renderReady();
		const panel = await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(panel);
		});

		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
	});
});

// ── (8) collective switch resets the card to collapsed ──────────────────────────

describe('season card #261 — a collective switch resets the expand/collapse state', () => {
	it('open in A, switch to B: B renders the COLLAPSED card (expand control, no panel), and expanding it opens B’s own fresh panel', async () => {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openSeasonCardPanel(container);

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND), 'B starts collapsed').not.toBeNull();
		});
		expect(q(container, SEASON_CARD_COLLAPSE)).toBeNull();

		await openSeasonCardPanel(container);
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
});

// ── (PO reading 1) a RUNNING cascade stays visible on the collapsed card ────────

describe('season card #261 — transient cascade state still shows while collapsed', () => {
	it('a season cascade started from the OPENED row keeps its card-level counter through a mid-cascade collapse: name + counter visible, no controls beyond the expand target', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await armSeasonDelete(container);
		await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});

		run.tick(2, 5, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});

		// The SEASON cascade does not block the collapse (only series/convert
		// runs do) — fold the card shut around the running cascade.
		await collapseSeasonCard(container);

		const progress = q(container, 'season-manage-delete-progress') as HTMLElement;
		expect(progress, 'the RUNNING counter survives the collapse').not.toBeNull();
		expect(progress.getAttribute('role')).toBe('status');
		const card = q(container, CARD) as HTMLElement;
		expect(card.contains(progress), 'card level — visible while collapsed').toBe(true);
		expect(card.textContent, 'the name stays alongside the counter').toContain('Season 2026');
		expect(q(container, 'season-manage-delete-season'), 'still no collapsed trashcan').toBeNull();

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
	});

	it('a cascade that FAILS after the collapse lands its season-branch error at card level, visible on the collapsed card', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await armSeasonDelete(container);
		await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalled();
		});
		await collapseSeasonCard(container);

		run.fail({
			code: 'season-cascade-partial',
			seasonId: SEASON_ID,
			deletedCount: 2,
			totalCount: 6,
			failure: new Error('boom')
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const alert = q(container, 'season-manage-delete-error') as HTMLElement;
		expect(alert.getAttribute('role')).toBe('alert');
		expect((q(container, CARD) as HTMLElement).contains(alert)).toBe(true);
		expect(q(container, 'season-manage-panel'), 'still collapsed').toBeNull();
	});
});

// ── (10) i18n: two NEW keys, two DEAD keys, all four locales ────────────────────

describe('season card #261 — i18n: the new accessible-name keys exist, the gear/toolbar keys are gone', () => {
	type MessageFile = Record<string, string>;
	function readLocale(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it('season_manage_expand_label / season_manage_collapse_label carry the proposed copy in en/et/lv/uk (Comenius may refine wording — the keys and their presence are the contract)', () => {
		const expected = {
			en: { expand: 'Open season card', collapse: 'Close season card' },
			et: { expand: 'Ava hooaja kaart', collapse: 'Sulge hooaja kaart' },
			lv: { expand: 'Atvērt sezonas karti', collapse: 'Aizvērt sezonas karti' },
			uk: { expand: 'Відкрити картку сезону', collapse: 'Закрити картку сезону' }
		} as const;
		for (const [locale, copy] of Object.entries(expected)) {
			const msgs = readLocale(locale);
			expect(msgs.season_manage_expand_label, `${locale}.json season_manage_expand_label`).toBe(
				copy.expand
			);
			expect(
				msgs.season_manage_collapse_label,
				`${locale}.json season_manage_collapse_label`
			).toBe(copy.collapse);
		}
	});

	it('season_manage_gear_label, agenda_admin_toolbar_label and agenda_onboarding_cta are REMOVED from all four locales (dead keys — the #236 season_manage_panel_label discipline)', () => {
		// #261 review F4 — agenda_onboarding_cta joins the list. This same
		// contract retires the onboarding banner's own create button (the key's
		// ONLY render site), so leaving its copy behind applied the dead-key
		// discipline to two keys and exempted a third the same diff created.
		const dead = [
			'season_manage_gear_label',
			'agenda_admin_toolbar_label',
			'agenda_onboarding_cta'
		] as const;
		for (const locale of ['en', 'et', 'lv', 'uk'] as const) {
			const msgs = readLocale(locale);
			for (const key of dead) {
				expect(key in msgs, `${locale}.json still carries the unconsumed ${key}`).toBe(false);
			}
		}
	});
});

// (*MVOX:Tallis* — #261 RED: season-card rework — [+ Hooaeg] above the card,
// name-only collapsed card as whole-card expand button, title-row collapse +
// right-aligned trashcan, opened-only arming, gear removed with refusal moved
// to the title row, expand-control focus anchor, collective-switch reset,
// cascade counter/error visible while collapsed, two new i18n keys ×4 + two
// dead keys retired)
