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
//     - the affordances live INSIDE the rights-gated panel: no season card for
//       a non-editor → no panel → no delete buttons anywhere (fail-closed,
//       same as every other rights gate; #261 — the gear is gone, the card
//       itself is the way in).
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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lenient message mock — structural assertions only; real copy is Comenius's.
// ONE exception (#216/#217): `season_manage_delete_progress` renders its real
// et template, because the visible "Kustutan X / Y…" line IS the user story —
// the progress tests below assert that text verbatim, interpolation included,
// rather than the key-echo every other message gets. (The locale guard at the
// bottom of this file pins the template in messages/et.json itself.)
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get: (_target, key) => {
				if (key === 'season_manage_delete_progress')
					return (params: { current: number; total: number }) =>
						`Kustutan ${params.current} / ${params.total}…`;
				return (params?: Record<string, unknown>) =>
					params === undefined ? String(key) : `${String(key)} ${JSON.stringify(params)}`;
			}
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
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
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
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn()
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
	// #217 — the season's LIVE scope (the confirm's three numbers) and the
	// cascade's own result. Deliberately numbers that appear NOWHERE else in the
	// fixtures (not 12/14/9, not the 2 series rows), so an assertion can only
	// pass by quoting countSeasonScope / deleteSeason themselves.
	countSeasonScopeMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
	deleteSeasonMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
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
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
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

/** #261 — expand the season card (the gear is gone; routed through the ONE
 *  shared helper), wait for the panel AND its two lists. */
