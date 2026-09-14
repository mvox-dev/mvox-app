// #350 — pure build-stamp builder.
//
// Deliberately NOT named `+server.ts`: SvelteKit's build hard-validates every
// `+server.ts` module's export list against a fixed allow-list (GET, POST,
// PATCH, PUT, DELETE, OPTIONS, HEAD, fallback, prerender, trailingSlash,
// config, entries, or anything with a `_` prefix — see
// @sveltejs/kit/src/utils/exports.js, `validate_server_exports`) and throws a
// hard build error for any other named export, unconditionally, regardless of
// `prerender`. A plain `buildStamp` export cannot live on the literal route
// file without breaking `vite build` — confirmed by running it. This sibling
// module carries the pure logic; `./+server.ts` imports it internally and
// exposes only the SvelteKit-legal surface.
const FULL_SHA_RE = /^[0-9a-f]{40}$/;

export interface BuildStampEnv {
	CF_PAGES_BRANCH?: string;
	CF_PAGES_COMMIT_SHA?: string;
}

export type BuildStamp =
	| { source: 'cloudflare-pages'; branch: string; commit: string }
	| { source: 'not-a-cloudflare-pages-build'; branch: null; commit: null };

const ABSENT_STAMP: BuildStamp = {
	source: 'not-a-cloudflare-pages-build',
	branch: null,
	commit: null
};

/**
 * Both CF vars must be present and well-formed (non-empty branch, full
 * 40-char lowercase-hex sha) to report a genuine CF stamp. Any other shape —
 * missing, empty, truncated, padded, uppercase, non-hex — resolves to the
 * honest-absence shape. Never half-real.
 */
export function buildStamp(env: BuildStampEnv): BuildStamp {
	const branch = env.CF_PAGES_BRANCH;
	const commit = env.CF_PAGES_COMMIT_SHA;

	if (!branch || !commit || !FULL_SHA_RE.test(commit)) {
		return ABSENT_STAMP;
	}

	return { source: 'cloudflare-pages', branch, commit };
}
