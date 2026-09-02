// @vitest-environment happy-dom
//
// #197 RED — DELETE affordances for event series and standalone events on the
// ACTUAL agenda route (integration: real +page.svelte, real season-manage
// panel; only the data seams are mocked — same harness family as
// page.season-manage.spec.ts).
//
// WHY (#197, Joosep / Crede pilot 2026-08-31): "I want to delete the 'Proov'
// series to recreate it with the same name … and the standalone 'Proov' event
// too. But I can't find a delete option anywhere." The season-manage panel
// already LISTS the season's series and standalone events; #197 gives each row
// its delete button.
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA — through src/lib/seasons/seasonManage.ts (wire contract pinned in
//   seasonManage.delete.spec.ts):
//     - a series row's delete calls `deleteEventSeries(cfg, seriesId)`;
//     - a standalone-event row's delete calls `deleteEvent(cfg, eventId)`;
//     - cfg is the page's usual { db: selected.db, token: getToken() }.
//
//   TESTIDS
//     season-manage-series-delete-<id>   delete BUTTON inside that series' row
//                                        (season-manage-series-<id>), with an
//                                        accessible name — icon-only buttons
//                                        announcing nothing are not shippable.
//     season-manage-event-delete-<id>    delete BUTTON inside that standalone
//                                        event's row (season-manage-event-<id>),
//                                        same accessibility bar.
//     season-manage-{series,event}-delete-confirm-<id>
//     season-manage-{series,event}-delete-cancel-<id>
//                                        the two-step confirm's halves (review
//                                        F2), swapped IN for the × when armed.
//     season-manage-delete-error         inline delete-failed error slot,
//                                        role="alert", rendered under the list
//                                        that failed (review F5).
//     season-manage-delete-status        visually-hidden role="status" success
//                                        announcement (review F5).
//
//   BEHAVIOR
//     - the affordances live INSIDE the rights-gated panel: no gear for a
//       non-editor → no panel → no delete buttons anywhere (fail-closed, same
//       as every other rights gate).
//     - merely rendering the panel deletes nothing.
//     - #197 review F2: the × ARMS a two-step confirm and writes nothing; only
//       the confirm button calls the data layer. Cancel disarms. Closing the
//       panel disarms. The roster's `section-remove-*` idiom, because this
//       delete is irreversible and the app has no undo.
//     - after a SUCCESSFUL delete the row leaves the display (the other rows
//       survive untouched) AND the page re-reads itself (#197 review F4): the
//       agenda below the panel renders the very events just deleted, so a
//       splice-only success left the same screen contradicting itself. The list
//       mocks below mirror deletions into their fixtures.
//     - a FAILED delete surfaces season-manage-delete-error (role="alert") and
//       the row STAYS — a row that silently survives a click, or silently
//       vanishes and reappears, reads as a bug (house rule: fail loudly). A 403
//       gets its OWN copy (#197 review F3): the panel's rights gate is
//       `_owner`-OR-`_editor` on the SEASON while Entu's DELETE demands `_owner`
//       on the TARGET, so "try again" is a lie for a season editor.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
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
	countSeriesOccurrencesMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
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
	countSeriesOccurrencesMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// The season-management data layer — the ONE seam the panel may read/write
// through. #197 widens it with the two delete functions.
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEvent: deleteEventMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock
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
// The viewer IS a season editor here, so the page's loadManagePickers fires —
// stub its reads or they hit the network.
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue([]),
	listAllEditions: vi.fn().mockResolvedValue([]),
	listAllCopies: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
// NOT mocked (and deliberately not part of the seasonManage mock above): the
// refusal discriminators live in their own module precisely so the page can
// read them while `$lib/seasons/seasonManage` is replaced wholesale.
import {
	EntityDeleteForbiddenError,
	EventCascadePartialError,
	SeriesCascadePartialError
} from '$lib/seasons/deleteErrors';
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

interface SeriesRow {
	id: string;
	name: string;
	eventCount: number;
}
interface EventRow {
	id: string;
	name: string;
	startDatetime: string;
}

// MUTABLE list fixtures: the delete mocks splice them (suite default), so
// whether GREEN removes locally or refetches the panel lists after a delete,
// the deleted row is GONE either way — the display assertions below stay
// implementation-agnostic.
let seriesRows: SeriesRow[] = [];
let eventRows: EventRow[] = [];

// #197 review 2nd pass F2 — THREE deliberately DIFFERENT numbers per series, so
// no assertion below can pass by quoting the wrong source:
//   - the panel list's `eventCount` (12)  — client-derived from one capped,
//     season-wide read, i.e. the stale figure;
//   - `countSeriesOccurrences` (14)       — the live server count the arming
//     click re-reads, which is what the confirm may quote;
//   - `deleteEventSeries`' RESOLVED value (9) — what the cascade actually
//     destroyed, which is what the success announcement must quote.
let liveOccurrenceCount: Record<string, number> = {};
let cascadeDeletedCount: Record<string, number> = {};

function resetRows(): void {
	seriesRows = [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0 }
	];
	eventRows = [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
	liveOccurrenceCount = { 'series-1': 14, 'series-2': 0 };
	cascadeDeletedCount = { 'series-1': 9, 'series-2': 0 };
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

beforeEach(() => {
	resetRows();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
	listEventSeriesForSeasonMock.mockImplementation(async () => [...seriesRows]);
	listEventsForSeasonMock.mockImplementation(async () => [...eventRows]);
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: '',
		durationMinutes: null,
		defaultLocation: '',
		defaultDescription: ''
	});
	deleteEventMock.mockImplementation(async (_cfg: unknown, eventId: string) => {
		eventRows = eventRows.filter((row) => row.id !== eventId);
	});
	deleteEventSeriesMock.mockImplementation(async (_cfg: unknown, seriesId: string) => {
		seriesRows = seriesRows.filter((row) => row.id !== seriesId);
		return cascadeDeletedCount[seriesId] ?? 0;
	});
	countSeriesOccurrencesMock.mockImplementation(
		async (_cfg: unknown, seriesId: string) => liveOccurrenceCount[seriesId] ?? 0
	);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

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

/**
 * The two-step delete (#197 review F2): tap the row's ×, wait for the confirm
 * that replaces it, tap that. Everything below goes through here — a delete
 * that took ONE tap is the bug this shape exists to prevent.
 */
async function armAndConfirmDelete(
	container: HTMLElement,
	kind: 'series' | 'event',
	id: string
): Promise<void> {
	await fireEvent.click(q(container, `season-manage-${kind}-delete-${id}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-manage-${kind}-delete-confirm-${id}`)).not.toBeNull();
	});
	await fireEvent.click(
		q(container, `season-manage-${kind}-delete-confirm-${id}`) as HTMLElement
	);
}

