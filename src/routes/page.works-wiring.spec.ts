// @vitest-environment happy-dom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SERVICE_WORKER_PATH = fileURLToPath(new URL('../service-worker.ts', String(import.meta.url)));

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const {
	loadFullAgendaMock,
	listFullAgendaMock,
	discoverMock,
	gotoMock,
	loadWorksByEventIdMock,
	signFileUrlMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	listFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn(),
	signFileUrlMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock,
	listFullAgenda: listFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock, afterNavigate: vi.fn() }));
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/'),
	state: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page: pageStub }));
const pdfjs = vi.hoisted(() => ({
	getDocument: vi.fn((_src: unknown) => ({
		promise: Promise.resolve({
			numPages: 1,
			getPage: async () => ({
				getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
				render: () => ({ promise: Promise.resolve(), cancel: vi.fn() })
			})
		}),
		destroy: vi.fn()
	}))
}));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: pdfjs.getDocument }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/mock-pdf-worker.mjs' }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue('member-1'),
	listMyRsvps: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({ getAppLabelStore: () => ({ putLabel: async () => {}, labelsFor: async () => new Map(), remove: async () => {} }) }));

import Page from './+page.svelte';
import PartPage from './part/[fileId]/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetRetentionForTests } from '$lib/files/retention';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

let fakeByteStore: FakeByteStore;

function setAuthedWithOneCollective() {
	signIn();
}

function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'crede', name: 'Crede', personId: 'person-c' }
		]
	});
}

function stubByteFetch(bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])) {
	const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
		new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'application/pdf' } })
	);
	vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input.toString();
		if (url.startsWith('https://s3.example/')) return fetchMock(input);
		return new Response(JSON.stringify({ entities: [] }), { status: 200 });
	});
	return fetchMock;
}

function partNavigations(): unknown[][] {
	return gotoMock.mock.calls.filter((c) => String(c[0]).startsWith('/part/'));
}

async function recentPdf(container: HTMLElement, fileId = 'file-score'): Promise<HTMLElement> {
	const row = '[data-testid="agenda-recent-row-ev-0"]';
	return vi.waitFor(() => {
		const line = container.querySelector(`${row} [data-testid="works-line"]`);
		expect(line).not.toBeNull();
		if (!container.querySelector(`${row} [data-testid="work-row"]`)) {
			void fireEvent.click(line!);
		}
		const badge = container.querySelector(`${row} [data-testid="file-presence-${fileId}"]`);
		expect(badge).not.toBeNull();
		const pdf = badge!.closest('[data-testid="work-row"]')?.querySelector('[data-testid="work-link-pdf"]');
		expect(pdf).not.toBeNull();
		return pdf as HTMLElement;
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

const fartherFuture = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
const upcomingTwo = [
	upcoming[0],
	{
		id: 'ev-2',
		name: 'Concert',
		startDatetime: fartherFuture,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	}
];

function workRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'ri-1',
		kind: 'repertoire' as const,
		workId: 'work-1',
		editionId: 'ed-1',
		workName: 'Spem in alium',
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: '40-part original',
		ordinal: null,
		fileId: '',
		externalLinks: [],
		canBorrow: false,
		notes: '',
		...overrides
	};
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	resetRetentionForTests();
	listFullAgendaMock.mockResolvedValue(fullAgendaResult());
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	listFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	signFileUrlMock.mockReset();
	gotoMock.mockReset();
	pdfjs.getDocument.mockClear();
	vi.unstubAllGlobals();
	resetAppState();
});

