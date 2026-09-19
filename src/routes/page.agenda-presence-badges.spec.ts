// @vitest-environment happy-dom
//
// #367 RED — the HOME AGENDA is the third part-opening surface (#351 covered
// /library and /event/[id]); its part rows must carry the SAME presence
// indicator, on BOTH of the page's RepertoireElement sites:
//
//   SITE 1 — the per-event works lines, rendered through <AgendaList>'s ONE
//   shared worksElement snippet (AgendaList.svelte), which feeds BOTH the
//   Upcoming and the Recent row templates. `heldFileIds` therefore threads
//   +page.svelte → AgendaList (a NEW prop) → RepertoireElement.
//   SITE 2 — the season-manage panel's repertoire section
//   (season-manage-repertoire), whose RepertoireElement +page.svelte renders
//   DIRECTLY.
//
// Pinned contract (all inherited from #351's landed pins — the shared testid
// is [data-testid="file-presence-{fileId}"], the two existing message keys
// file_presence_on_device / file_presence_needs_network; NO new strings):
//   - held file → on-device, unheld file → needs-network, no file → NO badge;
//   - WHILE THE STORE HAS NOT ANSWERED: NEITHER badge renders — an absent
//     badge is not a claim, needs-network-then-correct is the forbidden
//     flicker. In particular a COLLECTIVE SWITCH clears the previous
//     partition's answer before the new one's lands;
//   - THE TRAP (#351's invariant): presence is ONE heldFileIds(db, personId)
//     query per agenda LOAD, feeding every render site — never a per-row
//     get(), which counts as an open and collapses LRU to render order;
//   - the query keys on the SELECTED collective's (db, personId) partition;
//   - the open handler RE-QUERIES after any open that ATTEMPTED a store
//     write ('network-stored' AND 'network-uncached' — a put evicts BEFORE
//     it writes, so even a failed put has already discarded rows).
//
// INTEGRATION posture (house rule): the ACTUAL / route renders
// (+page.svelte); the agenda/works reads are module-mocked exactly as
// page.works-wiring.spec.ts does, the panel's reads as
// page.season-manage.spec.ts does, and persistence is the
// $lib/files/appByteStore seam — the same fake the #351 suites drive.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	loadWorksByEventIdMock,
	signFileUrlMock,
	loadRosterMock,
	listSectionsMock,
	listRepertoireItemsMock,
	listWorksMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn(),
	signFileUrlMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	listRepertoireItemsMock: vi.fn(),
	listWorksMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Rights probes answer without the wire (the works-wiring precedent); every
// entity is 'not-editor' — the badge is rights-independent by design.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue(null),
	listMyRsvps: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: listSectionsMock
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
// The AgendaList site's rows come straight from this map (real
// collectSources/buildWorkRows stay in play — works-wiring precedent).
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
// The panel site's join sources + the page's per-season repertoire reads —
// mocked the way page.season-manage.spec.ts mocks them.
vi.mock('$lib/library/libraryData', () => ({
	listWorks: listWorksMock,
	listAllEditions: listAllEditionsMock,
	listAllCopies: listAllCopiesMock
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: listRepertoireItemsMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: vi.fn(),
	addSeasonConductor: vi.fn(),
	removeSeasonConductor: vi.fn(),
	getSeriesDefaults: vi.fn().mockResolvedValue({}),
	deleteEvent: vi.fn(),
	deleteEventSeries: vi.fn(),
	countSeriesOccurrences: vi.fn().mockResolvedValue(0),
	countSeasonScope: vi.fn().mockResolvedValue({ series: 0, events: 0, repertoireItems: 0 }),
	deleteSeason: vi.fn()
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: vi.fn(),
	createWork: vi.fn(),
	createEdition: vi.fn()
}));
// #351's persistence seam: the page reaches the byte store ONLY through
// getAppByteStore(); the in-memory fake stands in for IndexedDB.
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({
		putLabel: async () => {},
		labelsFor: async () => new Map(),
		remove: async () => {}
	})
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import type { Season } from '$lib/seasons/types';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;

/** The #351 presence member, installed on the fake — the page-level seam for
 *  BOTH the answered and the not-yet-answered states. Defaults to answering
 *  from the fake's own held rows. */
