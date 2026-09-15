// #353 RED — the service worker's DECISION CORE, as a pure exported module
// (guard-instrument law: the routing/decision logic the SW runs on is an
// exported pure function pinned with inline fixtures — never asserted by
// poking a real ServiceWorkerGlobalScope, which no test environment here has).
//
// SPIKE facts this spec rests on (spike-353, on-branch experiments, reverted):
//   - SvelteKit's src/service-worker.ts auto-registers under adapter-static +
//     ssr=false; $service-worker exports build/files/prerendered/version.
//   - FOUR files are in NO $service-worker array; two of them the shell needs
//     ('/', '/_app/env.js' — the bootstrap imports env.js UNCONDITIONALLY
//     before kit.start, so a cold offline start dies without it) and two must
//     NEVER be cached ('/version.json' — the #350 stamp, the deploy-evidence
//     instrument; '/_app/version.json' — kit's own update poller, whose
//     freshness is what makes the skipWaiting recovery dance work at all).
//   - Every Entu API response is cross-origin (the Entu API host + the
//     signed bytes bucket), so `origin !== self.location.origin` is the natural
//     hard fence — but it is pinned here explicitly per URL family, because
//     the issue's fence is about ENTU API RESPONSES, not about origins.
//   - The activate cleanup must be PREFIX-SCOPED: the spike's own throwaway
//     SW deleted every cache on the origin — that bug is fenced below.
//
// The module under test: src/lib/sw/swPolicy.ts (lives under $lib so it IS
// type-checked — the spike proved src/service-worker.ts itself is excluded
// from svelte-check by the generated tsconfig; see the check:sw pin below).
//
// DECISION SHAPE (full-shape toEqual everywhere — objectContaining hid four
// real bugs once, see partial-assertions memory):
//   { kind: 'bypass' }       — do NOT respondWith: browser hits the network
//                              directly; nothing read from or written to any
//                              cache. Cross-origin (ALL Entu API + bucket
//                              traffic), non-GET, and the two version stamps.
//   { kind: 'serve-shell' }  — respondWith(cache.match('/')): a navigation.
//                              REQUIRED offline: a cold navigation to
//                              /downloads has nothing precached under that
//                              URL — without this branch every deep link
//                              fails with no network.
//   { kind: 'cache-first' }  — respondWith(cache.match(request) else fetch):
//                              a precached shell asset.
//   { kind: 'network' }      — respondWith(fetch(request)): same-origin GET
//                              outside the precache set. NEVER cached — the
//                              install-time precache is the ONLY cache write
//                              the SW ever performs (no runtime caching; that
//                              is what makes the Entu fence impossible to
//                              erode later).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	SHELL_CACHE_PREFIX,
	cacheNameFor,
	decideFetch,
	isStaleShellCache,
	precacheUrls
} from './swPolicy';

const ORIGIN = 'https://mvox.eu';
const PRECACHED = [
	'/_app/immutable/entry/start.abc123.js',
	'/_app/immutable/assets/0.def456.css',
	'/robots.txt',
	'/',
	'/_app/env.js'
] as const;

/** GET, non-navigate, same shape the fetch handler sees. */
function get(url: string, mode = 'no-cors') {
	return { url, method: 'GET', mode };
}

const CTX = { origin: ORIGIN, precached: PRECACHED };

describe('#353 — cache name derives from $service-worker version', () => {
	it('is the prefix plus the version, verbatim', () => {
		expect(cacheNameFor('1789441272586')).toBe(`${SHELL_CACHE_PREFIX}1789441272586`);
	});

	it('two versions → two distinct cache names (the atomic per-deploy cache)', () => {
		const a = cacheNameFor('1789441272586');
		const b = cacheNameFor('1789449999999');
		expect(a).not.toBe(b);
		expect(a.startsWith(SHELL_CACHE_PREFIX)).toBe(true);
		expect(b.startsWith(SHELL_CACHE_PREFIX)).toBe(true);
	});

	it('the prefix is the app-owned mvox-shell- namespace', () => {
		expect(SHELL_CACHE_PREFIX).toBe('mvox-shell-');
	});
});

describe('#353 — install precache list (the spike 1a gap: build+files miss the shell)', () => {
	it('is exactly build + files + the two files no $service-worker array names', () => {
		const build = ['/_app/immutable/entry/start.abc123.js', '/_app/immutable/nodes/0.js'];
		const files = ['/robots.txt'];
		// FULL-SHAPE: '/' (the adapter-static fallback shell — nothing in
		// $service-worker names it) and '/_app/env.js' (build/index.html's
		// bootstrap imports it unconditionally BEFORE kit.start — not cached
		// means a cold offline start dies before any app code runs).
		expect(precacheUrls({ build, files })).toEqual([...build, ...files, '/', '/_app/env.js']);
	});

	it('never includes the #350 stamp or kit\'s update poller, whatever the inputs', () => {
		const urls = precacheUrls({
			build: ['/_app/immutable/entry/app.js'],
			files: ['/robots.txt']
		});
		expect(urls).not.toContain('/version.json');
		expect(urls).not.toContain('/_app/version.json');
	});
});