/** Click the gear, wait for the panel AND its two lists. */
async function openPanelWithRows(container: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
	await waitFor(() => {
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});
	await waitFor(() => {
		expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
	});
	return q(container, 'season-manage-panel') as HTMLElement;
}

// ── #197: the delete affordances exist, inside the rights-gated panel ───────────

describe('agenda — #197 delete buttons render in the season-manage panel (integration: real route)', () => {
	it('editor opens the gear panel: EVERY series row and EVERY standalone-event row carries its own delete BUTTON with an accessible name, inside the panel; merely rendering deletes nothing', async () => {
		const container = await renderReady();
		const panel = await openPanelWithRows(container);

		// One delete per series row, INSIDE that row.
		for (const seriesId of ['series-1', 'series-2']) {
			const btn = q(container, `season-manage-series-delete-${seriesId}`) as HTMLElement;
			expect(btn).not.toBeNull();
			expect(btn.tagName).toBe('BUTTON');
			// Icon-only affordance MUST carry a name a screen reader can announce.
			expect(btn.getAttribute('aria-label') || btn.textContent?.trim()).toBeTruthy();
			expect(btn.closest(`[data-testid="season-manage-series-${seriesId}"]`)).not.toBeNull();
			expect(panel.contains(btn)).toBe(true);
		}

		// …and one per standalone event row.
		const evBtn = q(container, 'season-manage-event-delete-ev-9') as HTMLElement;
		expect(evBtn).not.toBeNull();
		expect(evBtn.tagName).toBe('BUTTON');
		expect(evBtn.getAttribute('aria-label') || evBtn.textContent?.trim()).toBeTruthy();
		expect(evBtn.closest('[data-testid="season-manage-event-ev-9"]')).not.toBeNull();
		expect(panel.contains(evBtn)).toBe(true);

		// Rendering the affordances wrote nothing.
		expect(deleteEventMock).not.toHaveBeenCalled();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no gear, no panel — and no delete affordance ANYWHERE on the page (fail-closed)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(container.querySelector('[data-testid^="season-manage-series-delete-"]')).toBeNull();
		expect(container.querySelector('[data-testid^="season-manage-event-delete-"]')).toBeNull();
	});
});

