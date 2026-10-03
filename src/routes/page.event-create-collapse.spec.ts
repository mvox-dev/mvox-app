// @vitest-environment happy-dom

// #244 RED — after a SUCCESSFUL event create: collapse the season panel ONLY
// when the created row can be surfaced under the active type filter (else the
// panel stays open, nothing else changes), never write a filter chip either way.

// Collapse only on SUCCESS, never mid bulk-run (routes through
// closeSeasonManagePanel(), which re-checks seriesRunUnfinished ||
// eventConvertRunUnfinished), deliberate focus (never <body>), scroll-and-mark.

// #261 renamed the issue's identifiers: season-manage-gear /
// seasonManageGearDisabled are now season-card-expand / season-card-collapse /
// seasonCardCollapseDisabled / closeSeasonManagePanel().

// RED-author decisions left open by the issue: THE MARK is decorative
// (agenda-row-created-mark, real setTimeout <=15s, no new i18n copy — the
// sr-only event-create-status region already announces the create).

// FOCUS: collapsed -> season-card-expand (closeSeasonManagePanel()'s spot,
// wins the race over restoreEventCreateFocus); stayed open -> season-manage-panel
// (restoreEventCreateFocus, unchanged). A VISIBLE confirmation is OUT OF SCOPE (#298).

// Harness: the page.event-create.spec.ts family — real +page.svelte, real
// AgendaList, only the data seams mocked.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lenient message mock — every key renders as itself (callable with params).
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare', {
		event_created: (p: { name: string; when: string }) => `event_created ${p.name} @ ${p.when}`,
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
	})
);

const {
	loadRosterMock,
	createEventMock,
	resolveManageRightsMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
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
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';
import {
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock
} from '$lib/testing/moduleHandles';

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

// Far-future dates so AgendaList's real-clock relative-day decoration stays
// ahead of them; one rehearsal + one concert so BOTH chips exist before the create.
const UP_REHEARSAL = item('up-reh', 'Tavaline proov', '2030-06-10T16:00:00.000Z', 'rehearsal');
const UP_CONCERT = item('up-con', 'Kevadkontsert', '2030-06-12T18:00:00.000Z', 'concert');
const NEW_ROW = item(NEW_EVENT_ID, 'Uus kontsert', '2030-07-01T16:00:00.000Z', 'concert');

// The world flips when createEvent lands: reloads after that include the new row.
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
	signIn();
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
	listSeriesOptionsForSeasonMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue(null);
});

afterEach(() => {
	vi.useRealTimers();
	setAgendaView('list'); // module-level store — reset so month mode never leaks between tests
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
	listSeriesOptionsForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	resetAppState();
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

// Record receiver + options of every scrollIntoView (a bare count could pass the wrong element).
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

/** Hold the NEXT `loadFullAgenda()` open until the returned release is called —
 *  without a real round trip in the window, a collapse-then-focus that only
 *  works by an ordering accident would pass anyway. */
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
		// The concert chip the USER pressed is still pressed; nothing rewrote the filter.
		expect(pressedChips(container)).toEqual(['agenda-filter-concert']);
		expect(q(container, `agenda-row-${UP_REHEARSAL.id}`)).toBeNull();
	});

	it('focus lands on the collapsed card’s own expand control — never <body>, and never the unmounting panel', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fillConcert(container);
		// A REAL round trip in the reload window, not microtask-ordering luck.
		const release = deferNextAgendaReload();
		await submit(container);

		// In flight: collapsing now would unmount the card before season-card-expand
		// exists to take focus, stranding it on <body>.
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await settleMicro();
		// The gate is genuinely holding — else the in-flight assertions below lie.
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
		// The deliberate landing spot: closeSeasonManagePanel()'s expand button (#261).
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

		// Timers faked so the clear timeout is advanceable; the rest is microtasks,
		// settled by hand since waitFor needs real timers.
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
		// …but the panel does NOT collapse: filtered out, there is no uncovered
		// result — collapsing would remove the one thing still on screen.
		expect(
			q(container, 'season-manage-panel'),
			'no result to uncover → the panel stays open'
		).not.toBeNull();

		// Let any late collapse/scroll run before pinning the absences.
		await new Promise((r) => setTimeout(r, 0));
		await settleMicro();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		// Nothing else changes:
		expect(q(container, `agenda-row-${NEW_EVENT_ID}`), 'the row stays filtered out').toBeNull();
		expect(rowScrolls(calls), 'nothing scrolls toward a row that is not there').toEqual([]);
		expect(q(container, CREATED_MARK), 'no mark without a row').toBeNull();
		// Amendment's second bullet: no filter chip was written.
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

describe('#508 — a create that lands after its form closed runs no success tail', () => {
	it('switching collective mid-create: no season-list refresh for the old collective, no scroll, no mark', async () => {
		let resolveCreate!: (id: string) => void;
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((r) => {
					resolveCreate = r;
				})
		);
		signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'otherdb', name: 'Otherdb', personId: 'person-p' }] });
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container as HTMLElement, 'season-card-expand')).not.toBeNull();
		});
		await openFormFromPanel(container as HTMLElement);
		await fillConcert(container as HTMLElement);
		const calls = spyScroll();
		await submit(container as HTMLElement);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('otherdb');
		await waitFor(() => {
			expect(q(container as HTMLElement, 'event-create-form')).toBeNull();
		});
		await settleMicro();
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		const eventReadsBefore = listEventsForSeasonMock.mock.calls.length;

		worldHasNewEvent = true;
		resolveCreate(NEW_EVENT_ID);
		await new Promise((r) => setTimeout(r, 0));
		await settleMicro();

		expect(listEventSeriesForSeasonMock.mock.calls.slice(seriesReadsBefore)).toEqual([]);
		expect(listEventsForSeasonMock.mock.calls.slice(eventReadsBefore)).toEqual([]);
		expect(q(container as HTMLElement, 'season-manage-panel')).toBeNull();
		expect(rowScrolls(calls)).toEqual([]);
		expect(q(container as HTMLElement, CREATED_MARK)).toBeNull();
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
		// The scroll targets the row that ACTUALLY exists here — the day list's
		// agenda-row-{id} isn't rendered at all in month view.
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
		// A past-dated create in a non-current season lists nowhere — deciding
		// the collapse from the TYPE alone would empty the screen over nothing.
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