describe('#353 — the HARD FENCE: Entu API URLs are NEVER cached or served from cache', () => {
	// Real URL FAMILIES from the tree, on the house test host (#163 C6: no
	// spec pins the production Entu host literal): entuFetch builds
	// `${ENTU_API_BASE}${db}/${path}` (src/lib/entu/request.ts, base from
	// src/lib/entu-config.ts), and edition BYTES come from a signed
	// DigitalOcean Spaces URL (src/lib/repertoire/fileUrls.ts). Every one of
	// them is CROSS-ORIGIN to the app origin — which is exactly what the
	// decision function keys on, so the fence pinned here holds for the
	// production host by the same rule.
	const ENTU_URLS = [
		'https://api.entu-test.invalid/polyphony/entity/68000000000000000000abcd',
		'https://api.entu-test.invalid/polyphony/entity?_type.string=work&props=name&limit=500',
		'https://api.entu-test.invalid/polyphony/property/68000000000000000000ffff',
		'https://api.entu-test.invalid/auth?account=polyphony',
		'https://entu-files.fra1.digitaloceanspaces.com/polyphony/file.pdf?X-Amz-Signature=deadbeef'
	];

	it.each(ENTU_URLS)('bypasses (no cache read, no cache write): %s', (url) => {
		// FULL-SHAPE toEqual: the decision carries NO cache instruction of any
		// kind — not 'cache-first', not 'serve-shell', not a store flag.
		expect(decideFetch(get(url), CTX)).toEqual({ kind: 'bypass' });
	});

	it('bypasses an Entu API navigation too — a cross-origin navigate is not our shell', () => {
		expect(
			decideFetch(
				{ url: 'https://api.entu-test.invalid/auth/google', method: 'GET', mode: 'navigate' },
				CTX
			)
		).toEqual({
			kind: 'bypass'
		});
	});
});

describe('#353 — the fetch decision, remaining branches', () => {
	it('bypasses non-GET requests', () => {
		expect(
			decideFetch({ url: `${ORIGIN}/anything`, method: 'POST', mode: 'cors' }, CTX)
		).toEqual({ kind: 'bypass' });
	});

	it('bypasses /version.json — the #350 stamp stays deploy evidence, never frozen in a cache', () => {
		expect(decideFetch(get(`${ORIGIN}/version.json`), CTX)).toEqual({ kind: 'bypass' });
	});

	it("bypasses /_app/version.json — kit's update detection must see the network", () => {
		expect(decideFetch(get(`${ORIGIN}/_app/version.json`), CTX)).toEqual({ kind: 'bypass' });
	});

	it('serves a same-origin navigation from the cached shell — the cold offline deep link to /downloads', () => {
		expect(
			decideFetch({ url: `${ORIGIN}/downloads`, method: 'GET', mode: 'navigate' }, CTX)
		).toEqual({ kind: 'serve-shell' });
	});

	it('serves a precached asset cache-first — the offline shell boot path', () => {
		expect(decideFetch(get(`${ORIGIN}/_app/immutable/entry/start.abc123.js`), CTX)).toEqual({
			kind: 'cache-first'
		});
		expect(decideFetch(get(`${ORIGIN}/_app/env.js`), CTX)).toEqual({ kind: 'cache-first' });
	});

	it('passes a same-origin GET outside the precache set to the network — and NOTHING routes it to a cache', () => {
		expect(decideFetch(get(`${ORIGIN}/some/uncached/thing`), CTX)).toEqual({ kind: 'network' });
	});
});

describe('#353 — activate cleanup is PREFIX-SCOPED (the spike\'s own blanket-delete bug, fenced)', () => {
	const current = cacheNameFor('1789449999999');

	it('claims a stale mvox shell cache', () => {
		expect(isStaleShellCache(cacheNameFor('1789441272586'), current)).toBe(true);
	});

	it('never claims the current cache', () => {
		expect(isStaleShellCache(current, current)).toBe(false);
	});

	it('never claims a cache outside the mvox-shell- namespace — a blanket caches.keys() delete would nuke any other cache on the origin', () => {
		expect(isStaleShellCache('workbox-precache-v2', current)).toBe(false);
		expect(isStaleShellCache('some-other-feature-cache', current)).toBe(false);
	});
});

describe('#353 — src/service-worker.ts wires the tested policy (integration: the deployed SW runs THIS decision function)', () => {
	const swPath = resolve(process.cwd(), 'src/service-worker.ts');

	it('exists', () => {
		expect(existsSync(swPath)).toBe(true);
	});

	it('derives its cache from $service-worker version through the policy module', () => {
		const source = readFileSync(swPath, 'utf-8');
		expect(source).toMatch(/from ['"]\$service-worker['"]/);
		expect(source).toContain('version');
		// The pure core is IMPORTED, not re-implemented inline — otherwise the
		// pins above hold a function the worker never runs.
		expect(source).toMatch(/from ['"](\$lib|\.\/lib)\/sw\/swPolicy['"]/);
		for (const name of ['cacheNameFor', 'decideFetch', 'precacheUrls', 'isStaleShellCache']) {
			expect(source, `service-worker.ts must use ${name}`).toContain(name);
		}
	});

	it('never touches $service-worker\'s `prerendered` — the 1c trap that would freeze the #350 stamp', () => {
		const source = readFileSync(swPath, 'utf-8');
		expect(source).not.toMatch(/prerendered/);
	});

	it('takes the skipWaiting + clients.claim update dance (spike 1d: the parked-tab pin is the failure the issue names)', () => {
		const source = readFileSync(swPath, 'utf-8');
		expect(source).toContain('skipWaiting');
		expect(source).toContain('clients.claim');
	});
});

describe('#353 — the SW is type-checked (spike 1f: svelte-check EXCLUDES src/service-worker.ts; a deliberate type error gave 0 ERRORS)', () => {
	it('package.json carries a check:sw script, chained into check — the check:workers precedent', () => {
		const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
			scripts?: Record<string, string>;
		};
		expect(pkg.scripts?.['check:sw'], 'scripts["check:sw"] missing').toBeTruthy();
		expect(pkg.scripts?.['check'], 'check must chain check:sw').toContain('check:sw');
	});
});

// (*MVOX:Tallis* — #353 RED)