type PresenceQuery = (db: string, personId: string) => Promise<string[]>;
function installPresence(impl?: PresenceQuery) {
	const spy = vi.fn<PresenceQuery>(
		impl ?? (async (db, personId) => fakeByteStore.heldFor(db, personId))
	);
	(fakeByteStore as unknown as { heldFileIds: PresenceQuery }).heldFileIds = spy;
	return spy;
}

function deferred<T>() {
	let resolveIt!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolveIt = r;
	});
	return { promise, resolve: resolveIt };
}

const IDENTITY = { db: 'sampledb', personId: 'person-p' };

function pdfData() {
	return {
		bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
		filetype: 'application/pdf',
		sha256: 'sha-fixture'
	};
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

/** TWO collectives with DISTINCT personIds — the partition-keying fixture. */
function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p', crede: 'person-c' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'crede', name: 'Crede', personId: 'person-c' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

/** Byte-serving global fetch for the signed-URL GET leg; every other bare
 *  default-fetch read this page fires on mount (#262 schedule_item, #167
 *  database-entity) is routed to a harmless empty answer. */
function stubByteFetch() {
	vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('https://s3.example/'))
			return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]).slice(), {
				status: 200,
				headers: { 'content-type': 'application/pdf' }
			});
		return new Response(JSON.stringify({ entities: [] }), { status: 200 });
	});
}