// CONDITION 3 (never mid-run) has no single-db UI choreography to drive it end-to-end.

// The enforceable pin is the ROUTE: success must collapse via
// closeSeasonManagePanel(), never flip seasonManageOpen by hand and route around its refusal.

const PAGE_SOURCE = () => readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf-8');
// #508 — submitEventCreate moved out; the row-watcher stays in +page.svelte.
const AGENDA_LOAD_SOURCE = () =>
	[
		'src/lib/agenda/agendaLoad.ts',
		'src/lib/agenda/agendaRosterCache.ts',
		'src/lib/agenda/agendaSelectedLoad.ts',
		'src/lib/agenda/agendaWorksLoad.ts',
		'src/lib/agenda/agendaRowStore.ts',
		'src/lib/agenda/agendaPanels.ts',
		'src/lib/agenda/agendaPageView.svelte.ts',
		'src/lib/agenda/AgendaManageArea.svelte'
	]
		.map((p) => readFileSync(resolve(process.cwd(), p), 'utf-8'))
		.join('\n');
const EVENT_CREATE_FORM_SOURCE = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/agenda/EventCreateForm.svelte'), 'utf-8');

/** Strip comments first — a pin a comment can flip is not a pin. */
function stripComments(body: string): string {
	return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function submitEventCreateBody(source: string): string {
	const start = source.indexOf('async function submitEventCreate');
	expect(start, 'submitEventCreate exists in the given source').toBeGreaterThan(-1);
	const end = source.indexOf('$effect(', start);
	expect(end, 'a bounded slice for the create path').toBeGreaterThan(start);
	return stripComments(source.slice(start, end));
}

// The watcher that waits for the row to render — the guarantee is about the
// ROUTE, never which function the call sits in.
function surfaceWatcherBody(source: string): string {
	const start = source.indexOf('function surfaceCreatedEvent');
	expect(start, 'surfaceCreatedEvent exists in +page.svelte').toBeGreaterThan(-1);
	const end = source.indexOf('function dismissEventCreateForm(', start);
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
			['the create path', submitEventCreateBody(EVENT_CREATE_FORM_SOURCE())]
		] as const) {
			expect(
				/seasonManageOpen\s*=[^=]/.test(body),
				`a direct seasonManageOpen assignment in ${label} would route around the mid-run refusal`
			).toBe(false);
		}
	});

	it('the create path arms the surfacing watcher instead of collapsing on the spot (review F1/F3)', () => {
		const body = submitEventCreateBody(EVENT_CREATE_FORM_SOURCE());
		expect(
			body.includes('surfaceCreatedEvent('),
			'the create path hands the decision to the watcher that observes the row'
		).toBe(true);
		// A synchronous collapse here is the regression itself: agenda-admin-card
		// unmounts for the reload's length, stranding focus on <body>, decided
		// from the created event's TYPE alone which doesn't imply the row lists.
		expect(
			body.includes('closeSeasonManagePanel('),
			'the create path must NOT collapse before the created row is observed'
		).toBe(false);
	});

	it('the create path never assigns agendaTypeFilter, and the page gains no new write site for it', () => {
		const source = PAGE_SOURCE() + AGENDA_LOAD_SOURCE();
		expect(
			/agendaTypeFilter\s*=[^=]/.test(submitEventCreateBody(EVENT_CREATE_FORM_SOURCE())),
			'the create path must READ the filter to decide showability, never write it'
		).toBe(false);
		// The five existing sites (declaration, chip toggle, auto-reset effect,
		// two collective-switch resets) are all legitimate; this path must not
		// become a sixth — a future LEGITIMATE reset may bump the count, with its reason.
		const writes = source.match(/agendaTypeFilter\s*=[^=]/g) ?? [];
		expect(writes.length, 'no new agendaTypeFilter write site').toBe(5);
	});
});

// (*MVOX:Tallis* — #244 RED: showability-gated collapse, scroll + mark, focus, structural pins)