async function openPanelWithRows(container: HTMLElement): Promise<HTMLElement> {
	await openSeasonCardPanel(container);
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
	it('editor expands the season card: EVERY series row and EVERY standalone-event row carries its own delete BUTTON with an accessible name, inside the panel; merely rendering deletes nothing', async () => {
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

	it('NON-editor: no card, no panel — and no delete affordance ANYWHERE on the page (fail-closed)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
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
		// #216 — the page now hands the cascade its progress sink: the counter is
		// driven by the data layer's own ticks, so the call carries the options
		// object (fetchImpl stays the unsupplied third positional).
		expect(deleteEventSeriesMock).toHaveBeenCalledWith(CFG, 'series-1', undefined, {
			onProgress: expect.any(Function)
		});
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

		// #261 — the panel has no internal close; the title row folds it shut.
		await collapseSeasonCard(container);

		await openSeasonCardPanel(container);
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
			// #216 — the options object rides on every series delete now.
			expect(deleteEventSeriesMock).toHaveBeenCalledWith(CFG, 'series-1', undefined, {
				onProgress: expect.any(Function)
			});
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

	it('closing the panel (via the title row, #261) disarms — reopening does not present a primed Delete where the row’s × was', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		// #261 — the panel has no internal close; the title row folds it shut.
		await collapseSeasonCard(container);

		await openSeasonCardPanel(container);
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

// ═══ #217 (folding #216) — delete the SEASON itself, with ONE progress counter ══
//
// WHY (#217, Mihkel 2026-09-02): "There is no delete season control." #197
// finished events and series; the season row has no ×. And #216: the series
// cascade runs silently — creation shows "Loon sündmust X / Y…", deletion
// shows nothing.
//
// PO rulings (Gama, 2026-09-02, last comments on #217/#216): one slice closes
// both; ONE "X / Y" counter whose denominator is EVERY entity the cascade
// deletes (series + events + repertoire items), rendered under the series list
// next to the delete-error slot, role="status", the series_create_progress
// idiom; the two-step confirm quotes the LIVE scope (N series, N events, N
// repertoire items); the season delete is gated by the same
// `manageableSeasonRights === 'editor'` check as every other panel control.
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA — through src/lib/seasons/seasonManage.ts (wire contract pinned in
//   seasonManage.delete.spec.ts):
//     - arming the season × calls `countSeasonScope(cfg, seasonId)`; the confirm
//       quotes its three numbers via the new key `season_delete_confirm_scope`
//       (params: series / events / repertoire);
//     - the confirm calls `deleteSeason(cfg, seasonId, undefined, { onProgress })`;
//     - a series row's confirm now calls
//       `deleteEventSeries(cfg, seriesId, undefined, { onProgress })` — the
//       exact-args assertions earlier in this file carry the options object.
//
//   TESTIDS
//     season-manage-delete-season           the season's own delete BUTTON —
//                                           #236: a RED TRASHCAN in the card
//                                           HEADER row, both states (editor-
//                                           gated with the gear, accessible name)
//     season-manage-delete-season-confirm   the armed two-step's halves, #197
//     season-manage-delete-season-cancel    idiom (the trashcan is GONE while
//                                           armed)
//     season-manage-delete-progress         the ONE cascade counter — role=
//                                           "status"; #236: at CARD level so a
//                                           collapsed-header cascade shows it,
//                                           text from
//                                           `season_manage_delete_progress`
//                                           ("Kustutan {current} / {total}…" in
//                                           et), shown for BOTH season delete
//                                           (#217) and series delete (#216),
//                                           gone when the cascade finishes
//
//   BEHAVIOR
//     - one armed context at a time: the season delete shares the existing
//       `seasonManageDeleteArmed` slot with the row deletes, so arming one
//       disarms the other;
//     - pending guard: the confirm disables while the cascade is on the wire;
//     - success: the panel CLOSES, the reload is the plain
//       `loadForSelected()` (NOT keepSeasonManage — the season is gone, the
//       manageable season must be recomputed), and the role="status" region
//       announces via the new key `season_delete_success` — which means that
//       region must survive the panel's unmount, or the announcement is never
//       made;
//     - partial failure: the existing season-manage-delete-error slot, new
//       'season' branch (`season_manage_season_delete_partial`, params
//       deleted / total), under the series list; the panel and the season stay;
//     - the counter is cleared on finish, on failure, and on a collective
//       switch mid-cascade (resetSeasonManage).

type PageOnProgress = (current: number, total: number, kind: string) => void;
interface PageScope {
	series: number;
	events: number;
	repertoireItems: number;
}

/** Tap the season's own trashcan (#261: it lives on the OPENED title row, so
 *  expand the card first), wait for the confirm that replaces it. */
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

async function armAndConfirmSeasonDelete(container: HTMLElement): Promise<void> {
	await armSeasonDelete(container);
	await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
}

/** deleteSeason mock the tests drive by hand: captures the page's onProgress
 *  sink and resolves only when told to — the ONLY way to observe the counter's
 *  intermediate states from outside. */
function hangingDeleteSeason() {
	let onProgress: PageOnProgress | undefined;
	let resolveWith!: (scope: PageScope) => void;
	let rejectWith!: (reason: unknown) => void;
	deleteSeasonMock.mockImplementation(
		async (_cfg: unknown, _seasonId: string, _impl: unknown, opts?: { onProgress?: PageOnProgress }) => {
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

describe("agenda — #261 the SEASON's delete control lives on the OPENED title row", () => {
	it('editor, card COLLAPSED: NO season-manage-delete-season anywhere — the collapsed face carries no controls beyond the expand target (#261 reverses #236’s collapsed reachability)', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(q(container, 'season-manage-panel'), 'the panel stays closed').toBeNull();
		expect(
			q(container, 'season-manage-delete-season'),
			'#261 — the trashcan is OFF the collapsed face entirely'
		).toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();

		expect(deleteSeasonMock).not.toHaveBeenCalled();
		expect(countSeasonScopeMock).not.toHaveBeenCalled();
	});

	it('editor, panel OPEN: the delete renders on the title row as a real RED-trashcan button with the same accessible name — NOT a descendant of the panel (no <h2> inside the panel either)', async () => {
		const container = await renderReady();
		const panel = await openPanelWithRows(container);

		const btn = q(container, 'season-manage-delete-season') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.tagName).toBe('BUTTON');
		expect(panel.contains(btn), '#261 — title row, never panel internals').toBe(false);
		// The title row is where the collapse control lives — same row.
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		expect(collapse, 'the opened title row exists').not.toBeNull();
		expect(
			btn.parentElement?.contains(collapse),
			'#261 — the delete sits ON the title row, beside the name'
		).toBe(true);
		// #217 review F3 — the name comes from the SEASON's own key, not the
		// event row's. #261 keeps testid AND aria-label byte-identical.
		const label = btn.getAttribute('aria-label') ?? '';
		expect(label).toContain('season_manage_season_delete');
		expect(label).toContain('Season 2026');
		// #236 — a red TRASHCAN, not the old ×.
		expect(Array.from(btn.classList), '#236 — red from text-red-700').toContain('text-red-700');
		expect(btn.textContent ?? '', '#236 — the × glyph is retired').not.toContain('×');
		// The panel's own header row stays gone: no <h2> left inside it.
		expect(panel.querySelector('h2'), '#236 — the panel h2 row is deleted').toBeNull();

		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no season delete affordance ANYWHERE on the page (fail-closed — the title row rides the card’s rights gate)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'season-manage-delete-season')).toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
	});
});

describe('agenda — #217 season delete is a TWO-step confirm quoting the LIVE scope', () => {
	it('arming calls countSeasonScope(cfg, seasonId) and the confirm quotes ALL THREE of its numbers; the × is gone while armed; nothing is written', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armSeasonDelete(container);

		expect(q(container, 'season-manage-delete-season')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).not.toBeNull();
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});

		// Gama's #217 ruling: the confirm promises the FULL scope — N series, N
		// events, N repertoire items — through `season_delete_confirm_scope`.
		// The three fixture numbers (3 / 21 / 6) exist nowhere else on this
		// panel, so this can only pass by quoting countSeasonScope's result.
		//
		// #217 review F1 — asserted on the VISIBLE text ALONE, not on a
		// textContent+aria-label concatenation: a scope that lives only in the
		// aria-label leaves a sighted operator staring at a bare "Delete?" in
		// front of a whole-season cascade. The series row's rule, applied here.
		await waitFor(() => {
			const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
			const visible = confirm.textContent ?? '';
			expect(visible).toContain('season_delete_confirm_scope_short');
			expect(visible).toContain('"series":3');
			expect(visible).toContain('"events":21');
			expect(visible).toContain('"repertoire":6');
		});

		// #217 review F2 — and the accessible name still NAMES the season, as
		// every sibling confirm does, on top of the same three numbers.
		const armed = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const label = armed.getAttribute('aria-label') ?? '';
		expect(label).toContain('season_delete_confirm_scope ');
		expect(label).toContain('"name":"Season 2026"');
		expect(label).toContain('"series":3');
		expect(label).toContain('"events":21');
		expect(label).toContain('"repertoire":6');

		expect(deleteSeasonMock).not.toHaveBeenCalled();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	it('cancel disarms: the × comes back and nothing was written', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armSeasonDelete(container);
		await fireEvent.click(q(container, 'season-manage-delete-season-cancel') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('ONE armed context: arming the season disarms an armed series row, and arming a series (or event) row disarms the armed season', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		// Arm a series row first…
		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-1')).not.toBeNull();
		});

		// …then the season: the series confirm dies.
		await armSeasonDelete(container);
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();

		// …and an event row's arming kills the season confirm right back.
		await fireEvent.click(q(container, 'season-manage-event-delete-ev-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-event-delete-confirm-ev-9')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	it('a failed scope read leaves a scope-free confirm (the existing name-only copy) that still deletes — a read must never block the delete', async () => {
		countSeasonScopeMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armSeasonDelete(container);
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalled();
		});

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
		// Never a phantom scope: no scoped copy, none of the scope numbers.
		expect(shown).not.toContain('season_delete_confirm_scope');
		expect(shown).toContain('season_manage_delete_confirm');

		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});
	});

	// #217 review F2 — `SEASON_DELETE_ROW_ID` is a CONSTANT, so "the season × is
	// armed" reads true again in the next collective: the armed check alone
	// cannot tell the two apart, and the scope read needs the same generation
	// guard the cascade's own ticks already carry.
	it('a scope read still in flight when the operator switches collective never lands in the NEW collective’s confirm', async () => {
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

		let landPolyphonyRead!: (scope: PageScope) => void;
		let reads = 0;
		countSeasonScopeMock.mockImplementation(async () => {
			reads += 1;
			if (reads === 1) {
				return await new Promise<PageScope>((res) => {
					landPolyphonyRead = res;
				});
			}
			// org-b's OWN read never lands either — so any scope on org-b's
			// confirm could only have come from the collective the operator left.
			return await new Promise<PageScope>(() => {});
		});

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanelWithRows(container);
		await armSeasonDelete(container);
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openPanelWithRows(container);
		await armSeasonDelete(container);
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledTimes(2);
		});

		landPolyphonyRead({ series: 3, events: 21, repertoireItems: 6 });
		await new Promise((r) => setTimeout(r, 0));

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
		expect(shown).not.toContain('season_delete_confirm_scope');
		expect(shown).not.toContain('"series":3');
		expect(shown).toContain('season_manage_delete_confirm');
	});
});