describe('+page — Works element wiring (#90 TR.2)', () => {
	it('resolves works for every agenda event (upcoming AND recent) with the current season id', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent,
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({});
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(loadWorksByEventIdMock).toHaveBeenCalled();
		});
		expect(loadWorksByEventIdMock).toHaveBeenCalledWith(
			{ db: 'sampledb', token: 'jwt-abc' },
			['ev-1', 'ev-0'],
			'season-1',
			expect.anything(),
			{ includeInactive: false, cache: 'store' }
		);
	});

	it('renders the resolved works inside the matching agenda row — the element a member actually sees', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow()] });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-ev-1"]')).not.toBeNull();
		});
		await vi.waitFor(() => {
			const line = container
				.querySelector('[data-testid="agenda-row-ev-1"]')
				?.querySelector('[data-testid="works-line"]');
			expect(line).not.toBeNull();
			expect(line?.textContent).toContain('Spem in alium');
		});
	});

	it("signs ONLY the next event's parts on open; a click on any other part signs nothing", async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: upcomingTwo,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [
				workRow({ id: 'ri-a1', fileId: 'file-a1', fileName: 'a1.pdf' }),
				workRow({ id: 'ri-a2', fileId: 'file-a2', fileName: 'a2.pdf' })
			],
			'ev-2': [workRow({ id: 'ri-b1', fileId: 'file-b1', fileName: 'b1.pdf' })]
		});
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		const fetchMock = stubByteFetch();
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await vi.waitFor(() => {
			expect(fakeByteStore.heldFor('sampledb', 'person-p').sort()).toEqual([
				'file-a1',
				'file-a2'
			]);
		});
		expect(signFileUrlMock.mock.calls.map((c) => c[1])).toEqual(['file-a1', 'file-a2']);
		const signOrder = signFileUrlMock.mock.invocationCallOrder;
		const fetchOrder = fetchMock.mock.invocationCallOrder;
		expect(signOrder[0]).toBeLessThan(fetchOrder[0]);
		expect(fetchOrder[0]).toBeLessThan(signOrder[1]);
		expect(signOrder[1]).toBeLessThan(fetchOrder[1]);
		expect(String(fetchMock.mock.calls[0][0])).toBe('https://s3.example/signed-file-a1');
		expect(String(fetchMock.mock.calls[1][0])).toBe('https://s3.example/signed-file-a2');

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-row-ev-2"] [data-testid="works-line"]')!
		);
		const pdf = container.querySelector(
			'[data-testid="agenda-row-ev-2"] [data-testid="work-link-pdf"]'
		);
		expect(pdf?.getAttribute('href')).toBeNull();
		await fireEvent.click(pdf!);

		expect(gotoMock.mock.calls.filter((c) => String(c[0]).startsWith('/part/'))).toEqual([
			[
				'/part/file-b1?db=sampledb',
				{
					state: {
						partLabel: {
							work: 'Spem in alium',
							composer: 'Thomas Tallis',
							edition: '40-part original',
							filename: 'b1.pdf'
						}
					}
				}
			]
		]);
		expect(signFileUrlMock.mock.calls.map((c) => c[1])).toEqual(['file-a1', 'file-a2']);
		expect(openSpy).not.toHaveBeenCalled();
	});

	it('a part click goes to /part/{fileId}?db=… with the row label in the navigation state, and opens no tab', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent,
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [],
			'ev-0': [workRow({ fileId: 'file-score', fileName: 'SOPRAN.pdf' })]
		});
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		const fetchMock = stubByteFetch();
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const pdf = await recentPdf(container);
		await fireEvent.click(pdf);

		expect(partNavigations()).toEqual([
			[
				'/part/file-score?db=sampledb',
				{
					state: {
						partLabel: {
							work: 'Spem in alium',
							composer: 'Thomas Tallis',
							edition: '40-part original',
							filename: 'SOPRAN.pdf'
						}
					}
				}
			]
		]);
		expect(openSpy).not.toHaveBeenCalled();
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(fakeByteStore.puts).toEqual([]);
	});

	it('the click moves no bytes, however often: two opens are two navigations and zero signs, fetches or store writes', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent,
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [],
			'ev-0': [workRow({ fileId: 'file-score' })]
		});
		signFileUrlMock.mockRejectedValue(new Error('403'));
		const fetchMock = stubByteFetch();
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const pdf = await recentPdf(container);
		await fireEvent.click(pdf);
		await fireEvent.click(pdf);

		expect(partNavigations().map((c) => c[0])).toEqual([
			'/part/file-score?db=sampledb',
			'/part/file-score?db=sampledb'
		]);
		expect(openSpy).not.toHaveBeenCalled();
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(fakeByteStore.puts).toEqual([]);
		expect(container.querySelector('[data-testid="repertoire-pdf-error"]')).toBeNull();
	});

	it('OFFLINE: a held part opens from the agenda with the network down, and the viewer serves it from the store', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-1': [workRow({ fileId: 'file-score' })] });
		signFileUrlMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const fetchMock = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.startsWith('https://s3.example/')) return fetchMock();
			throw new TypeError('Failed to fetch');
		});
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-p' }, 'file-score', {
			bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
			filetype: 'application/pdf',
			sha256: 'sha-cached'
		});
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="works-line"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="works-line"]')!);
		const link = await vi.waitFor(() => {
			const el = container.querySelector('[data-testid="part-link-file-score"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(link.getAttribute('href')).toBe('/part/file-score?db=sampledb');
		await fireEvent.click(link);

		const [[target, options]] = partNavigations();
		expect(target).toBe('/part/file-score?db=sampledb');
		expect(openSpy).not.toHaveBeenCalled();
		cleanup();

		const url = new URL(String(target), 'http://localhost');
		pageStub.params = { fileId: url.pathname.split('/')[2] };
		pageStub.url = url;
		pageStub.state = (options as { state: typeof pageStub.state }).state;
		const viewer = render(PartPage);
		await vi.waitFor(() => {
			expect(
				viewer.container.querySelector('[data-testid="part-viewer-page-indicator"]')
			).not.toBeNull();
		});
		const src = pdfjs.getDocument.mock.calls[0][0] as { url: string };
		expect(src.url).toMatch(/^blob:/);
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('the link carries the db of the collective selected at click time, for each collective', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent,
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve({
				'ev-1': [],
				'ev-0': [workRow({ fileId: cfg.db === 'sampledb' ? 'file-score' : 'file-crede' })]
			})
		);
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		stubByteFetch();
		const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
		setAuthedWithTwoCollectives();

		const { container } = render(Page);
		await fireEvent.click(await recentPdf(container));
		selectedCollectiveDbStore.set('crede');
		await vi.waitFor(() => {
			expect(loadWorksByEventIdMock.mock.calls.some((c) => c[0].db === 'crede')).toBe(true);
		});
		await fireEvent.click(await recentPdf(container, 'file-crede'));

		expect(partNavigations().map((c) => c[0])).toEqual([
			'/part/file-score?db=sampledb',
			'/part/file-crede?db=crede'
		]);
		expect(openSpy).not.toHaveBeenCalled();
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fakeByteStore.heldFor('sampledb', 'person-p')).toEqual([]);
		expect(fakeByteStore.heldFor('crede', 'person-c')).toEqual([]);
	});

	it('a failed works read leaves the agenda intact, just work-free', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockRejectedValue(new Error('boom'));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-ev-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="works-line"]')).toBeNull();
	});
});

