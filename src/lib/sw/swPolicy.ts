// The service worker's decisions, pure so specs can run them without a worker scope.
export const SHELL_CACHE_PREFIX = 'mvox-shell-';

export function cacheNameFor(version: string): string {
	return `${SHELL_CACHE_PREFIX}${version}`;
}

// A cold offline start needs '/' (the fallback shell) and env.js; neither is in the build lists.
export function precacheUrls(input: { build: string[]; files: string[]; extra?: string[] }): string[] {
	return [...new Set([...input.build, ...input.files, ...(input.extra ?? []), '/', '/_app/env.js'])];
}

// A route chunk or the pdf worker serves one surface, so missing it must not fail the install.
const OPTIONAL_PRECACHE_PATTERNS: readonly RegExp[] = [
	/\/_app\/immutable\/nodes\//,
	/pdf\.worker[^/]*\.mjs$/
];

export function splitPrecache(urls: readonly string[]): {
	required: string[];
	optional: string[];
} {
	const required: string[] = [];
	const optional: string[] = [];
	for (const url of urls) {
		if (OPTIONAL_PRECACHE_PATTERNS.some((pattern) => pattern.test(url))) optional.push(url);
		else required.push(url);
	}
	return { required, optional };
}

export function isStaleShellCache(cacheName: string, currentCacheName: string): boolean {
	return cacheName.startsWith(SHELL_CACHE_PREFIX) && cacheName !== currentCacheName;
}

// A missing file answers with the HTML app shell, so HTML is never cached in place of a file.
export function servedAsExpected(path: string, contentType: string | null): boolean {
	const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
	if (/\.m?js$/.test(path)) return type === 'application/javascript' || type === 'text/javascript';
	if (path.endsWith('.css')) return type === 'text/css';
	return path === '/' || type !== 'text/html';
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

export type FetchDecision =
	| { kind: 'bypass' }
	| { kind: 'serve-shell' }
	| { kind: 'cache-first' }
	| { kind: 'network' };

const NEVER_CACHE_PATHS = new Set(['/version.json', '/_app/version.json']); // live deploy stamps

export function decideFetch(request: FetchLike, ctx: FetchDecisionContext): FetchDecision {
	if (request.method !== 'GET') return { kind: 'bypass' };

	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return { kind: 'bypass' };
	}

	if (url.origin !== ctx.origin) return { kind: 'bypass' }; // every Entu host is cross-origin
	if (NEVER_CACHE_PATHS.has(url.pathname)) return { kind: 'bypass' };

	if (request.mode === 'navigate') return { kind: 'serve-shell' };
	if (ctx.precached.includes(url.pathname)) return { kind: 'cache-first' };
	return { kind: 'network' };
}


// (*MVOX:Josquin*)
