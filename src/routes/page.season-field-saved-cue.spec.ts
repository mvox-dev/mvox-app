// @vitest-environment happy-dom
//
// #328 RED — the SEASON-FIELD leg of the partials trio: the season-manage
// panel's blur-commit name/start_date/end_date edits (confirmSeasonFieldEdit)
// handle failure honestly (revert + season-edit-error-{field} role="alert")
// and say NOTHING when a write lands. The saved state gets its own cue.
//
// CONTRACT (issue #328 + Gama's one-shape/one-node-per-surface ruling,
// #328 comment 5637755878):
//   - CUE SHAPE — the family shape every sibling already carries (#324
//     repertoire-manage-status, #325 season-manage-conductor-status, #326
//     rsvp-saved-status, #327 attendance): a PERSISTENT role="status"
//     aria-live="polite" region, mounted (empty) from the panel's first
//     render, text set only when a write RECONCILES, cleared by the time the
//     NEXT attempt is in flight — never on a timer. Whether the node is
//     visible or sr-only is GREEN's stated choice (the family holds both:
//     #324/#325 sr-only, #326/#327 visible); these specs pin the live-region
//     mechanics, not the class.
//   - OWN NODE — data-testid="season-edit-status", ONE region shared by the
//     three season fields (one node per SURFACE), and it is NOT the conductor
//     half's season-manage-conductor-status nor any repertoire node: a live
//     region announces changes to ITS contents, so reusing a neighbour's node
//     would announce another queue's settle (Gama's ruling — three new
//     regions in #328, none of them an existing one).
//   - TEXT — season_manage_saved (mirrors this surface's own failure key
//     season_manage_save_error; the four-locale copy is pinned by
//     src/lib/i18n/trioSavedKeys.spec.ts).
//   - LATE-SETTLE GUARD (stated choice per the PO build note: this surface
//     FOLLOWS #325's generation thread, not a fourth invention) — the cue
//     threads the SAME seasonManageSwitchGeneration capture-compare
//     confirmSeasonFieldEdit's .then/.catch already run: a save reconciling
//     after a season switch must not announce onto the new season's panel,
//     and resetSeasonManage starts the new panel's region blank.
//   - REFUSAL CLEARS (#328 review R2-F2) — a pre-write refusal (the date-range
//     check, which returns before the start-of-attempt clear) is an attempt
//     too: it clears the region rather than letting an earlier write's "saved"
//     stand beside it.
//   - FAILURE BYTE-PRESERVED — the existing revert + season-edit-error-{field}
//     role="alert" (season_manage_save_error) semantics are unchanged, and a
//     failed write earns NO saved announcement.
//
// Messages are mocked leniently (Proxy → key name): every text assertion pins
// the KEY.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params === undefined ? String(key) : `${String(key)} ${JSON.stringify(params)}`
		}
	)
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
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
	listRepertoireItemsMock,
	deleteRepertoireItemMock,
	updateRepertoireStatusMock,
	getSeriesDefaultsMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
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
	listRepertoireItemsMock: vi.fn(),
	deleteRepertoireItemMock: vi.fn(),
	updateRepertoireStatusMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock,
	countSeasonScope: countSeasonScopeMock,
	deleteSeason: deleteSeasonMock
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: vi.fn()
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock,
	deleteRepertoireItem: deleteRepertoireItemMock,
	updateRepertoireStatus: updateRepertoireStatusMock
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
	listRepertoireItems: listRepertoireItemsMock
}));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = { db: 'polyphony', token: 'jwt-abc' };
const SEASON_ID = 'season-1';
const SEASON_B_ID = 'season-2';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: ['p-grace'],
		owners: [],
		editors: ['person-p']
	};
}

function upcomingSeason(): Season {
	return {
		id: SEASON_B_ID,
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
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

function twoSeasonResult() {
	return fullAgendaResult({ seasons: [currentSeason(), upcomingSeason()] });
}

function fixtureRows(): RosterRow[] {
	return [
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
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	listRepertoireItemsMock.mockResolvedValue([]);
	deleteRepertoireItemMock.mockResolvedValue(undefined);
	updateRepertoireStatusMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({});
	deleteEventSeriesMock.mockResolvedValue(undefined);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 0, events: 0, repertoireItems: 0 });
	deleteSeasonMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

/** Every per-season collapsed entry currently on the page, in DOM order. */
function expandButtons(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll('[data-testid="season-card-expand"]')
	) as HTMLElement[];
}

function expandFor(container: HTMLElement, seasonName: string): HTMLElement | null {
	return expandButtons(container).find((b) => b.textContent?.includes(seasonName)) ?? null;
}

/** Open (or switch to) the panel FOR the named season via its own entry. */
async function openPanelForSeason(container: HTMLElement, seasonName: string): Promise<void> {
	await waitFor(() => {
		expect(expandFor(container, seasonName), `an entry for ${seasonName}`).not.toBeNull();
	});
	await fireEvent.click(expandFor(container, seasonName) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe(seasonName);
	});
}

/** Tap a season field's whole-field activator and hand back the input. */
async function beginFieldEdit(
	container: HTMLElement,
	field: 'name' | 'start_date' | 'end_date'
): Promise<HTMLInputElement> {
	await waitFor(() => {
		expect(q(container, `season-edit-btn-${field}`), `season-edit-btn-${field}`).not.toBeNull();
	});
	await fireEvent.click(q(container, `season-edit-btn-${field}`) as HTMLElement);
	return await waitFor(() => {
		const el = q(container, `season-edit-input-${field}`);
		expect(el, `season-edit-input-${field} missing after tapping edit`).not.toBeNull();
		return el as HTMLInputElement;
	});
}

