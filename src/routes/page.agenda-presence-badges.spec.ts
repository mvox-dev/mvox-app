// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	listWorksMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listEventSeriesForSeasonMock
} = vi.hoisted(() => ({
	listWorksMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
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
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal(), 'not-editor')
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleStubs')).rsvpDataModule(null)
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).worksModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/library/libraryData', () => ({
	listWorks: listWorksMock,
	listAllEditions: listAllEditionsMock,
	listAllCopies: listAllCopiesMock
}));
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('handle')
);
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
vi.mock('$lib/files/appLabelStore', async () =>
	(await import('$lib/testing/mocks/files')).appLabelStoreModule()
);

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import type { Season } from '$lib/seasons/types';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { gotoMock } from '$lib/testing/routeMocks';
import {
	listSectionsMock,
	loadFullAgendaMock,
	loadWorksByEventIdMock
} from '$lib/testing/moduleHandles';
import { signFileUrlMock } from '$lib/testing/mocks/files';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { listRepertoireItemsMock } from '$lib/testing/mocks/seasons';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { isoDate } from '$lib/testing/pages/seasonPanel';
import { q } from '$lib/testing/pages/seasonRepertoire';
import { pdfData } from '$lib/testing/pages/event';

let fakeByteStore: FakeByteStore;

type PresenceQuery = (db: string, personId: string) => Promise<string[]>;
function installPresence(impl?: PresenceQuery) {
	const spy = vi.fn<PresenceQuery>(
		impl ?? (async (db, personId) => fakeByteStore.heldFor(db, personId))
	);
	fakeByteStore.heldFileIds = spy;
	return spy;
}

const IDENTITY = { db: 'sampledb', personId: 'person-p' };

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

describe('#367 — the season-manage repertoire panel carries the presence badge', () => {
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