describe("#409 — the next event's parts reach the device on app open", () => {
	function sha256HexSync(bytes: Uint8Array): string {
		return createHash('sha256').update(bytes).digest('hex');
	}

	it('on agenda load settle, every next-event part not yet held is fetched once and stored — held parts are skipped without a get()', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [
				workRow({ id: 'ri-a1', fileId: 'file-a1', fileName: 'a1.pdf' }),
				workRow({ id: 'ri-a2', fileId: 'file-a2', fileName: 'a2.pdf' })
			]
		});
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-p' }, 'file-a1', {
			bytes: pdfBytes.slice().buffer,
			filetype: 'application/pdf',
			sha256: sha256HexSync(pdfBytes)
		});
		const getSpy = vi.spyOn(fakeByteStore, 'get');
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		const fetchMock = stubByteFetch();
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(fakeByteStore.heldFor('sampledb', 'person-p').sort()).toEqual([
				'file-a1',
				'file-a2'
			]);
		});
		expect(signFileUrlMock.mock.calls.map((c) => c[1])).toEqual(['file-a2']);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe('https://s3.example/signed-file-a2');
		expect(
			fakeByteStore.puts.map((p) => ({
				identity: p.identity,
				fileId: p.fileId,
				filetype: p.data.filetype,
				sha256: p.data.sha256,
				bytes: Array.from(new Uint8Array(p.data.bytes))
			}))
		).toEqual([
			{
				identity: { db: 'sampledb', personId: 'person-p' },
				fileId: 'file-a2',
				filetype: 'application/pdf',
				sha256: sha256HexSync(pdfBytes),
				bytes: Array.from(pdfBytes)
			}
		]);
		expect(getSpy.mock.calls.map((c) => c[1])).toEqual(['file-a2']);
	});

	it('after the prefetch writes, presence is re-queried ONCE and the fetched parts render the on-device badge — no reload, no click', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [
				workRow({ id: 'ri-a1', fileId: 'file-a1', fileName: 'a1.pdf' }),
				workRow({ id: 'ri-a2', fileId: 'file-a2', fileName: 'a2.pdf' })
			]
		});
		const heldSpy = vi.spyOn(fakeByteStore, 'heldFileIds');
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		stubByteFetch();
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await vi.waitFor(() => {
			expect(fakeByteStore.heldFor('sampledb', 'person-p').sort()).toEqual([
				'file-a1',
				'file-a2'
			]);
		});
		await vi.waitFor(() => {
			expect(heldSpy).toHaveBeenCalledTimes(3);
		});
		for (const call of heldSpy.mock.calls) {
			expect(call.slice(0, 2)).toEqual(['sampledb', 'person-p']);
		}
		await fireEvent.click(
			container.querySelector('[data-testid="agenda-row-ev-1"] [data-testid="works-line"]')!
		);
		await vi.waitFor(() => {
			const a1 = container.querySelector('[data-testid="file-presence-file-a1"]');
			const a2 = container.querySelector('[data-testid="file-presence-file-a2"]');
			expect(a1?.textContent?.trim()).toBe('[file_presence_on_device]');
			expect(a2?.textContent?.trim()).toBe('[file_presence_on_device]');
		});
	});

	it("nothing runs while the app is closed: the prefetch fires from the page's own load chain — no visibility/focus/sync hooks, and the service worker is byte-unmodified", async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [workRow({ id: 'ri-a1', fileId: 'file-a1', fileName: 'a1.pdf' })]
		});
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		stubByteFetch();
		const winAdd = vi.spyOn(window, 'addEventListener');
		const docAdd = vi.spyOn(document, 'addEventListener');
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(fakeByteStore.heldFor('sampledb', 'person-p')).toEqual(['file-a1']);
		});
		const banned = ['visibilitychange', 'focus', 'sync', 'periodicsync'];
		expect(winAdd.mock.calls.filter(([name]) => banned.includes(String(name)))).toEqual([]);
		expect(docAdd.mock.calls.filter(([name]) => banned.includes(String(name)))).toEqual([]);
		const swSource = readFileSync(SERVICE_WORKER_PATH, 'utf-8');
		expect(createHash('sha256').update(swSource).digest('hex')).toBe(
			'b360f68c38d3972899cfea912840eb79002f06c7dd2e15e03e01b90cf91c9d9a'
		);
		expect(
			[...swSource.matchAll(/self\.addEventListener\('([a-z]+)'/g)].map((m) => m[1])
		).toEqual(['install', 'activate', 'fetch']);
		winAdd.mockRestore();
		docAdd.mockRestore();
	});
});