describe('agenda — #217/#216/#236 ONE progress counter at CARD level, for BOTH cascades', () => {
	it('the season confirm calls deleteSeason(cfg, seasonId, undefined, {onProgress}); the counter renders role="status" at card level and shows the exact "Kustutan X / Y…" texts in sequence, then disappears', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await openPanelWithRows(container);

		// Not mounted before the cascade starts.
		expect(q(container, 'season-manage-delete-progress')).toBeNull();

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});

		run.tick(3, 7, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});
		const progress = q(container, 'season-manage-delete-progress') as HTMLElement;
		// The series_create_progress idiom, verbatim: role="status" so AT hears
		// each update without focus theft.
		expect(progress.getAttribute('role')).toBe('status');
		expect(progress.textContent?.trim()).toBe('Kustutan 3 / 7…');
		// Placement per the #236 G2 ruling: the counter moves to CARD level,
		// under the header row — a season cascade can now start from the
		// COLLAPSED card, and a counter shut inside the panel would be
		// invisible there. Card level serves both states; it must no longer
		// live inside the panel.
		const card = q(container, 'agenda-admin-card') as HTMLElement;
		expect(card.contains(progress), '#236 — the counter renders at card level').toBe(true);
		expect(
			(q(container, 'season-manage-panel') as HTMLElement).contains(progress),
			'#236 — no longer inside the panel'
		).toBe(false);

		// The counter FOLLOWS the cascade — next tick, next number, same element.
		run.tick(7, 7, 'repertoire');
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-progress') as HTMLElement).textContent?.trim()
			).toBe('Kustutan 7 / 7…');
		});

		// …and it does not outlive the cascade.
		run.finish({ series: 2, events: 4, repertoireItems: 1 });
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
	});

	it('the season confirm is disabled while the cascade runs — a double-tap cannot fire two cascades', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-season-confirm') as HTMLButtonElement).disabled
			).toBe(true);
		});
		await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
		expect(deleteSeasonMock).toHaveBeenCalledTimes(1);

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
	});

	it('#216 — a SERIES delete drives the SAME counter through its own onProgress ticks', async () => {
		let seriesProgress: PageOnProgress | undefined;
		let finishSeries!: (deleted: number) => void;
		deleteEventSeriesMock.mockImplementation(
			async (
				_cfg: unknown,
				seriesId: string,
				_impl: unknown,
				opts?: { onProgress?: PageOnProgress }
			) => {
				seriesProgress = opts?.onProgress;
				return await new Promise<number>((res) => {
					finishSeries = (deleted: number) => {
						seriesRows = seriesRows.filter((row) => row.id !== seriesId);
						res(deleted);
					};
				});
			}
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');
		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalledTimes(1);
		});

		seriesProgress?.(1, 13, 'event');
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-progress') as HTMLElement | null)?.textContent?.trim()
			).toBe('Kustutan 1 / 13…');
		});
		expect(
			(q(container, 'season-manage-delete-progress') as HTMLElement).getAttribute('role')
		).toBe('status');

		seriesProgress?.(13, 13, 'series');
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-progress') as HTMLElement).textContent?.trim()
			).toBe('Kustutan 13 / 13…');
		});

		finishSeries(12);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});
	});

	it('a collective switch mid-cascade clears the counter — and a late tick from the abandoned run never resurrects it', async () => {
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

		const run = hangingDeleteSeason();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledTimes(1);
		});
		run.tick(2, 9, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});

		// The old run's late tick lands AFTER the switch: still no counter — the
		// stale cascade must not paint over org-b's screen.
		run.tick(3, 9, 'event');
		await new Promise((r) => setTimeout(r, 0));
		expect(q(container, 'season-manage-delete-progress')).toBeNull();
	});

	it('#217 review F3 — a cascade that COMPLETES after the collective switch lands nowhere: no reload of the new collective, no announcement of the old one', async () => {
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

		const run = hangingDeleteSeason();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		// org-b's own load has settled; anything past this point would be the
		// abandoned cascade tearing down the screen the operator moved to.
		const loadsAfterSwitch = loadFullAgendaMock.mock.calls.length;

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
		await new Promise((r) => setTimeout(r, 0));

		expect(loadFullAgendaMock.mock.calls.length).toBe(loadsAfterSwitch);
		expect((q(container, 'season-manage-delete-status') as HTMLElement)?.textContent?.trim()).toBe(
			''
		);
	});
});

