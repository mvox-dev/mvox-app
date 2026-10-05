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
	addAll: ReturnType<typeof vi.fn>;
	add: ReturnType<typeof vi.fn>;
	match: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
}

let listeners: Map<string, Listener>;
let cacheStore: Map<string, FakeCache>;
let unreachable: Set<string>;
let fetchMock: ReturnType<typeof vi.fn>;
let skipWaiting: ReturnType<typeof vi.fn>;
let claim: ReturnType<typeof vi.fn>;
let phase: string;
let addAllPhases: string[];

function pathOf(request: string | { url: string }): string {
	const url = typeof request === 'string' ? request : request.url;
	return new URL(url, ORIGIN).pathname;
}

function createCache(): FakeCache {
	const entries = new Map<string, Response>();
	return {
		entries,
		addAll: vi.fn(async (urls: string[]) => {
			addAllPhases.push(phase);
			if (urls.some((url) => unreachable.has(url))) throw new TypeError('Failed to fetch');
			for (const url of urls) entries.set(url, new Response(`cached ${url}`));
		}),
		add: vi.fn(async (url: string) => {
			if (unreachable.has(url)) throw new TypeError('Failed to fetch');
			entries.set(url, new Response(`cached ${url}`));
		}),
		match: vi.fn(async (request: string | { url: string }) => entries.get(pathOf(request))),
		put: vi.fn()
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

beforeEach(() => {
	listeners = new Map();
	cacheStore = new Map();
	unreachable = new Set();
	addAllPhases = [];
	phase = 'boot';
	fetchMock = vi.fn(async (request: { url: string }) => new Response(`network ${request.url}`));
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

describe('install', () => {
	it('batch-writes the core into this deploy cache, adds the tail one by one, then takes over', async () => {
		await bootWorker();

		const { waited } = await dispatch('install');
		await waited;

		const cache = cacheStore.get('mvox-shell-v42')!;
		expect([...cacheStore.keys()]).toEqual(['mvox-shell-v42']);
		expect(cache.addAll.mock.calls).toEqual([[[ENTRY, '/robots.txt', '/', '/_app/env.js']]]);
		expect(cache.add.mock.calls).toEqual([[NODE], [WORKER]]);
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});

	it('a tail asset that cannot be fetched does not fail the install', async () => {
		unreachable.add(WORKER);
		await bootWorker();

		const { waited } = await dispatch('install');

		await expect(waited).resolves.toBeUndefined();
		expect([...cacheStore.get('mvox-shell-v42')!.entries.keys()]).toEqual([
			ENTRY,
			'/robots.txt',
			'/',
			'/_app/env.js',
			NODE
		]);
		expect(skipWaiting).toHaveBeenCalledTimes(1);
	});

	it('a core asset that cannot be fetched fails the install and the worker does not take over', async () => {
		unreachable.add('/_app/env.js');
		await bootWorker();

		const { waited } = await dispatch('install');

		await expect(waited).rejects.toThrow(/Failed to fetch/);
		expect(skipWaiting).not.toHaveBeenCalled();
	});

	it('never precaches a prerendered page — /version.json stays out of every cache', async () => {
		await bootWorker();
		const { waited } = await dispatch('install');
		await waited;

		expect(cacheStore.get('mvox-shell-v42')!.entries.has('/version.json')).toBe(false);
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

		expect(await (await responded)!.text()).toBe('cached /');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('a precached asset is served from the cache', async () => {
		const { responded } = await fetchEvent(`${ORIGIN}${ENTRY}`);

		expect(await (await responded)!.text()).toBe(`cached ${ENTRY}`);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('any other same-origin GET goes to the network and is never written to a cache', async () => {
		const { responded } = await fetchEvent(`${ORIGIN}/favicon-new.png`);

		expect(await (await responded)!.text()).toBe(`network ${ORIGIN}/favicon-new.png`);
		expect(cacheStore.get('mvox-shell-v42')!.put).not.toHaveBeenCalled();
		expect(addAllPhases).toEqual(['install']);
	});
});

// (*MVOX:Josquin*)
