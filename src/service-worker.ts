/// <reference lib="webworker" />
// #353 — the app shell that survives no network.
//
// SvelteKit auto-registers this file (adapter-static + ssr = false — see
// `+layout.ts`) with no manual `navigator.serviceWorker.register` call
// needed. It is EXCLUDED from svelte-check's generated tsconfig (verified:
// `.svelte-kit/tsconfig.json`'s `exclude` names it explicitly), so it is
// type-checked separately by `tsconfig.sw.json` — see `check:sw` in
// package.json and the pin in `src/lib/sw/swPolicy.spec.ts`.
//
// Every DECISION this worker makes lives in `$lib/sw/swPolicy` — a pure,
// unit-tested module — so nothing here can diverge from what the pins in
// swPolicy.spec.ts describe. This file is wiring only: it opens caches, reads
// `$service-worker`'s build manifest, and calls the policy for the verdict.
//
// UPDATE PATH (spike 1d): `skipWaiting()` in `install` + `clients.claim()` in
// `activate` — a new deploy's worker takes over EVERY open tab immediately,
// rather than the default "wait until every tab with the old worker closes"
// dance, which is exactly the parked-tab failure the issue names ("the app
// didn't update", no error anywhere). The tradeoff: a tab already open when a
// new deploy lands can have its in-flight requests taken over by the new
// worker mid-session — acceptable here because every fetch this worker
// touches is either the precached shell (versioned, replaced atomically) or
// passed straight to the network untouched.
//
// $service-worker's list of pre-rendered pages is deliberately NEVER read
// (spike 1c): this app renders nothing ahead of time (`ssr = false`
// everywhere), and touching that list here would risk treating
// '/version.json' — the #350 build stamp — as one of them, which is the
// opposite of what that endpoint exists to do.
import { build, files, version } from '$service-worker';
import {
	cacheNameFor,
	decideFetch,
	isStaleShellCache,
	precacheUrls,
	splitPrecache
} from '$lib/sw/swPolicy';
// #427 — the part viewer's pdf.js worker is a SEPARATE static asset (Vite's
// `?url` import gives its hashed build path, same as any other asset
// import). In THIS build `build` above already names it, so naming it here
// is a belt against a Vite emit that lands it outside the manifest — and
// `precacheUrls` DEDUPES for exactly that reason (#427 review finding 1).
// What a duplicate costs depends on which half it lands in: in the required
// core it rejects the batch write and with it the install, which is the
// wedge svelte.config.js's #368 comment names; in the optional tail it only
// buys a second fetch of a 1.2 MB asset, since those failures are swallowed.
// The dedupe removes both cases. See src/lib/sw/swPolicy.part-viewer.spec.ts.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

declare let self: ServiceWorkerGlobalScope;

const CACHE_NAME = cacheNameFor(version);
const PRECACHE_URLS = precacheUrls({ build, files, extra: [pdfWorkerUrl] });
// #427 review round 3, finding 2 — which half of the list may fail without
// taking the install down with it. The rule lives in swPolicy
// (`splitPrecache`, pinned in swPolicy.part-viewer.spec.ts); this file only
// obeys it.
const { required: REQUIRED_URLS, optional: OPTIONAL_URLS } = splitPrecache(PRECACHE_URLS);

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			// The core, as one batch write: if the shell, the bootstrap or an
			// entry chunk cannot be fetched, there is no working offline app to
			// install and failing loudly is right.
			await cache.addAll(REQUIRED_URLS);
			// The heavy tail, one request each, each failure swallowed. A miss
			// here costs exactly the surface that asset serves (the part viewer
			// needs the network next time); wedging the whole install over it
			// would cost every surface, forever, on a client no later deploy can
			// reach.
			await Promise.all(OPTIONAL_URLS.map((url) => cache.add(url).catch(() => {})));
			// Atomic per-deploy dance (see module header): this worker replaces
			// whatever is currently controlling every tab as soon as it installs.
			await self.skipWaiting();
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

	// decision.kind === 'network' — same-origin GET outside the precache set.
	// Passed straight through; this worker never writes a runtime cache.
	event.respondWith(fetch(request));
});

// (*MVOX:Josquin* — #353 GREEN)