// ── #197: clicking delete calls the data layer and the row leaves ───────────────

describe('agenda — #197 clicking delete removes the series / event', () => {
	it('a series row’s delete calls deleteEventSeries(cfg, seriesId) ONCE; the row leaves the display, the OTHER series and the standalone event survive', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(deleteEventSeriesMock).toHaveBeenCalledWith(CFG, 'series-1');
		// Never the sibling write — a series id goes to the SERIES delete only.
		expect(deleteEventMock).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});
		expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
		expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
	});

	it('a standalone event’s delete calls deleteEvent(cfg, eventId) ONCE; the row leaves, BOTH series rows survive', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'event', 'ev-9');

		await waitFor(() => {
			expect(deleteEventMock).toHaveBeenCalledTimes(1);
		});
		expect(deleteEventMock).toHaveBeenCalledWith(CFG, 'ev-9');
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-9')).toBeNull();
		});
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
	});

	// #197 review F4 — the assertion this file used to carry was the INVERSE
	// (`loadFullAgendaMock` called exactly once, i.e. never refetched), which
	// pinned a stale page: <AgendaList> renders the very events the panel just
	// deleted, directly below the panel, and a series delete cascades to
	// occurrences that are agenda rows too. The create path in the same file
	// already reloads with `keepSeasonManage` for exactly this reason.
	it('a SUCCESSFUL delete refetches the agenda the page is showing — the panel survives the reload', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);
		const agendaLoadsBefore = loadFullAgendaMock.mock.calls.length;

		await armAndConfirmDelete(container, 'event', 'ev-9');

		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(agendaLoadsBefore);
		});
		// The panel the editor is standing in is NOT torn down by that reload.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
	});

	it('a deleted row STAYS gone across panel close + reopen — local truth and the (mock-)backend agree', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});

		// #213 — the panel has no internal close; the gear toggles it shut.
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-series-1')).toBeNull();
	});

	// #197 review F5 — a successful delete used to say nothing at all: the row
	// just went. Same WCAG 4.1.3 gap `roster-section-remove-status` closes.
	it('announces the removal by name in a visually-hidden role="status" region', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		const status = q(container, 'season-manage-delete-status') as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.className).toContain('sr-only');
		expect(status.textContent?.trim()).toBe(''); // mounted EMPTY — a live region announces changes

		await armAndConfirmDelete(container, 'event', 'ev-9');

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-status') as HTMLElement).textContent
			).toContain('Spring concert');
		});
	});

	// #197 review 2nd pass F2 — the announcement is the only report the operator
	// ever gets of an irreversible cascade, so the number in it comes from the
	// cascade's own return value (9 here) — not the panel row's client-derived
	// `eventCount` (12), and not even the live count the confirm quoted (14).
	// Three different numbers precisely so quoting the wrong source cannot pass.
	it('announces how many occurrences the CASCADE deleted, not the count the list was showing', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-status') as HTMLElement).textContent
			).toContain('Monday rehearsals');
		});
		const announced = (q(container, 'season-manage-delete-status') as HTMLElement).textContent ?? '';
		expect(announced).toContain('9');
		expect(announced).not.toContain('12');
		expect(announced).not.toContain('14');
	});

	it('a cascade that deleted NOTHING (an empty series) announces the plain removal — no phantom count', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-2');

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-status') as HTMLElement).textContent
			).toContain('Sectionals');
		});
		const announced = (q(container, 'season-manage-delete-status') as HTMLElement).textContent ?? '';
		expect(announced).toContain('season_manage_deleted');
		expect(announced).not.toContain('season_manage_series_deleted');
	});
});

