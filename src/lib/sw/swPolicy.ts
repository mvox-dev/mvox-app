// #353 — the service worker's DECISION CORE, as a pure exported module.
//
// Lives under $lib (not src/service-worker.ts itself) so it is type-checked by
// the normal app tsconfig and pinnable with inline-fixture unit tests — a
// ServiceWorkerGlobalScope is not something any test environment here has.
// src/service-worker.ts imports every export below and runs it verbatim; see
// its own header comment for the install/activate wiring.
//
// THE HARD FENCE (issue #353): Entu API responses are NEVER cached or served
// from a cache. Every Entu API host and the signed-bytes bucket are
// cross-origin to the app, so `origin !== self.location.origin` is the
// natural test — checked structurally (a URL-scope comparison), not as a
// per-endpoint blacklist, so it cannot erode one route at a time later.
//
// Two same-origin paths are ALSO never cached even though they pass the
// origin check: '/version.json' (the #350 build stamp — deploy evidence that
// must always answer live) and '/_app/version.json' (SvelteKit's own update
// poller — caching it would freeze the signal the skipWaiting recovery dance
// depends on).
export const SHELL_CACHE_PREFIX = 'mvox-shell-';

/** One cache per deploy: the app's own `config.kit.version` names it. */
export function cacheNameFor(version: string): string {
	return `${SHELL_CACHE_PREFIX}${version}`;
}

/**
 * `$service-worker`'s `build` + `files` name every hashed asset the compiler
 * produced, but NOT the two extra urls a cold offline start needs: '/' (the
 * adapter-static fallback shell — nothing in either array names it) and
 * '/_app/env.js' (the bootstrap imports it unconditionally before
 * `kit.start`, so a cold offline navigation dies before any app code runs
 * without it precached).
 *
 * `extra` (#427) — optional caller-named assets that `build`/`files` cannot
 * be trusted to include, e.g. the part viewer's pdf.js worker (a
 * `?url`-imported build artefact, not something `$service-worker` names).
 * Slotted BETWEEN `files` and the two hand-added urls: existing callers pass
 * nothing and get exactly the old list back.
 */
export function precacheUrls(input: { build: string[]; files: string[]; extra?: string[] }): string[] {
	return [...input.build, ...input.files, ...(input.extra ?? []), '/', '/_app/env.js'];
}

/**
 * The activate-time cleanup must only ever claim a cache THIS module wrote —
 * a blanket `caches.keys()` delete would nuke any other cache the origin
 * holds for an unrelated reason. `cacheName` outside the `mvox-shell-`
 * namespace, or equal to the current cache, is never stale.
 */
export function isStaleShellCache(cacheName: string, currentCacheName: string): boolean {
	return cacheName.startsWith(SHELL_CACHE_PREFIX) && cacheName !== currentCacheName;
}

export interface FetchLike {
	url: string;
	method: string;
	mode: string;
}

export interface FetchDecisionContext {
	origin: string;
	precached: readonly string[];
}

/**
 * The four outcomes a fetch handler can act on:
 *   - 'bypass'      — do NOT respondWith: the browser hits the network
 *                      directly, nothing read from or written to any cache.
 *   - 'serve-shell' — respondWith(cache.match('/')): a navigation, served
 *                      from the precached shell so a cold offline deep link
 *                      (e.g. /downloads) still resolves.
 *   - 'cache-first' — respondWith(cache.match(request) ?? fetch(request)): a
 *                      precached shell asset.
 *   - 'network'     — respondWith(fetch(request)): a same-origin GET outside
 *                      the precache set. NEVER cached — install-time precache
 *                      is the only cache write this module's caller performs.
 */
export type FetchDecision =
	| { kind: 'bypass' }
	| { kind: 'serve-shell' }
	| { kind: 'cache-first' }
	| { kind: 'network' };

const NEVER_CACHE_PATHS = new Set(['/version.json', '/_app/version.json']);

export function decideFetch(request: FetchLike, ctx: FetchDecisionContext): FetchDecision {
	if (request.method !== 'GET') return { kind: 'bypass' };

	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return { kind: 'bypass' };
	}

	// Cross-origin FIRST: a cross-origin navigation (e.g. an OAuth redirect) is
	// not our shell either, and every Entu API / bucket URL is cross-origin —
	// this one comparison is the structural form of the hard fence.
	if (url.origin !== ctx.origin) return { kind: 'bypass' };
	if (NEVER_CACHE_PATHS.has(url.pathname)) return { kind: 'bypass' };

	if (request.mode === 'navigate') return { kind: 'serve-shell' };
	if (ctx.precached.includes(url.pathname)) return { kind: 'cache-first' };
	return { kind: 'network' };
}

// (*MVOX:Josquin* — #353 GREEN)
