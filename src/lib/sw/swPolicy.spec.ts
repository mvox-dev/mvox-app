// The service worker's decision core (swPolicy.ts), pinned as pure calls with inline fixtures.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
		// '/' and '/_app/env.js' are in no $service-worker array; a cold offline start needs both.
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
	// Every Entu API and bytes-bucket URL is cross-origin to the app; the fence keys on that.
	const ENTU_URLS = [
		'https://api.entu-test.invalid/sampledb/entity/68000000000000000000abcd',
		'https://api.entu-test.invalid/sampledb/entity?_type.string=work&props=name&limit=500',
		'https://api.entu-test.invalid/sampledb/property/68000000000000000000ffff',
		'https://api.entu-test.invalid/auth?account=sampledb',
		'https://entu-files.fra1.digitaloceanspaces.com/sampledb/file.pdf?X-Amz-Signature=deadbeef'
	];

	it.each(ENTU_URLS)('bypasses (no cache read, no cache write): %s', (url) => {
		// The decision carries no cache instruction of any kind.
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
