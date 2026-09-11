// @vitest-environment happy-dom
//
// #325 RED — pending guard on the season-manage CONDUCTOR add/remove (the
// CONDUCTOR half of the issue). Contract: issue #325 + Gama's 2026-09-11
// `ready` ruling, which SPLITS the criterion between the two halves:
//
//   THE CONDUCTOR WRITE IS NOT A RIGHTS GRANT. addSeasonConductor
//   (seasonManage.ts) POSTs a plain multi-value property value
//   `{ type: 'conductor', reference: personId }`; removeSeasonConductor is a
//   GET-find-DELETE. Entu's direct-grant replacement rule (ER-6,
//   docs/architecture/entu-rights-and-visibility-model.md) does NOT reach a
//   plain property — per the ruling, this half's hazard is deliberately NOT
//   cited as ER-6. The race here is DUPLICATE/LOST-REMOVE:
//     - a duplicate POST appends a SECOND conductor value onto the
//       multi-value list (POST appends, it never replaces);
//     - a re-tapped remove — or a remove still in flight when the same
//       person is re-added — can delete the RE-ADDED value: the remove's
//       GET-find-DELETE resolves against whatever value ids exist when it
//       runs, so a late remove can land on the value the re-add just wrote.
//   Same missing guard as the admin/librarian half, same fix shape —
//   different criterion.
//
// PINNED CONTRACT (issue #325 done-when + the inventory's four-state table,
// docs/qa/autosave-field-inventory.md):
//   - a conductor write in flight disables the <select> AND the chip remove
//     buttons; the HANDLERS refuse a second write regardless of the
//     `disabled` attribute (wire-level: exactly one call) — `disabled` alone
//     is a double-tap guard, not a state signal;
//   - pending is VISIBLE: a caveat-slot paragraph (#321's precedent — the
//     slot the partial/order notices already use beside this very select),
//     role="status", data-testid="season-manage-conductor-pending-notice",
//     text season_manage_conductor_saving, present exactly while in flight;
//   - saved is ANNOUNCED: a PERSISTENT role="status" region (#267 same-node
//     shape), data-testid="season-manage-conductor-status", empty at rest,
//     announcing season_manage_conductor_saved after a successful write;
//   - failure text KEPT byte-identical: the existing
//     season-manage-conductor-error role="alert" with
//     season_manage_save_error, optimistic chip reverted, controls
//     re-enabled;
//   - the season-switch generation check (seasonManageSwitchGeneration —
//     the same capture-compare every conductor settle path already runs)
//     gates the NEW pending flag too: a switch mid-flight clears it, and the
//     stale settle may neither re-raise pending nor announce saved on the
//     new season's panel.
//
// Messages are mocked leniently (Proxy → key name): every text assertion
// pins the KEY; the four-locale copy is pinned by
// src/lib/i18n/pendingGuardKeys.spec.ts.
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

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: ['p-grace'],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
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
	const season = currentSeason(true);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function twoSeasonResult() {
	return fullAgendaResult({ seasons: [currentSeason(true), upcomingSeason()] });
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
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
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

async function openPanel(container: HTMLElement): Promise<HTMLElement> {
	return await openSeasonCardPanel(container);
}

function conductorSelect(container: HTMLElement): HTMLSelectElement {
	const select = q(container, 'season-manage-conductor-select') as HTMLSelectElement | null;
	expect(select, 'expected the native season-manage-conductor-select').not.toBeNull();
	return select!;
}

async function pickConductor(container: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(container), { target: { value: personId } });
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

// ── the four states exist as DOM facts ─────────────────────────────────────────

describe('#325 conductor — four states at rest (not yet attempted)', () => {
	it('open panel: PERSISTENT empty role="status" region (season-manage-conductor-status, #267 same-node shape), NO pending notice, NO error, select enabled', async () => {
		const container = await renderReady();
		await openPanel(container);

		const status = q(container, 'season-manage-conductor-status');
		expect(status, 'expected the persistent season-manage-conductor-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-error')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

// ── the guard: a write in flight disables the controls and refuses a second write ──

describe('#325 conductor — a write in flight disables the surface (duplicate/lost-remove race closed)', () => {
	it('add in flight: select AND every chip remove button disable; the visible saving notice (caveat-slot paragraph, role="status") shows; a second pick fires NO second POST (a duplicate POST would APPEND a second conductor value); settle → re-enabled, notice gone, saved announced', async () => {
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(1);
		expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');

		// Pending is VISIBLE — `disabled` alone is a double-tap guard, not a
		// state signal (docs/qa/autosave-field-inventory.md).
		await waitFor(() => {
			const notice = q(container, 'season-manage-conductor-pending-notice');
			expect(notice, 'expected the visible pending notice while the write is in flight').not.toBeNull();
			expect(notice!.getAttribute('role')).toBe('status');
			expect(notice!.textContent).toContain('season_manage_conductor_saving');
		});

		expect(conductorSelect(container).disabled).toBe(true);
		// Every chip's × guards too: a remove racing the in-flight add is the
		// lost-remove half of this surface's hazard.
		expect(
			(q(container, 'season-manage-conductor-remove-p-grace') as HTMLButtonElement).disabled
		).toBe(true);
		const optimisticRemove = q(container, 'season-manage-conductor-remove-p-ada');
		if (optimisticRemove !== null) {
			expect((optimisticRemove as HTMLButtonElement).disabled).toBe(true);
		}

		// WIRE-LEVEL: the handler refuses regardless of the `disabled`
		// attribute — fireEvent reaches listeners exactly like a double-tap
		// racing the attribute flip. NO concurrent conductor write.
		await pickConductor(container, 'person-p');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		});
		expect(conductorSelect(container).disabled).toBe(false);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-status')?.textContent).toContain(
				'season_manage_conductor_saved'
			);
		});

		// The guard releases: a next write is possible after settle.
		await pickConductor(container, 'person-p');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(2);
	});

	it('remove in flight: the select disables and a re-add pick fires NO POST (a re-add the in-flight remove could then delete = the lost-remove race); pending notice shows; settle → saved announced, exactly one DELETE-side call', async () => {
		const d = deferred<undefined>();
		removeSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		expect(removeSeasonConductorMock).toHaveBeenCalledTimes(1);
		expect(removeSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-grace');

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});
		expect(conductorSelect(container).disabled).toBe(true);

		// Grace left the chips optimistically, so she is back among the
		// options — re-adding her NOW is exactly the race the guard closes.
		await pickConductor(container, 'p-grace');
		expect(addSeasonConductorMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		});
		expect(removeSeasonConductorMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-status')?.textContent).toContain(
				'season_manage_conductor_saved'
			);
		});
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