describe('#410 — the pressure sweep runs at app open, before the prefetch, scoped to every JOINED collective', () => {
	it('app open: protected set is handed over, relieve() runs, and ONLY THEN the prefetch signs — order pinned', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		listFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		loadWorksByEventIdMock.mockResolvedValue({
			'ev-1': [
				workRow({ id: 'ri-a1', fileId: 'file-a1', fileName: 'a1.pdf' }),
				workRow({ id: 'ri-a2', fileId: 'file-a2', fileName: 'a2.pdf' })
			]
		});
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		stubByteFetch();
		const protectSpy = vi.spyOn(fakeByteStore, 'setProtectedKeys');
		const relieveSpy = vi.spyOn(fakeByteStore, 'relieve');
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(relieveSpy).toHaveBeenCalled();
			expect(fakeByteStore.heldFor('sampledb', 'person-p').sort()).toEqual([
				'file-a1',
				'file-a2'
			]);
		});
		expect(listFullAgendaMock).not.toHaveBeenCalled();
		expect(protectSpy).toHaveBeenCalled();
		const handed = protectSpy.mock.calls.at(-1)![0];
		expect([...handed].sort()).toEqual(
			[
				JSON.stringify(['sampledb', 'person-p', 'file-a1']),
				JSON.stringify(['sampledb', 'person-p', 'file-a2'])
			].sort()
		);
		expect(protectSpy.mock.invocationCallOrder[0]).toBeLessThan(
			relieveSpy.mock.invocationCallOrder[0]
		);
		expect(relieveSpy.mock.invocationCallOrder[0]).toBeLessThan(
			signFileUrlMock.mock.invocationCallOrder[0]
		);
	});

	it("two joined dbs → ONE agenda read for the db she is not looking at, BOTH next-event sets protected; a db she has not joined is never read; the build itself makes ZERO byte-store get()s", async () => {
		const credeSoon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
		const credeLater = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
		const credeUpcoming = [
			{ id: 'ev-c1', name: 'Crede rehearsal', startDatetime: credeSoon, durationMinutes: 90, location: '', conductors: [], owners: [], editors: [] },
			{ id: 'ev-c2', name: 'Crede concert', startDatetime: credeLater, durationMinutes: 90, location: '', conductors: [], owners: [], editors: [] }
		];
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		listFullAgendaMock.mockImplementation(async (cfg: { db: string; token: string }) =>
			cfg.db === 'crede'
				? fullAgendaResult({ seasons: [],
						upcoming: credeUpcoming,
						recent: [],
						seasonId: 'season-c',
						seasonConductors: [], seasonOwners: [], seasonEditors: []
					})
				: fullAgendaResult({ seasons: [],
						upcoming,
						recent: [],
						seasonId: 'season-1',
						seasonConductors: [], seasonOwners: [], seasonEditors: []
					})
		);
		loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'crede'
				? { 'ev-c1': [workRow({ id: 'ri-c1', fileId: 'file-c1', fileName: 'c1.pdf' })] }
				: { 'ev-1': [workRow({ id: 'ri-p1', fileId: 'file-p1', fileName: 'p1.pdf' })] }
		);
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		stubByteFetch();
		const protectSpy = vi.spyOn(fakeByteStore, 'setProtectedKeys');
		const relieveSpy = vi.spyOn(fakeByteStore, 'relieve');
		const getSpy = vi.spyOn(fakeByteStore, 'get');
		setAuthedWithTwoCollectives();

		render(Page);

		await vi.waitFor(() => {
			expect(relieveSpy).toHaveBeenCalled();
			expect(fakeByteStore.heldFor('sampledb', 'person-p')).toEqual(['file-p1']);
		});
		const agendaDbs = listFullAgendaMock.mock.calls.map((c) => (c[0] as { db: string }).db);
		expect([...agendaDbs].sort()).toEqual(['crede']);
		for (const call of listFullAgendaMock.mock.calls) {
			expect((call[0] as { token: string }).token).toBe('jwt-abc');
		}
		const sampleWorkCalls = loadWorksByEventIdMock.mock.calls.filter(
			(c) => (c[0] as { db: string }).db === 'sampledb'
		);
		expect(sampleWorkCalls.map((c) => c[4])).toEqual([{ includeInactive: false, cache: 'store' }]);
		const credeWorkCalls = loadWorksByEventIdMock.mock.calls.filter(
			(c) => (c[0] as { db: string }).db === 'crede'
		);
		expect(credeWorkCalls.length).toBe(1);
		expect(credeWorkCalls[0][1]).toEqual(['ev-c1']);
		expect(credeWorkCalls[0][2]).toBe('season-c');
		const handed = protectSpy.mock.calls.at(-1)![0];
		expect([...handed].sort()).toEqual(
			[
				JSON.stringify(['crede', 'person-c', 'file-c1']),
				JSON.stringify(['sampledb', 'person-p', 'file-p1'])
			].sort()
		);
		expect(getSpy.mock.calls.map((c) => c[1])).toEqual(['file-p1']);
		expect(signFileUrlMock.mock.calls.map((c) => c[1])).toEqual(['file-p1']);
		expect(fakeByteStore.heldFor('crede', 'person-c')).toEqual([]);
	});

	it('a collective switch WHILE the build is in flight does not cancel retention: the set still lands, whole, exactly once', async () => {
		let releaseCredeAgenda: (() => void) | undefined;
		const credeSoon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
		const credeUpcoming = [
			{ id: 'ev-c1', name: 'Crede rehearsal', startDatetime: credeSoon, durationMinutes: 90, location: '', conductors: [], owners: [], editors: [] }
		];
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming,
			recent: [],
			seasonId: 'season-1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		listFullAgendaMock.mockImplementation(async (cfg: { db: string }) => {
			if (cfg.db !== 'crede') return fullAgendaResult();
			await new Promise<void>((resolve) => {
				releaseCredeAgenda = resolve;
			});
			return fullAgendaResult({ seasons: [],
				upcoming: credeUpcoming,
				recent: [],
				seasonId: 'season-c',
				seasonConductors: [], seasonOwners: [], seasonEditors: []
			});
		});
		loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'crede'
				? { 'ev-c1': [workRow({ id: 'ri-c1', fileId: 'file-c1', fileName: 'c1.pdf' })] }
				: { 'ev-1': [workRow({ id: 'ri-p1', fileId: 'file-p1', fileName: 'p1.pdf' })] }
		);
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		stubByteFetch();
		const protectSpy = vi.spyOn(fakeByteStore, 'setProtectedKeys');
		const relieveSpy = vi.spyOn(fakeByteStore, 'relieve');
		setAuthedWithTwoCollectives();

		render(Page);

		await vi.waitFor(() => {
			expect(releaseCredeAgenda).toBeTypeOf('function');
		});
		expect(protectSpy).not.toHaveBeenCalled();
		selectedCollectiveDbStore.set('crede');
		releaseCredeAgenda!();

		await vi.waitFor(() => {
			expect(relieveSpy).toHaveBeenCalled();
		});
		expect(protectSpy).toHaveBeenCalledTimes(1);
		expect([...protectSpy.mock.calls[0][0]].sort()).toEqual(
			[
				JSON.stringify(['crede', 'person-c', 'file-c1']),
				JSON.stringify(['sampledb', 'person-p', 'file-p1'])
			].sort()
		);
		expect(relieveSpy).toHaveBeenCalledTimes(1);
	});
});