describe('agenda — #217 a successful season delete closes the panel and announces', () => {
	it('on success: the panel CLOSES, the agenda reloads (recomputing the manageable season — NOT the panel-preserving reload), and the still-mounted status region announces season_delete_success with the season name', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);
		const agendaLoadsBefore = loadFullAgendaMock.mock.calls.length;

		await armAndConfirmSeasonDelete(container);

		// The season is gone, so the panel it managed goes too — this is the
		// plain loadForSelected() reload, not keepSeasonManage: true (a kept
		// panel would be managing a deleted season).
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(agendaLoadsBefore);
		});

		// The announcement must OUTLIVE the panel: a live region that unmounts
		// with the panel announces nothing (WCAG 4.1.3 — the same contract as
		// roster-section-remove-status).
		await waitFor(() => {
			const status = q(container, 'season-manage-delete-status') as HTMLElement | null;
			expect(status).not.toBeNull();
			expect(status?.getAttribute('role')).toBe('status');
			expect(status?.textContent).toContain('season_delete_success');
			expect(status?.textContent).toContain('Season 2026');
		});
	});
});

describe('agenda — #217 a FAILED season cascade lands in the delete-error slot with season copy', () => {
	it('a cascade stopped part-way shows the season branch (season_manage_season_delete_partial with deleted/total) at CARD level (#236 G2); the panel and the season control STAY; the counter is cleared', async () => {
		// The duck-typed tagged shape the write layer rejects with — a plain
		// object, exactly what crosses the vi.mock module boundary.
		deleteSeasonMock.mockRejectedValue({
			code: 'season-cascade-partial',
			seasonId: SEASON_ID,
			deletedCount: 3,
			totalCount: 8,
			failure: new Error('boom')
		});
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const alert = q(container, 'season-manage-delete-error') as HTMLElement;
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('season_manage_season_delete_partial');
		expect(alert.textContent).toContain('3');
		expect(alert.textContent).toContain('8');
		// NOT the series or event partial copy — the operator must hear that the
		// SEASON is still standing.
		expect(alert.textContent).not.toContain('season_manage_delete_partial ');
		expect(alert.textContent).not.toContain('season_manage_event_delete_partial');

		// #236 G2 ruling — the SEASON branch of the error moves to CARD level,
		// under the header, rendering in BOTH states (the season target has no
		// row of its own and is the only cascade that can run collapsed). The
		// 'series' and 'events' branches keep their per-list placement — #197
		// review F5 stays intact, and its tests above are untouched.
		const card = q(container, 'agenda-admin-card') as HTMLElement;
		expect(card.contains(alert), '#236 — season-branch error at card level').toBe(true);
		expect(
			(q(container, 'season-manage-panel') as HTMLElement).contains(alert),
			'#236 — no longer inside the panel'
		).toBe(false);

		// Nothing was torn down, nothing lingers: panel and season control stay,
		// the counter does not.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-delete-progress')).toBeNull();
		expect(
			q(container, 'season-manage-delete-season-confirm') ??
				q(container, 'season-manage-delete-season')
		).not.toBeNull();
	});

	it('a forbidden season delete reads as the permission copy, not a retry prompt', async () => {
		deleteSeasonMock.mockRejectedValue(new EntityDeleteForbiddenError(SEASON_ID));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const text = q(container, 'season-manage-delete-error')?.textContent ?? '';
		expect(text).toContain('season_manage_delete_forbidden');
		expect(text).not.toContain('season_manage_delete_error');
	});
});