// ── failure: the existing surfacing is KEPT byte-identical, plus retry ─────────

describe('#325 conductor — failure text kept, controls re-enabled for retry', () => {
	it('a rejected add keeps the EXISTING season-manage-conductor-error role="alert" (season_manage_save_error), reverts the optimistic chip, drops the pending notice, announces NO saved, and re-enables the select — a retry write fires', async () => {
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValueOnce(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await pickConductor(container, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});

		d.reject(new Error('conductor write rejected'));
		await waitFor(() => {
			const alert = q(container, 'season-manage-conductor-error');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('season_manage_save_error');
		});
		// Optimistic chip reverted — the pre-existing behaviour stays.
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-status')?.textContent ?? '').not.toContain(
			'season_manage_conductor_saved'
		);
		expect(conductorSelect(container).disabled).toBe(false);

		// Retry is live: the guard released on failure too.
		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(2);
	});
});

// ── pin 4: the season-switch generation check gates the NEW pending flag too ──

describe('#325 conductor — the pending flag does not leak across a season switch', () => {
	it('an add on A still in flight when the admin switches to B: B’s panel shows NO pending notice and an ENABLED select; A’s write settling late announces NOTHING and re-raises NO pending on B (seasonManageSwitchGeneration gates the settle path)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		// The switch cleared the in-flight state: B starts clean.
		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
		expect(q(container, 'season-manage-conductor-status')?.textContent?.trim() ?? '').toBe('');

		// …and only NOW does A's write land. The generation check must swallow
		// the settle whole: no saved announcement, no pending, no chip on B.
		d.resolve(undefined);
		await flush();

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-status')?.textContent?.trim() ?? '').toBe('');
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

// (*MVOX:Tallis* — #325 RED)
