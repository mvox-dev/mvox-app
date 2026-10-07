// The service worker run for real: install, activate and fetch events against fake caches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://mvox.eu';
const ENTRY = '/_app/immutable/entry/start.abc123.js';
const NODE = '/_app/immutable/nodes/14.d00d.js';
const WORKER = '/_app/immutable/assets/pdf.worker.C0ffee.mjs';

vi.mock('$service-worker', () => ({
	build: [ENTRY, NODE],
	files: ['/robots.txt'],
	prerendered: ['/version.json'],
	version: 'v42'
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: WORKER }));

type Listener = (event: unknown) => void;

interface FakeCache {
	entries: Map<string, Response>;
	match: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
}

let listeners: Map<string, Listener>;
let cacheStore: Map<string, FakeCache>;
let unreachable: Set<string>;
let servedAs: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let skipWaiting: ReturnType<typeof vi.fn>;
let claim: ReturnType<typeof vi.fn>;
let phase: string;
let putPhases: string[];

function pathOf(request: string | { url: string }): string {
	const url = typeof request === 'string' ? request : request.url;
	return new URL(url, ORIGIN).pathname;
}

function typeOf(path: string): string {
	if (/\.m?js$/.test(path)) return 'application/javascript';
	if (path === '/') return 'text/html; charset=utf-8';
	return 'text/plain; charset=utf-8';
}

function createCache(): FakeCache {
	const entries = new Map<string, Response>();
	return {
		entries,
		match: vi.fn(async (request: string | { url: string }) => entries.get(pathOf(request))),
		put: vi.fn(async (request: string | { url: string }, response: Response) => {
			putPhases.push(phase);
			entries.set(pathOf(request), response);
		})
	};
}

function seedCaches(names: string[]): void {
	for (const name of names) cacheStore.set(name, createCache());
}

async function bootWorker(): Promise<void> {
	vi.resetModules();
	await import('./service-worker');
}

async function dispatch(type: string, extra: Record<string, unknown> = {}) {
	phase = type;
	let waited: Promise<unknown> | undefined;
	let responded: Promise<Response> | undefined;
	listeners.get(type)!({
		...extra,
		waitUntil: (p: Promise<unknown>) => (waited = p),
		respondWith: (p: Promise<Response>) => (responded = p)
	});
	return { waited, responded };
}

function fetchEvent(url: string, mode = 'cors') {
	return dispatch('fetch', { request: { url, method: 'GET', mode } });
}

async function install() {
	await bootWorker();
	const { waited } = await dispatch('install');
	return { waited, cached: () => [...(cacheStore.get('mvox-shell-v42')?.entries.keys() ?? [])] };
}