// ── #197 review F2: the two-step confirm ────────────────────────────────────────

describe('agenda — #197 delete is a TWO-step confirm, never a single tap', () => {
	it('tapping the series × writes NOTHING — it swaps in confirm/cancel, and the confirm carries the LIVE occurrence count, not the list’s stale one', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);

		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-delete-cancel-series-1')).not.toBeNull();
		// The × itself is GONE while armed — one control, one meaning.
		expect(q(container, 'season-manage-series-delete-series-1')).toBeNull();

		// #197 review 2nd pass F2 — arming re-reads the count from the server, and
		// what the confirm promises is THAT number (14), never the panel list's
		// client-derived tally (12): the list groups ONE capped season-wide event
		// read, so it under-reports a big season and misses anything created
		// since. This is the last screen before an irreversible cascade.
		await waitFor(() => {
			expect(countSeriesOccurrencesMock).toHaveBeenCalledWith(CFG, 'series-1');
		});
		await waitFor(() => {
			const confirm = q(container, 'season-manage-series-delete-confirm-series-1') as HTMLElement;
			const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
			expect(shown).toContain('14');
			expect(shown).not.toContain('12');
		});
		// …and the row's own count is corrected to match, so the panel never shows
		// two different numbers for the same series.
		expect(q(container, 'season-manage-series-series-1')?.textContent).toContain('14');
		// A COUNT is a read: arming still wrote nothing.
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	// The count read is a network call like any other, and it must not be able to
	// block a delete. A failure leaves the confirm COUNT-FREE — never falling back
	// to the stale figure, which would be the exact lie this re-read removes.
	it('a failed live-count read leaves a count-free confirm that still deletes', async () => {
		countSeriesOccurrencesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await waitFor(() => {
			expect(countSeriesOccurrencesMock).toHaveBeenCalled();
		});
		const confirm = q(container, 'season-manage-series-delete-confirm-series-1') as HTMLElement;
		const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
		expect(shown).not.toContain('12');
		expect(shown).not.toContain('14');

		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalledWith(CFG, 'series-1');
		});
	});

	it('tapping the standalone event × writes nothing either', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-event-delete-ev-9') as HTMLElement);

		expect(deleteEventMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-event-delete-confirm-ev-9')).not.toBeNull();
	});

	it('cancel disarms: the × comes back and nothing was written', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await fireEvent.click(
			q(container, 'season-manage-series-delete-cancel-series-1') as HTMLElement
		);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});

	it('arming a SECOND row disarms the first — only one delete is ever live', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await fireEvent.click(q(container, 'season-manage-series-delete-series-2') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-2')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();
	});

	it('closing the panel (via the gear, #213) disarms — reopening does not present a primed Delete where the row’s × was', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		// #213 — the panel has no internal close; the gear toggles it shut.
		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();
		expect(q(container, 'season-manage-series-delete-series-1')).not.toBeNull();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
	});

	it('the confirm is disabled while its DELETE is in flight — a double-tap cannot fire two', async () => {
		let release: (() => void) | undefined;
		deleteEventMock.mockImplementation(
			async () =>
				await new Promise<void>((resolve) => {
					release = () => {
						eventRows = eventRows.filter((row) => row.id !== 'ev-9');
						resolve();
					};
				})
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-event-delete-ev-9') as HTMLElement);
		const confirm = q(container, 'season-manage-event-delete-confirm-ev-9') as HTMLButtonElement;
		await fireEvent.click(confirm);

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-event-delete-confirm-ev-9') as HTMLButtonElement).disabled
			).toBe(true);
		});
		// A second tap on the still-mounted confirm writes nothing more.
		await fireEvent.click(q(container, 'season-manage-event-delete-confirm-ev-9') as HTMLElement);
		expect(deleteEventMock).toHaveBeenCalledTimes(1);

		release?.();
		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-9')).toBeNull();
		});
	});
});