// ── #261 — the season delete runs from the OPENED row; feedback survives ──────
//
// #236 made the whole arm → confirm → cascade reachable from the COLLAPSED
// card; #261 REVERSES that (the collapsed face is the name alone — the pins
// above). What #236's G2 ruling established and #261 preserves is the
// FEEDBACK placement: the counter and the season-branch error render at CARD
// level, so a cascade whose card gets folded shut mid-run stays visible.

describe('agenda — #261 the season delete arms on the OPENED row; card-level feedback survives a collapse', () => {
	it('arming on the opened row re-reads the LIVE scope; the armed pair renders ON the title row beside the name; the cascade + card-level counter run, and a MID-CASCADE collapse keeps the counter visible', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();

		await armSeasonDelete(container);
		expect(q(container, 'season-manage-panel'), 'arming happens with the panel open').not.toBeNull();
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});
		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const cancel = q(container, 'season-manage-delete-season-cancel') as HTMLElement;
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		expect(collapse, 'the title row survives arming (never a title-row swap)').not.toBeNull();
		expect(collapse.textContent, 'the season name stays in place').toContain('Season 2026');
		expect(
			(confirm.parentElement as HTMLElement).contains(cancel),
			'the pair renders together on the title row'
		).toBe(true);
		expect(
			(confirm.parentElement as HTMLElement).contains(collapse),
			'…adjacent to the name, on the SAME row'
		).toBe(true);

		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});

		run.tick(2, 5, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});

		// G2 (held through #261): fold the card shut around the running cascade
		// — the SEASON cascade does not block the collapse (only series/convert
		// runs do), and the counter must stay visible at card level.
		await collapseSeasonCard(container);
		const progress = q(container, 'season-manage-delete-progress') as HTMLElement;
		expect(progress, 'the counter survives the collapse').not.toBeNull();
		expect(progress.getAttribute('role')).toBe('status');
		expect(progress.textContent?.trim()).toBe('Kustutan 2 / 5…');
		expect((q(container, 'agenda-admin-card') as HTMLElement).contains(progress)).toBe(true);
		expect(q(container, 'season-manage-panel'), 'collapsed').toBeNull();

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
		// #217's live region is mounted from first render and DELIBERATELY
		// untouched — it announces the success whatever state the card is in.
		await waitFor(() => {
			const status = q(container, 'season-manage-delete-status') as HTMLElement | null;
			expect(status?.textContent).toContain('season_delete_success');
			expect(status?.textContent).toContain('Season 2026');
		});
	});

	it('G2 — a cascade that FAILS after the card was collapsed shows the SEASON error branch at card level: role=alert, visible with the panel closed', async () => {
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
		expect(alert.textContent).toContain('season_manage_season_delete_partial');
		expect((q(container, 'agenda-admin-card') as HTMLElement).contains(alert)).toBe(true);
		expect(q(container, 'season-manage-panel'), 'the card stays collapsed').toBeNull();
		expect(q(container, 'season-manage-delete-progress'), 'counter cleared').toBeNull();
	});

	it('G1 — Escape while armed on the opened title row routes through the EXISTING closeSeasonManagePanel(): the panel closes disarmed, nothing deleted, focus lands on the expand control', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		confirm.focus();
		await fireEvent.keyDown(confirm, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'season-manage-panel'), 'one close path: the panel folds').toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
		// The ruling forbids a NEW disarm branch: one call to the existing
		// closeSeasonManagePanel() clears the armed state AND returns focus to
		// the collapsed card's expand control (#261's focus anchor — the gear is
		// gone). That landing spot is the observable signature of routing
		// through the existing function.
		expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
	});

	// (#236's roving-tabindex pins — armed pair as toolbar members, the stop
	// moving off the disabled pair mid-cascade, last-focused hand-over — lived
	// here. #261 retires role="toolbar" and the roving pattern with the gear;
	// the confirm-disabled-while-running pin above survives on its own.)

	it('#236 review F3 (held through #261) — Escape on the standalone [+ Season] with nothing open and nothing armed is inert: focus stays put', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, 'season-manage-panel'), 'nothing open').toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm'), 'nothing armed').toBeNull();

		const seasonCreate = q(container, 'season-create') as HTMLButtonElement;
		seasonCreate.focus();
		await fireEvent.keyDown(seasonCreate, { key: 'Escape' });

		// An unguarded Escape catcher used to reach closeSeasonManagePanel()'s
		// focus tail and move focus off the pressed button for no reason.
		expect(document.activeElement).toBe(seasonCreate);
		expect(q(container, 'season-create-form'), 'Escape opened nothing either').toBeNull();
	});

	it('#236 review F4 (held through #261) — the armed pair keeps the 44px touch-target floor (both halves)', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		for (const testid of [
			'season-manage-delete-season-confirm',
			'season-manage-delete-season-cancel'
		]) {
			const btn = q(container, testid) as HTMLElement;
			expect(
				Array.from(btn.classList),
				`${testid} must reserve a 44px-tall touch target (min-h-11)`
			).toContain('min-h-11');
		}
	});
});