function makeTab() {
	return { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
}

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

const upcoming = [
	{
		id: 'ev-1',
		name: 'Rehearsal',
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];
const recent = [
	{
		id: 'ev-0',
		name: 'Last rehearsal',
		startDatetime: past,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];

function workRow(id: string, workName: string, fileId: string) {
	return {
		id,
		kind: 'repertoire' as const,
		workId: `work-${id}`,
		editionId: `ed-${id}`,
		workName,
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: 'Vocal score',
		ordinal: null,
		fileId,
		fileName: fileId === '' ? '' : `${fileId}.pdf`,
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

/** The default agenda world: ONE upcoming event carrying a HELD file and a
 *  FILELESS row, ONE recent event carrying an UNHELD file — all three badge
 *  outcomes across BOTH AgendaList row templates in the same render. */
function mockBaselineAgenda() {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming,
			recent,
			seasonId: 'season-1',
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: []
		})
	);
	loadWorksByEventIdMock.mockResolvedValue({
		'ev-1': [workRow('ri-1', 'Spem in alium', 'file-held'), workRow('ri-3', 'O nata lux', '')],
		'ev-0': [workRow('ri-2', 'If ye love me', 'file-absent')]
	});
}

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** A running season the viewer edits — the season-manage card renders and its
 *  panel manages this season. */
function editorSeason(): Season {
	return {
		id: 'season-1',
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

function q(scope: ParentNode, testid: string): HTMLElement | null {
	return scope.querySelector(`[data-testid="${testid}"]`);
}

async function renderAgendaReady(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-row-ev-1')).not.toBeNull();
	});
	return container as HTMLElement;
}

/** Expand the works element inside ONE agenda row (RepertoireElement's own
 *  collapsed works-line toggle), wait for its part rows. */
async function expandWorks(container: HTMLElement, rowTestid: string): Promise<HTMLElement> {
	const row = q(container, rowTestid);
	if (!row) throw new Error(`${rowTestid} not in the DOM`);
	await waitFor(() => {
		expect(q(row, 'works-line')).not.toBeNull();
	});
	await fireEvent.click(q(row, 'works-line')!);
	await waitFor(() => {
		expect(row.querySelector('[data-testid="work-row"]')).not.toBeNull();
	});
	return row;
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	loadRosterMock.mockResolvedValue(toListRead([]));
	listSectionsMock.mockResolvedValue([]);
	listRepertoireItemsMock.mockResolvedValue([]);
	listWorksMock.mockResolvedValue({ items: [], total: 0, truncated: false });
	listAllEditionsMock.mockResolvedValue({ items: [], total: 0, truncated: false });
	listAllCopiesMock.mockResolvedValue({ items: [], total: 0, truncated: false });
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	stubByteFetch();
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	signFileUrlMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	listWorksMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	vi.unstubAllGlobals();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('#367 — home agenda part rows carry the presence badge (integration)', () => {
	it('held → on-device, unheld → needs-network, no file → NO badge — across an UPCOMING and a RECENT row in the SAME render, each badge INSIDE its own agenda row', async () => {
		mockBaselineAgenda();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();

		const container = await renderAgendaReady();
		const upcomingRow = await expandWorks(container, 'agenda-row-ev-1');
		const recentRow = await expandWorks(container, 'agenda-recent-row-ev-0');

		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')).not.toBeNull();
			expect(q(container, 'file-presence-file-absent')).not.toBeNull();
		});
		const held = q(container, 'file-presence-file-held')!;
		const absent = q(container, 'file-presence-file-absent')!;
		expect(held.textContent).toContain('[file_presence_on_device]');
		expect(held.textContent).not.toContain('[file_presence_needs_network]');
		expect(absent.textContent).toContain('[file_presence_needs_network]');
		expect(absent.textContent).not.toContain('[file_presence_on_device]');
		// Each badge sits inside ITS OWN agenda row — the held file on the
		// UPCOMING template, the unheld one on the RECENT template (the shared
		// snippet feeds both).
		expect(upcomingRow.contains(held)).toBe(true);
		expect(recentRow.contains(absent)).toBe(true);
		// The fileless row (ri-3, also expanded in ev-1) makes no claim —
		// exactly two badges page-wide.
		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(2);
	});

	it('THE trap (#351 invariant): ONE heldFileIds query per agenda load feeds BOTH row templates — never a per-row get(), and rendering more rows adds no query', async () => {
		mockBaselineAgenda();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		const getSpy = vi.spyOn(fakeByteStore, 'get');

		const container = await renderAgendaReady();
		await expandWorks(container, 'agenda-row-ev-1');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')).not.toBeNull();
		});
		// A SECOND render site coming on screen re-uses the load's answer —
		// no new query.
		await expandWorks(container, 'agenda-recent-row-ev-0');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-absent')).not.toBeNull();
		});

		// #409 — TWO store queries per agenda LOAD, not one per row/render
		// site: #367's own load-time query, plus the opportunistic prefetch's
		// own skip-check for the next event's (already-held) 'file-held' part
		// (prefetch.ts's pinned contract — one keys-only read decides every
		// skip). Both key on the SAME selected-collective partition.
		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p']
		]);
		// get() counts as an open (byteStore.ts head comment) — a render must
		// never call it, or LRU collapses to render order.
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('while the store has NOT answered, NEITHER badge renders — no default-then-correct; the answer landing paints both, from the answer alone', async () => {
		mockBaselineAgenda();
		setAuthedWithOneCollective();
		const pending = deferred<string[]>();
		installPresence(() => pending.promise);

		const container = await renderAgendaReady();
		const upcomingRow = await expandWorks(container, 'agenda-row-ev-1');

		// Part rows are on screen, the store has not answered: ZERO badge
		// nodes — specifically NOT needs-network-then-correct.
		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);
		expect(upcomingRow.textContent).not.toContain('[file_presence_needs_network]');
		expect(upcomingRow.textContent).not.toContain('[file_presence_on_device]');

		pending.resolve(['file-held']);
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_on_device]'
			);
		});
	});
});

