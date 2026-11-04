// @vitest-environment happy-dom
// #1069: her marks and her page follow her to another device through Entu; nobody else sees them.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { fileId: 'file-score' } as Record<string, string>,
	url: new URL('http://localhost/part/file-score?db=sampledb'),
	state: {}
}));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: () => {} })
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({ putLabel: async () => {}, labelOf: async () => undefined, remove: async () => {} })
}));
vi.mock('$lib/strokes/appInk', () => ({ getInkStore: () => current.store }));
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('pdfjs-dist', () => ({
	GlobalWorkerOptions: { workerSrc: '' },
	getDocument: () => ({
		promise: Promise.resolve({
			numPages: 3,
			getPage: async () => ({
				getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
				render: () => ({ promise: Promise.resolve(), cancel: () => {} })
			})
		}),
		destroy: () => {}
	}),
	RenderingCancelledException: class extends Error {}
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () =>
	(await import('$lib/testing/mocks/files')).pdfWorkerUrlModule()
);

import { IDBFactory } from 'fake-indexeddb';
import Page from './[fileId]/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import { collectiveState } from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { deferred } from '$lib/testing/entuFetchKit';
import { inkEntu } from '$lib/testing/inkEntu';
import { installLocks } from '$lib/testing/locks';
import { signFileUrlMock } from '$lib/testing/mocks/files';
import { createInkStore, type SyncedInkStore } from '$lib/strokes/inkStore';
import { createInkSync, type InkSync } from '$lib/strokes/inkSync';
import { createInkSyncQueue } from '$lib/strokes/inkSyncQueue';
import { createSyncedInkStore } from '$lib/strokes/syncedInkStore';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const RECT = { left: 0, top: 0, x: 0, y: 0, width: 400, height: 400, right: 400, bottom: 400 };
const MOUSE = { pointerType: 'mouse', pointerId: 1, isPrimary: true };
const RED = '#dc2626';
const BLACK = '#111827';
const PAGE = (n: number) => `[part_viewer_page_of {"current":${n},"total":3}]`;
const TOKENS: Record<string, string> = { 'person-p': 'jwt-p', 'person-q': 'jwt-q' };

let fakeByteStore: FakeByteStore;
let entu: ReturnType<typeof inkEntu>;
let current: { store: SyncedInkStore; sync: InkSync };
const syncs: InkSync[] = [];

/** One device: its own IndexedDB, the same Entu. `held` keeps its first device save waiting. */
function onDevice(fetchImpl: typeof fetch = entu.fetchImpl, held?: Promise<void>) {
	const factory = new IDBFactory();
	const real = createInkStore(factory);
	let first = true;
	const device = !held
		? real
		: {
				...real,
				save: async (...args: Parameters<typeof real.save>) => {
					if (first) {
						first = false;
						await held;
					}
					return real.save(...args);
				}
			};
	const queue = createInkSyncQueue(factory);
	const sync = createInkSync({ queue, device, fetchImpl });
	syncs.push(sync);
	return { store: createSyncedInkStore({ device, queue, sync }), sync };
}

async function open(on: typeof current, personId = 'person-p'): Promise<HTMLElement> {
	cleanup();
	current = on;
	fakeByteStore.seed({ db: 'sampledb', personId }, 'file-score', {
		bytes: PDF_BYTES.slice().buffer,
		filetype: 'application/pdf',
		sha256: 'sha-fixture'
	});
	setToken(TOKENS[personId]);
	authStore.set({ status: 'authenticated', personIdByDb: { sampledb: personId }, expMs: Date.now() + 100_000 });
	collectiveState.set({ status: 'loading' });
	const { container } = render(Page);
	await waitFor(() => expect(container.querySelector('[data-testid="part-viewer-ink"]')).not.toBeNull());
	return container;
}

const indicator = (c: HTMLElement) =>
	c.querySelector('[data-testid="part-viewer-page-indicator"]')?.textContent?.trim() ?? '';
const pen = (c: HTMLElement) => c.querySelector('[data-testid="part-viewer-pen"]') as HTMLButtonElement;
const control = (c: HTMLElement, key: string) =>
	c.querySelector(`button[aria-label="[${key}]"]`) as HTMLButtonElement;

function marks(c: HTMLElement): string[] {
	const svg = c.querySelector('svg[data-testid="stroke-surface"]');
	if (!svg) return [];
	return [...svg.querySelectorAll('path:not([data-testid="live-stroke"])')].map((p) => p.getAttribute('stroke') ?? '');
}

async function stroke(c: HTMLElement, y: number): Promise<void> {
	const svg = c.querySelector('svg[data-testid="stroke-surface"]') as SVGSVGElement;
	await fireEvent.pointerDown(svg, { ...MOUSE, clientX: 160, clientY: y });
	await fireEvent.pointerMove(svg, { ...MOUSE, clientX: 240, clientY: y });
	await fireEvent.pointerUp(svg, { ...MOUSE, clientX: 240, clientY: y });
}

async function turnTo(c: HTMLElement, page: number): Promise<void> {
	await fireEvent.keyDown(window, { key: 'ArrowRight' });
	await waitFor(() => expect(indicator(c)).toEqual(PAGE(page)));
}

/** Waits until Entu holds `count` of her live marks on the page. */
async function inEntu(page: number, count: number, personId = 'person-p'): Promise<void> {
	await waitFor(() => {
		const logs = entu.layers('sampledb', personId).flatMap((l) => l.pages.filter((p) => p.page === page));
		const erased = new Set(logs.flatMap((l) => l.erased));
		const ids = new Set(logs.flatMap((l) => l.strokes).map((s) => s.id));
		expect([...ids].filter((id) => !erased.has(id))).toHaveLength(count);
	});
}

let rectSpy: { mockRestore: () => void };

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	resetTypeIdCache();
	installLocks();
	entu = inkEntu({
		tokens: { 'jwt-p': { sampledb: 'person-p' }, 'jwt-q': { sampledb: 'person-q' } },
		files: { sampledb: { 'file-score': 'edition-1' } }
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		})
	);
	signFileUrlMock.mockRejectedValue(new TypeError('Failed to fetch'));
	rectSpy = vi
		.spyOn(Element.prototype, 'getBoundingClientRect')
		.mockReturnValue({ ...RECT, toJSON: () => RECT } as DOMRect);
});

