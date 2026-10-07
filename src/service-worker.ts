/// <reference lib="webworker" />
// The service worker: install precaches the shell, activate drops old deploys, fetch asks swPolicy.
import { build, files, version } from '$service-worker';
import {
	cacheNameFor,
	decideFetch,
	isStaleShellCache,
	precacheUrls,
	servedAsExpected,
	splitPrecache
} from '$lib/sw/swPolicy';
// Named here too in case Vite emits the pdf worker outside the build list.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

declare let self: ServiceWorkerGlobalScope;

const CACHE_NAME = cacheNameFor(version);
const PRECACHE_URLS = precacheUrls({ build, files, extra: [pdfWorkerUrl] });
const { required: REQUIRED_URLS, optional: OPTIONAL_URLS } = splitPrecache(PRECACHE_URLS);

async function fetchChecked(url: string): Promise<[string, Response]> {
	const response = await fetch(url);
	const type = response.headers.get('content-type');
	if (!response.ok || !servedAsExpected(url, type)) {
		throw new TypeError(`Refused to precache ${url}: ${response.status} ${type}`);
	}
	return [url, response];
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			// The core is fetched whole before any write: one bad file fails the install loudly.
			const core = await Promise.all(REQUIRED_URLS.map(fetchChecked));
			await Promise.all(core.map(([url, response]) => cache.put(url, response)));

			// A tail miss costs only the surface that asset serves, so it is skipped, not fatal.
			await Promise.all(
				OPTIONAL_URLS.map((url) =>
					fetchChecked(url)
						.then(([, response]) => cache.put(url, response))
						.catch(() => {})
				)
			);
			await self.skipWaiting(); // a parked tab must not miss a deploy
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys.filter((key) => isStaleShellCache(key, CACHE_NAME)).map((key) => caches.delete(key))
			);
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	const decision = decideFetch(
		{ url: request.url, method: request.method, mode: request.mode },
		{ origin: self.location.origin, precached: PRECACHE_URLS }
	);

	if (decision.kind === 'bypass') return;

	if (decision.kind === 'serve-shell') {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				const shell = await cache.match('/');
				return shell ?? fetch(request);
			})()
		);
		return;
	}

	if (decision.kind === 'cache-first') {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				const cached = await cache.match(request);
				return cached ?? fetch(request);
			})()
		);
		return;
	}

	event.respondWith(fetch(request));
});


// (*MVOX:Josquin*)