// ── #217/#216: the four locales carry the new keys ──────────────────────────────
//
// The page above renders keys through the lenient mock; THIS is where the real
// copy is pinned. The et progress template is Gama's ruled idiom (the exact
// string the progress tests above render through the mock's one verbatim key);
// the en confirm template is the contract's ruled copy; lv/uk must exist and
// carry the same placeholders (natural translations are Comenius's).

describe('#217/#216 — i18n: the season-delete keys exist in en/et/lv/uk', () => {
	type MessageFile = Record<string, string>;
	const NEW_KEYS = [
		'season_delete_confirm_scope',
		'season_delete_confirm_scope_short',
		'season_manage_delete_progress',
		'season_delete_success',
		'season_manage_season_delete',
		'season_manage_season_delete_partial'
	] as const;

	function readLocale(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it('every new key exists non-empty in all four locales, with its placeholders intact', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msgs = readLocale(locale);
			for (const key of NEW_KEYS) {
				expect(msgs[key], `${locale}.json is missing ${key}`).toBeTruthy();
			}
			for (const ph of ['{name}', '{series}', '{events}', '{repertoire}']) {
				expect(msgs.season_delete_confirm_scope, `${locale} confirm scope ${ph}`).toContain(ph);
			}
			// The visible half is name-free (the panel it sits in already names
			// the season) but carries all three numbers.
			for (const ph of ['{series}', '{events}', '{repertoire}']) {
				expect(
					msgs.season_delete_confirm_scope_short,
					`${locale} confirm scope short ${ph}`
				).toContain(ph);
			}
			for (const ph of ['{current}', '{total}']) {
				expect(msgs.season_manage_delete_progress, `${locale} progress ${ph}`).toContain(ph);
			}
			for (const ph of ['{deleted}', '{total}']) {
				expect(msgs.season_manage_season_delete_partial, `${locale} partial ${ph}`).toContain(ph);
			}
			// #217 review F3 — the season ×'s own accessible name, separate from
			// the event row's identically-worded key so a copy edit on one cannot
			// silently retitle the other.
			expect(msgs.season_manage_season_delete, `${locale} season delete label`).toContain('{name}');
		}
	});

	it('the ruled copy is verbatim: et/en progress counter, en confirm scope; the success announcement names the season', () => {
		expect(readLocale('et').season_manage_delete_progress).toBe('Kustutan {current} / {total}…');
		expect(readLocale('en').season_manage_delete_progress).toBe('Deleting {current} / {total}…');
		// #217 review F2 — the two halves speak in their own voices: the
		// aria-label in the siblings' "Confirm deleting {name}…" voice, the
		// visible button in button voice.
		expect(readLocale('en').season_delete_confirm_scope).toBe(
			'Confirm deleting {name} with its {series} series, {events} events and {repertoire} repertoire items'
		);
		expect(readLocale('en').season_delete_confirm_scope_short).toBe(
			'Delete {series} series, {events} events, {repertoire} items?'
		);
		expect(readLocale('en').season_delete_success).toContain('{name}');
		expect(readLocale('et').season_delete_success).toContain('{name}');
		// #217 review F3 — `season_delete_success` is NOT a redundant twin of the
		// rows' `season_manage_deleted`, even though en/et spell them alike: lv
		// agrees the participle with the subject's gender, so the season's
		// announcement declines differently from an event's/series'. Pinned here
		// so nobody "de-duplicates" the pair back into a mis-declined string.
		expect(readLocale('lv').season_delete_success).not.toBe(
			readLocale('lv').season_manage_deleted
		);
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
// (*MVOX:Tallis* — #217 RED (folds #216): season delete control + two-step
// confirm quoting the live scope, deleteSeason wiring with onProgress, ONE
// progress counter under the series list for both cascades, success close +
// announcement, season-partial error branch, locale guard for the new keys)