afterEach(() => {
	cleanup();
	for (const sync of syncs.splice(0)) sync.cancel();
	rectSpy.mockRestore();
	vi.unstubAllGlobals();
	signFileUrlMock.mockReset();
	resetAppState();
});

describe('#1069 — her marks on another device', () => {
	it('she marks a part on one device; on another, signed in as her, the marks are there', async () => {
		const a = await open(onDevice());
		await fireEvent.click(pen(a));
		await stroke(a, 200);
		await fireEvent.click(control(a, 'strokes_pen_black_aria_label'));
		await stroke(a, 300);
		await inEntu(1, 2);

		const b = await open(onDevice());
		await waitFor(() => expect(marks(b)).toEqual([RED, BLACK]));
	});

	it('the part opens on her last saved page, from either device', async () => {
		const deviceA = onDevice();
		const a = await open(deviceA);
		expect(indicator(a)).toEqual(PAGE(1));
		await turnTo(a, 2);
		await turnTo(a, 3);
		await waitFor(() => expect(entu.layers('sampledb', 'person-p')[0]?.place).toBe(3));

		const deviceB = onDevice();
		const b = await open(deviceB);
		await waitFor(() => expect(indicator(b)).toEqual(PAGE(3)));
		await fireEvent.keyDown(window, { key: 'ArrowLeft' });
		await waitFor(() => expect(indicator(b)).toEqual(PAGE(2)));
		await waitFor(() => expect(entu.layers('sampledb', 'person-p')[0]?.place).toBe(2));

		const again = await open(deviceA);
		await waitFor(() => expect(indicator(again)).toEqual(PAGE(2)));
	});

	it('marks from Entu that arrive after she has started drawing join hers; neither is lost', async () => {
		const a = await open(onDevice());
		await fireEvent.click(pen(a));
		await stroke(a, 200);
		await inEntu(1, 1);

		const gate = deferred();
		const held = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=ink_layer')) await gate.promise;
			return entu.fetchImpl(input, init);
		});
		const b = await open(onDevice(held));
		expect(marks(b)).toEqual([]);
		await fireEvent.click(pen(b));
		await fireEvent.click(control(b, 'strokes_pen_black_aria_label'));
		await stroke(b, 300);
		gate.resolve();

		await waitFor(() => expect(marks(b)).toEqual([BLACK, RED]));
		await inEntu(1, 2);
		const c = await open(onDevice());
		await waitFor(() => expect([...marks(c)].sort()).toEqual([BLACK, RED].sort()));
	});
});

describe('#1069 — a join that lands between her change and its save', () => {
	it('she draws again while a save runs and Entu\'s marks wait behind it: none are erased', async () => {
		const a = await open(onDevice());
		await fireEvent.click(pen(a));
		await stroke(a, 200);
		await inEntu(1, 1);

		const pulled = deferred();
		const saving = deferred();
		const held = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=ink_layer')) await pulled.promise;
			return entu.fetchImpl(input, init);
		});
		const b = await open(onDevice(held, saving.promise));
		await fireEvent.click(pen(b));
		await fireEvent.click(control(b, 'strokes_pen_black_aria_label'));
		await stroke(b, 300);
		pulled.resolve();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await stroke(b, 350);
		saving.resolve();

		await waitFor(() => expect(marks(b)).toHaveLength(3));
		await inEntu(1, 3);
		const c = await open(onDevice());
		await waitFor(() => expect([...marks(c)].sort()).toEqual([BLACK, BLACK, RED].sort()));
	});
});

describe('#1069 — only she sees her layer', () => {
	it('another person signed in on the same device never sees her layer', async () => {
		const deviceA = onDevice();
		const a = await open(deviceA);
		await fireEvent.click(pen(a));
		await stroke(a, 200);
		await inEntu(1, 1);

		const theirs = await open(deviceA, 'person-q');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(marks(theirs)).toEqual([]);

		const fresh = await open(onDevice(), 'person-q');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(marks(fresh)).toEqual([]);
		expect(entu.layers('sampledb', 'person-q')).toEqual([]);

		const hers = await open(onDevice());
		await waitFor(() => expect(marks(hers)).toEqual([RED]));
	});
});

// (*MVOX:Josquin*)