describe('#367 — the open handler re-queries after a store-write ATTEMPT (#351 semantics)', () => {
	it('opening an unheld part whose store put EVICTS a held one flips BOTH badges — the evicted row stops claiming on-device (network-stored path)', async () => {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [],
				upcoming,
				// #409 — file-absent sits on a RECENT event, never the next
				// (upcoming[0]) one: only THIS click's open may fetch/store it.
				// Parked under `upcoming` too, it would be an unheld next-event
				// part and the opportunistic prefetch would fetch+evict it on
				// load, before this test's own click — racing the very
				// "on-device initially" assertion below.
				recent,
				seasonId: 'season-1',
				seasonConductors: [],
				seasonOwners: [],
				seasonEditors: []
			})
		);
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [workRow('ri-1', 'Spem in alium', 'file-held')],
			'ev-0': [workRow('ri-2', 'If ye love me', 'file-absent')]
		});
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-agenda?X-Amz-Expires=60');
		// The cap in miniature (the landed #351 pin): storing file-absent
		// costs the device file-held.
		const realPut = fakeByteStore.put.bind(fakeByteStore);
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async (identity, fileId, data) => {
			await realPut(identity, fileId, data);
			await fakeByteStore.evict(IDENTITY, 'file-held');
		});
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const container = await renderAgendaReady();
		await expandWorks(container, 'agenda-row-ev-1');
		const recentRow = await expandWorks(container, 'agenda-recent-row-ev-0');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_on_device]'
			);
		});

		// The recent row's part is the unheld one — its open goes to the
		// network and stores.
		const link = recentRow.querySelector('[data-testid="work-link-pdf"]')!;
		await fireEvent.click(link);

		await waitFor(() => {
			// The newcomer is now on the device...
			expect(q(container, 'file-presence-file-absent')!.textContent).toContain(
				'[file_presence_on_device]'
			);
			// ...and the row the cap took away no longer says it is.
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
			expect(q(container, 'file-presence-file-held')!.textContent).not.toContain(
				'[file_presence_on_device]'
			);
		});
		// A RE-QUERY, not a local patch: the store, not the page, knows which
		// rows survived. THREE calls now, not two (#409): the load-time #367
		// query, the opportunistic prefetch's own skip-check for the next
		// event's (already-held) 'file-held' part, and the click-triggered
		// re-query below.
		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p'],
			['sampledb', 'person-p']
		]);
	});

	it('an open whose store put EVICTS a held row and then REJECTS still re-queries — the write ATTEMPT gates, not its success (network-uncached path)', async () => {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [],
				upcoming,
				// #409 — file-absent on a RECENT event, same reasoning as the
				// network-stored test above: an unheld NEXT-event part would be
				// auto-prefetched (and would trip this same put mock) before the
				// click this test drives.
				recent,
				seasonId: 'season-1',
				seasonConductors: [],
				seasonOwners: [],
				seasonEditors: []
			})
		);
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [workRow('ri-1', 'Spem in alium', 'file-held')],
			'ev-0': [workRow('ri-2', 'If ye love me', 'file-absent')]
		});
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-agenda?X-Amz-Expires=60');
		// Eviction lands, the write that needed the room does not — exactly
		// the order byteStore.put runs them in.
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async () => {
			await fakeByteStore.evict(IDENTITY, 'file-held');
			throw new Error('idb: transaction aborted');
		});
		const tab = makeTab();
		vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

		const container = await renderAgendaReady();
		await expandWorks(container, 'agenda-row-ev-1');
		const recentRow = await expandWorks(container, 'agenda-recent-row-ev-0');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_on_device]'
			);
		});

		const link = recentRow.querySelector('[data-testid="work-link-pdf"]')!;
		await fireEvent.click(link);

		// The open still DELIVERS — the cache is never a gate (#343).
		await waitFor(() => {
			expect(tab.location.href).not.toBe('');
		});
		await waitFor(() => {
			// Nothing was stored, so the newcomer gained no offline copy...
			expect(q(container, 'file-presence-file-absent')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
			// ...and the row the failed write discarded no longer claims one.
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
			expect(q(container, 'file-presence-file-held')!.textContent).not.toContain(
				'[file_presence_on_device]'
			);
		});
		// THREE calls (#409): load-time #367 query, the prefetch's own
		// skip-check for 'file-held', and the click-triggered re-query.
		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p'],
			['sampledb', 'person-p']
		]);
	});
});