// ── #197: failed deletes fail loudly, and the row stays ─────────────────────────

describe('agenda — #197 a FAILED delete surfaces an error and keeps the row', () => {
	it('a rejected deleteEventSeries surfaces season-manage-delete-error (role="alert") and the series row STAYS', async () => {
		deleteEventSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});

	// #197 review F5 — the ONE shared slot lived under the standalone-EVENTS
	// list, so a failed SERIES delete printed its message below a list that had
	// nothing to do with it. The alert belongs under the list that failed.
	it('the error renders under the list that FAILED — series failure inside the series sub-panel, not the events one', async () => {
		deleteEventSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const alert = q(container, 'season-manage-delete-error') as HTMLElement;
		const seriesSubPanel = (
			q(container, 'season-manage-series-series-1') as HTMLElement
		).parentElement;
		expect(seriesSubPanel?.contains(alert)).toBe(true);
		// …and NOT alongside the standalone events.
		expect(
			(q(container, 'season-manage-event-ev-9') as HTMLElement).parentElement?.contains(alert)
		).toBe(false);
	});

	it('a rejected deleteEvent surfaces the same slot and the event row STAYS', async () => {
		deleteEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'event', 'ev-9');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
	});

	// #197 review F3 — the panel gates on `_owner` OR `_editor` on the SEASON;
	// Entu's DELETE demands `_owner` on the TARGET entity. A season editor who
	// did not create the row is refused EVERY time, so "Couldn't delete. Try
	// again." invites a retry that can never work.
	it('a 403 gets its own copy — a permission refusal, not a retry prompt', async () => {
		deleteEventSeriesMock.mockRejectedValue(new EntityDeleteForbiddenError('series-1'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const text = q(container, 'season-manage-delete-error')?.textContent ?? '';
		expect(text).toContain('season_manage_delete_forbidden');
		expect(text).not.toContain('season_manage_delete_error');
	});

	it('a cascade that stopped part-way says how many events went and that the series is still there', async () => {
		deleteEventSeriesMock.mockRejectedValue(
			new SeriesCascadePartialError('series-1', 5, 12, new Error('boom'))
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const text = q(container, 'season-manage-delete-error')?.textContent ?? '';
		expect(text).toContain('season_manage_delete_partial');
		expect(text).toContain('5');
		expect(text).toContain('12');
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});

	// #197 review 2nd pass F1 — an EVENT cascades too (its attendance rows and
	// programme items), and when THAT stops part-way the copy must say the EVENT
	// is still standing, not the series.
	it('an EVENT cascade that stopped part-way gets its own copy — how many child records went, and the event is still there', async () => {
		deleteEventMock.mockRejectedValue(new EventCascadePartialError('ev-9', 2, 5, new Error('boom')));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'event', 'ev-9');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const text = q(container, 'season-manage-delete-error')?.textContent ?? '';
		expect(text).toContain('season_manage_event_delete_partial');
		expect(text).toContain('2');
		expect(text).toContain('5');
		expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
	});

	// A 403 nested inside a cascade failure is still a permission story, however
	// deep it sits (series → occurrence → the occurrence's own child).
	it('a 403 nested two cascades deep still reads as a permission refusal', async () => {
		deleteEventSeriesMock.mockRejectedValue(
			new SeriesCascadePartialError(
				'series-1',
				0,
				3,
				new EventCascadePartialError('occ-1', 0, 1, new EntityDeleteForbiddenError('pi-1'))
			)
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-error')?.textContent ?? '').toContain(
			'season_manage_delete_forbidden'
		);
	});

	it('a SUCCESSFUL delete after a failed one clears the error — the slot is per-attempt, not sticky', async () => {
		deleteEventMock.mockRejectedValueOnce(new Error('boom'));
		deleteEventMock.mockImplementation(async (_cfg: unknown, eventId: string) => {
			eventRows = eventRows.filter((row) => row.id !== eventId);
		});
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'event', 'ev-9');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});

		// Second try — this one resolves. A failed delete leaves the row ARMED
		// (nothing was destroyed), so the confirm is right there to re-tap.
		await fireEvent.click(q(container, 'season-manage-event-delete-confirm-ev-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-9')).toBeNull();
		});
		expect(q(container, 'season-manage-delete-error')).toBeNull();
	});
});

