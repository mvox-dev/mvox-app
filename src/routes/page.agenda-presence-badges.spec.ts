// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	loadFullAgendaMock,
	loadWorksByEventIdMock,
	signFileUrlMock,
	loadRosterMock,
	listSectionsMock,
	listRepertoireItemsMock,
	listWorksMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listEventSeriesForSeasonMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn(),
	signFileUrlMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	listRepertoireItemsMock: vi.fn(),
	listWorksMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
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
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
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
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({
		putLabel: async () => {},
		labelsFor: async () => new Map(),
		remove: async () => {}
	})
}));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import type { Season } from '$lib/seasons/types';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { openFileBytes } from '$lib/files/openFileBytes';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';

let fakeByteStore: FakeByteStore;

type PresenceQuery = (db: string, personId: string) => Promise<string[]>;
function installPresence(impl?: PresenceQuery) {
	const spy = vi.fn<PresenceQuery>(
		impl ?? (async (db, personId) => fakeByteStore.heldFor(db, personId))
	);
	(fakeByteStore as unknown as { heldFileIds: PresenceQuery }).heldFileIds = spy;
	return spy;
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
	signIn();
}

function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'crede', name: 'Crede', personId: 'person-c' }] });
}

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
	stubByteFetch();
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	signFileUrlMock.mockReset();
	gotoMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	listWorksMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	vi.unstubAllGlobals();
	resetAppState();
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
		expect(upcomingRow.contains(held)).toBe(true);
		expect(recentRow.contains(absent)).toBe(true);
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
		await expandWorks(container, 'agenda-recent-row-ev-0');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-absent')).not.toBeNull();
		});

		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p']
		]);
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('while the store has NOT answered, NEITHER badge renders — no default-then-correct; the answer landing paints both, from the answer alone', async () => {
		mockBaselineAgenda();
		setAuthedWithOneCollective();
		const pending = deferred<string[]>();
		installPresence(() => pending.promise);

		const container = await renderAgendaReady();
		const upcomingRow = await expandWorks(container, 'agenda-row-ev-1');

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

describe('#367 — back from the part viewer, the badges show what its store write left', () => {
	function mockOneRecentEventWithTwoParts() {
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
			'ev-1': [workRow('ri-3', 'O nata lux', '')],
			'ev-0': [
				workRow('ri-1', 'Spem in alium', 'file-held'),
				workRow('ri-2', 'If ye love me', 'file-absent')
			]
		});
	}

	async function openAbsentPartInViewer(container: HTMLElement): Promise<string> {
		const recentRow = await expandWorks(container, 'agenda-recent-row-ev-0');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_on_device]'
			);
		});
		const absentRow = q(recentRow, 'file-presence-file-absent')!.closest(
			'[data-testid="work-row"]'
		)!;
		await fireEvent.click(absentRow.querySelector('[data-testid="work-link-pdf"]')!);
		expect(gotoMock.mock.calls.map((c) => c[0])).toEqual(['/part/file-absent?db=sampledb']);
		const opened = await openFileBytes(
			{ db: 'sampledb', token: 'jwt-abc' },
			IDENTITY,
			'file-absent',
			fakeByteStore
		);
		cleanup();
		return opened.url;
	}

	it('the viewer stores an unheld part and its put EVICTS a held one: back on the agenda the evicted row stops claiming on-device (network-stored path)', async () => {
		mockOneRecentEventWithTwoParts();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-agenda?X-Amz-Expires=60');
		const realPut = fakeByteStore.put.bind(fakeByteStore);
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async (identity, fileId, data) => {
			await realPut(identity, fileId, data);
			await fakeByteStore.evict(IDENTITY, 'file-held');
		});
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

		await openAbsentPartInViewer(await renderAgendaReady());
		expect(openSpy).not.toHaveBeenCalled();

		const container = await renderAgendaReady();
		await expandWorks(container, 'agenda-recent-row-ev-0');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-absent')!.textContent).toContain(
				'[file_presence_on_device]'
			);
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
		});
		expect(presenceSpy.mock.calls).toEqual([
			['sampledb', 'person-p'],
			['sampledb', 'person-p']
		]);
	});

	it('the viewer’s put EVICTS a held row and then REJECTS: back on the agenda neither row claims on-device (network-uncached path)', async () => {
		mockOneRecentEventWithTwoParts();
		setAuthedWithOneCollective();
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-agenda?X-Amz-Expires=60');
		vi.spyOn(fakeByteStore, 'put').mockImplementation(async () => {
			await fakeByteStore.evict(IDENTITY, 'file-held');
			throw new Error('idb: transaction aborted');
		});
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

		const delivered = await openAbsentPartInViewer(await renderAgendaReady());
		expect(delivered).not.toBe('');
		expect(openSpy).not.toHaveBeenCalled();

		const container = await renderAgendaReady();
		await expandWorks(container, 'agenda-recent-row-ev-0');
		await waitFor(() => {
			expect(q(container, 'file-presence-file-absent')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
		});
		expect(presenceSpy.mock.calls).toEqual([
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

		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'agenda-row-ev-1')).not.toBeNull();
			expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);
		});
		await expandWorks(container, 'agenda-row-ev-1');

		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);

		credePending.resolve([]);
		await waitFor(() => {
			expect(q(container, 'file-presence-file-held')!.textContent).toContain(
				'[file_presence_needs_network]'
			);
			expect(q(container, 'file-presence-file-held')!.textContent).not.toContain(
				'[file_presence_on_device]'
			);
		});

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

		expect(presenceSpy.mock.calls).toEqual([['sampledb', 'person-p']]);
		expect(getSpy).not.toHaveBeenCalled();
	});
});