describe('#367 — the query keys on the SELECTED collective (per-load clear + partition)', () => {
	it('a collective switch clears the previous answer (NEITHER badge while the new partition is pending) and re-queries under the NEW (db, personId) — the same file answers differently per partition', async () => {
		mockBaselineAgenda();
		setAuthedWithTwoCollectives();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const credePending = deferred<string[]>();
		const presenceSpy = installPresence(async (db, personId) => {
			if (db === 'crede') return credePending.promise;
			return fakeByteStore.heldFor(db, personId);
		});

		const container = await renderAgendaReady();
		await expandWorks(container, 'agenda-row-ev-1');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_on_device]'
			);
		});

		// Switch. The agenda reloads; the previous partition's answer must NOT
		// survive onto the new collective's rows. Wait for the NEW load's own
		// distinguishing content — the sampledb on-device badge gone — rather
		// than a bare row-testid presence check: that testid is ALSO true on
		// the STALE pre-switch DOM (same event id, still showing sampledb's
		// badge) before Svelte's queued flush swaps in `agenda-skeleton`, so a
		// bare presence check resolves immediately without ever waiting for
		// the switch to actually land (mirrors switchTo() in
		// page.library-bulk-checkout-collective-switch.spec.ts).
		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'agenda-row-ev-1')).not.toBeNull();
			expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);
		});
		await expandWorks(container, 'agenda-row-ev-1');

		// Part rows are on screen; crede's partition has not answered: ZERO
		// badges — sampledb's on-device claim is gone, and no default stands
		// in for the pending answer.
		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);

		// crede holds NOTHING: the very file sampledb held badges
		// needs-network here — presence is a claim about the PARTITION.
		credePending.resolve([]);
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
			expect(q(container, 'file-presence-file-held')!.textContent).not.toContain(
				'[file_presence_on_device]'
			);
		});

		// #409 — TWO queries per load, each keyed on ITS load's identity:
		// #367's own load-time query, then the opportunistic prefetch's own
		// skip-check for the next event's 'file-held' part (held under
		// sampledb, so no further write-attempt call; not held under crede,
		// but the fetch it tries resolves 'fallback-navigation' — no signed
		// URL to sign in this fixture — which is not a write-attempt either).
		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p'],
			['crede', 'person-c'],
			['crede', 'person-c']
		]);
	});
});

describe('#367 — the season-manage repertoire panel is the SECOND render site', () => {
	it('panel part rows carry the badge from the SAME per-load answer — held → on-device, unheld → needs-network, and opening the panel adds NO query', async () => {
		const season = editorSeason();
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [season] }));
		loadWorksByEventIdMock.mockResolvedValue({});
		// The panel's season repertoire: two items, one whose edition file the
		// store holds, one whose it does not.
		listRepertoireItemsMock.mockResolvedValue([
			{ id: 'ri-h', workId: 'work-1', editionId: 'ed-1', status: 'active', name: 'Spem in alium' },
			{ id: 'ri-a', workId: 'work-2', editionId: 'ed-2', status: 'active', name: 'If ye love me' }
		]);
		listWorksMock.mockResolvedValue({
			items: [
				{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
				{ id: 'work-2', name: 'If ye love me', composer: 'Thomas Tallis' }
			],
			total: 2,
			truncated: false
		});
		listAllEditionsMock.mockResolvedValue({
			items: [
				{
					id: 'ed-1',
					name: 'Vocal score',
					publisher: '',
					workId: 'work-1',
					externalLinks: [],
					files: [
						{ id: 'file-held', filename: 'spem.pdf', filesize: 1024, filetype: 'application/pdf' }
					]
				},
				{
					id: 'ed-2',
					name: 'Vocal score',
					publisher: '',
					workId: 'work-2',
					externalLinks: [],
					files: [
						{ id: 'file-absent', filename: 'ifye.pdf', filesize: 2048, filetype: 'application/pdf' }
					]
				}
			],
			total: 2,
			truncated: false
		});
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		const getSpy = vi.spyOn(fakeByteStore, 'get');

		const { container } = render(Page);
		const panel = await openSeasonCardPanel(container as HTMLElement);
		await waitFor(() => {
			expect(q(panel, 'season-manage-repertoire')).not.toBeNull();
		});
		const section = q(panel, 'season-manage-repertoire')!;

		// Both badges, INSIDE the panel's own section (container scoping — the
		// accepted-duplication strategy from page.season-repertoire.spec.ts).
		await waitFor(() => {
			expect(q(section, 'file-presence-file-held')).not.toBeNull();
			expect(q(section, 'file-presence-file-absent')).not.toBeNull();
		});
		expect(q(section, 'file-presence-file-held')!.textContent).toContain(
			'[file_presence_on_device]'
		);
		expect(q(section, 'file-presence-file-held')!.textContent).not.toContain(
			'[file_presence_needs_network]'
		);
		expect(q(section, 'file-presence-file-absent')!.textContent).toContain(
			'[file_presence_needs_network]'
		);
		expect(q(section, 'file-presence-file-absent')!.textContent).not.toContain(
			'[file_presence_on_device]'
		);

		// The panel consumed the LOAD's one answer: opening it queried nothing
		// new, and rendering never touched get().
		expect(presenceSpy.mock.calls).toEqual([['sampledb', 'person-p']]);
		expect(getSpy).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