/** Type a new value and blur — the commit gesture confirmSeasonFieldEdit runs on. */
async function commitFieldEdit(
	container: HTMLElement,
	field: 'name' | 'start_date' | 'end_date',
	value: string
): Promise<void> {
	const input = await beginFieldEdit(container, field);
	await fireEvent.input(input, { target: { value } });
	await fireEvent.blur(input);
}

/** A promise the test settles by hand — the in-flight window under test. */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (v: T) => void;
	reject: (e: Error) => void;
} {
	let resolve!: (v: T) => void;
	let reject!: (e: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// ── the region: persistent, own node, empty at rest ────────────────────────────

describe('#328 season fields — the saved-cue region exists from first render', () => {
	it('open panel: a PERSISTENT empty role="status" aria-live="polite" region (season-edit-status) is mounted BEFORE any write — and it is its OWN node, not the conductor half’s', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		const status = q(container, 'season-edit-status');
		expect(status, 'expected the persistent season-edit-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		// ONE region for the surface — never a per-field forest.
		expect(container.querySelectorAll('[data-testid="season-edit-status"]')).toHaveLength(1);

		// Gama's one-node-PER-SURFACE ruling: this is a NEW region, distinct
		// from the conductor half's (#325) — one region serving several queues
		// would announce a settle the user did not cause.
		const conductorStatus = q(container, 'season-manage-conductor-status');
		expect(conductorStatus, 'the #325 conductor region must still exist').not.toBeNull();
		expect(status).not.toBe(conductorStatus);
	});
});

// ── the cue: reconcile announces, and only reconcile ───────────────────────────

describe('#328 season fields — a write that reconciles announces saved', () => {
	it('name blur-commit: NOTHING announced while the write is in flight; the settle sets season_manage_saved into season-edit-status; no error node; the field stays editable', async () => {
		const d = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'name', 'Renamed 2026');
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed 2026');

		// Optimistic value on screen, write still open: the cue must NOT have
		// fired yet — "saved" is the RECONCILE's statement, never the tap's.
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
		expect(q(container, 'season-edit-error-name')).toBeNull();
		// Pending released — the next edit is reachable.
		expect((q(container, 'season-edit-btn-name') as HTMLButtonElement).disabled).toBe(false);
	});

	it('start_date commit announces into the SAME season-edit-status region — one node per surface, shared by all three fields', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'start_date', isoDate(-10));
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'start_date', isoDate(-10));
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
		expect(container.querySelectorAll('[data-testid="season-edit-status"]')).toHaveLength(1);
	});

	it('the cue describes the LATEST write: by the time a second edit is in flight the region is blank again, and its settle re-announces', async () => {
		const first = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValueOnce(first.promise);
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'name', 'Renamed 2026');
		first.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});

		// Second attempt: cleared at the start of the attempt (the family rule —
		// never a stale "saved" beside a live write), announced again on settle.
		const second = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValueOnce(second.promise);
		await commitFieldEdit(container, 'name', 'Renamed again');
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');

		second.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
	});
});

// ── failure: byte-preserved, and it earns NO cue ───────────────────────────────

describe('#328 season fields — failure handling stays byte-identical', () => {
	it('a rejected name write still reverts the value and renders season-edit-error-name role="alert" (season_manage_save_error) — and season-edit-status announces NOTHING', async () => {
		const d = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValueOnce(d.promise);
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'name', 'Renamed 2026');
		d.reject(new Error('season write rejected'));

		await waitFor(() => {
			const alert = q(container, 'season-edit-error-name');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('season_manage_save_error');
		});
		// The revert stands — the pre-edit value is back on screen.
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Renamed 2026');
		// Failure and saved are mutually exclusive.
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
	});

	it('a refused RANGE edit (no wire call at all) still shows the range alert and never announces saved', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		// end_date before the season's start — refused BEFORE any write.
		await commitFieldEdit(container, 'end_date', isoDate(-60));
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
	});

	it('#328 review R2-F2 — a refusal AFTER a successful write clears the region: no stale “saved” standing beside the fresh range alert', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		// A real write first, so the region genuinely reads "saved".
		await commitFieldEdit(container, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
		updateSeasonFieldMock.mockClear();

		// Now a refused range edit — no wire call at all, and the cue must not
		// linger beside it: the start-of-attempt clear lives past the early
		// return, so the refusal has to do its own clearing.
		await commitFieldEdit(container, 'end_date', isoDate(-60));
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
	});
});

// ── pin 2: the seasonManageSwitchGeneration thread (#325's guard, followed) ────

describe('#328 season fields — a late settle never announces onto the NEW season’s panel', () => {
	it('a name save on A still in flight when the admin switches to B: B starts blank; A’s write settling late announces NOTHING, paints NO value and raises NO error on B (seasonManageSwitchGeneration gates the settle)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const d = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValue(d.promise);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await commitFieldEdit(container, 'name', 'Renamed 2026');
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});

		await openPanelForSeason(container, 'Season 2027');

		// The switch's reset started B's panel clean — the PERSISTENT region is
		// mounted (it exists on every panel render) and blank.
		const status = q(container, 'season-edit-status');
		expect(status, 'expected the persistent season-edit-status region on B').not.toBeNull();
		expect(status!.textContent?.trim()).toBe('');
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');

		// …and only NOW does A's write land. The generation check must swallow
		// the settle whole: no saved announcement on B, no error, B's value
		// untouched, B's activator enabled.
		d.resolve(undefined);
		await flush();

		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
		expect(q(container, 'season-edit-error-name')).toBeNull();
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		expect((q(container, 'season-edit-btn-name') as HTMLButtonElement).disabled).toBe(false);
	});
});

// (*MVOX:Tallis* — #328 RED)