beforeEach(() => {
	listeners = new Map();
	cacheStore = new Map();
	unreachable = new Set();
	servedAs = new Map();
	putPhases = [];
	phase = 'boot';
	fetchMock = vi.fn(async (request: string | { url: string }) => {
		const url = typeof request === 'string' ? request : request.url;
		const path = pathOf(request);
		if (unreachable.has(path)) throw new TypeError('Failed to fetch');
		return new Response(`network ${url}`, {
			headers: { 'content-type': servedAs.get(path) ?? typeOf(path) }
		});
	});
	skipWaiting = vi.fn(async () => {});
	claim = vi.fn(async () => {});
	vi.stubGlobal('self', {
		addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
		skipWaiting,
		clients: { claim },
		location: { origin: ORIGIN }
	});
	vi.stubGlobal('caches', {
		open: vi.fn(async (name: string) => {
			if (!cacheStore.has(name)) cacheStore.set(name, createCache());
			return cacheStore.get(name)!;
		}),
		keys: vi.fn(async () => [...cacheStore.keys()]),
		delete: vi.fn(async (name: string) => cacheStore.delete(name))
	});
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('boot', () => {
	it('listens for install, activate and fetch only — nothing wakes it while the app is closed', async () => {
		await bootWorker();

		expect([...listeners.keys()]).toEqual(['install', 'activate', 'fetch']);
	});
});

describe('install', () => {
	it('caches every precached file as the network served it into this deploy cache, then takes over', async () => {
		const { waited, cached } = await install();
		await waited;

		expect([...cacheStore.keys()]).toEqual(['mvox-shell-v42']);
		expect(cached().sort()).toEqual([ENTRY, NODE, WORKER, '/', '/_app/env.js', '/robots.txt'].sort());
		const entry = cacheStore.get('mvox-shell-v42')!.entries.get(ENTRY)!;
		expect(await entry.text()).toBe(`network ${ENTRY}`);
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});

	it('a tail asset that cannot be fetched does not fail the install', async () => {
		unreachable.add(WORKER);
		const { waited, cached } = await install();

		await expect(waited).resolves.toBeUndefined();
		expect(cached()).not.toContain(WORKER);
		expect(cached()).toContain(NODE);
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});

	it('a core asset that cannot be fetched fails the install and the worker does not take over', async () => {
		unreachable.add('/_app/env.js');
		const { waited } = await install();

		await expect(waited).rejects.toThrow(/Failed to fetch/);
		expect(skipWaiting).not.toHaveBeenCalled();
	});

	it('a core chunk answered as HTML fails the install, is never cached, and the worker does not take over', async () => {
		servedAs.set(ENTRY, 'text/html; charset=utf-8');
		const { waited, cached } = await install();

		await expect(waited).rejects.toThrow(ENTRY);
		expect(cached()).not.toContain(ENTRY);
		expect(skipWaiting).not.toHaveBeenCalled();
	});

	it('a core file outside _app answered as HTML fails the install', async () => {
		servedAs.set('/robots.txt', 'text/html; charset=utf-8');
		const { waited, cached } = await install();

		await expect(waited).rejects.toThrow('/robots.txt');
		expect(cached()).not.toContain('/robots.txt');
	});

	it('a tail chunk answered as HTML is skipped, never cached, and the install still completes', async () => {
		servedAs.set(NODE, 'text/html; charset=utf-8');
		const { waited, cached } = await install();

		await expect(waited).resolves.toBeUndefined();
		expect(cached()).not.toContain(NODE);
		expect(cached()).toContain(WORKER);
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});

	it('a core script answered as CSS fails the install', async () => {
		servedAs.set(ENTRY, 'text/css');
		const { waited, cached } = await install();

		await expect(waited).rejects.toThrow(ENTRY);
		expect(cached()).not.toContain(ENTRY);
	});

	it('never precaches a prerendered page — /version.json stays out of every cache', async () => {
		const { waited, cached } = await install();
		await waited;

		expect(cached()).not.toContain('/version.json');
	});
});

describe('activate', () => {
	it('deletes older shell caches only, keeps this deploy and every foreign cache, then claims the clients', async () => {
		seedCaches(['mvox-shell-v41', 'mvox-shell-v42', 'workbox-precache-v2']);
		await bootWorker();

		const { waited } = await dispatch('activate');
		await waited;

		expect([...cacheStore.keys()]).toEqual(['mvox-shell-v42', 'workbox-precache-v2']);
		expect(claim).toHaveBeenCalledTimes(1);
	});
});

describe('fetch', () => {
	beforeEach(async () => {
		await bootWorker();
		const { waited } = await dispatch('install');
		await waited;
		fetchMock.mockClear();
	});

	it('an Entu API request is left to the browser: no response from the worker, no cache read', async () => {
		const { responded } = await fetchEvent('https://entu.ee/api/sampledb/entity?_type.string=event');

		expect(responded).toBeUndefined();
		expect(cacheStore.get('mvox-shell-v42')!.match).not.toHaveBeenCalled();
	});

	it('/version.json is left to the network', async () => {
		const { responded } = await fetchEvent(`${ORIGIN}/version.json`);

		expect(responded).toBeUndefined();
	});

	it('a navigation is answered with the cached shell', async () => {
		const { responded } = await fetchEvent(`${ORIGIN}/event/ev-1`, 'navigate');

		expect(await (await responded)!.text()).toBe('network /');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('a precached asset is served from the cache', async () => {
		const { responded } = await fetchEvent(`${ORIGIN}${ENTRY}`);

		expect(await (await responded)!.text()).toBe(`network ${ENTRY}`);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('any other same-origin GET goes to the network and is never written to a cache', async () => {
		const { responded } = await fetchEvent(`${ORIGIN}/favicon-new.png`);

		expect(await (await responded)!.text()).toBe(`network ${ORIGIN}/favicon-new.png`);
		expect(putPhases.filter((p) => p !== 'install')).toEqual([]);
	});
});

// (*MVOX:Josquin*)