// ── #212: the convert form owns the panel — any armed delete is DISARMED ────────
//
// Gama's ruling on #212 (last comment): while the event→series conversion form
// is open the panel is ONE action context — every row's ⟳ and × (event rows
// AND series rows) is gone and any armed delete confirmation is disarmed;
// closing the form brings every row's buttons back in their DISARMED posture.
// The "arming a SECOND row disarms the first" shape above, extended to the
// convert form: only one destructive/creative intent is ever live.

describe('agenda — #212 opening the convert form disarms any armed delete', () => {
	it('an armed EVENT row is disarmed by opening convert on ANOTHER row — no confirm survives the form, and the × comes back disarmed after it closes', async () => {
		eventRows = [
			...eventRows,
			{ id: 'ev-10', name: 'Autumn concert', startDatetime: '2027-09-12T15:00:00.000Z' }
		];
		const container = await renderReady();
		await openPanelWithRows(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-10')).not.toBeNull();
		});

		// Arm delete on row B (ev-10).
		await fireEvent.click(q(container, 'season-manage-event-delete-ev-10') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-event-delete-confirm-ev-10')).not.toBeNull();
		});

		// Open convert on row A (ev-9) — the armed confirm dies with every other
		// row action: NO ⟳/×/confirm/cancel remains on ANY row while the form
		// is open (prefix matching catches the confirm/cancel testids too).
		await fireEvent.click(q(container, 'season-manage-event-convert-ev-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).not.toBeNull();
		});
		expect(
			container.querySelectorAll('[data-testid^="season-manage-event-delete-"]').length
		).toBe(0);
		expect(
			container.querySelectorAll('[data-testid^="season-manage-event-convert-"]').length
		).toBe(0);
		expect(
			container.querySelectorAll('[data-testid^="season-manage-series-delete-"]').length
		).toBe(0);

		// Close the form: row B comes back DISARMED — the plain ×, never a
		// primed confirm the operator did not just arm.
		await fireEvent.click(q(container, 'event-convert-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-event-delete-ev-10')).not.toBeNull();
		});
		expect(q(container, 'season-manage-event-delete-confirm-ev-10')).toBeNull();
		expect(q(container, 'season-manage-event-delete-cancel-ev-10')).toBeNull();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	it('an armed SERIES row is disarmed the same way — opening convert on an event row clears it', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-1')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-event-convert-ev-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).not.toBeNull();
		});
		expect(
			container.querySelectorAll('[data-testid^="season-manage-series-delete-"]').length
		).toBe(0);

		await fireEvent.click(q(container, 'event-convert-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();
		expect(q(container, 'season-manage-series-delete-cancel-series-1')).toBeNull();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — #197 RED: delete buttons on series/standalone rows in the
// season-manage panel — rights-gated rendering, delete-call wiring, row removal,
// loud failure)
// (*MVOX:Palestrina* — #197 review F2/F3/F4/F5: two-step confirm, 403 copy,
// post-delete refresh, per-list error placement + status announcement)
// (*MVOX:Palestrina* — #197 review 2nd pass F1/F2: live confirm count,
// cascade-reported deletion count, event-cascade copy)
// (*MVOX:Tallis* — #212 RED: convert form disarms any armed delete — one action
// context at a time)
