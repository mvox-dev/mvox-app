// #350 RED — build stamp: every deployment answers at the fixed unauthenticated
// URL /version.json with the branch name and FULL commit sha it was built from,
// read from CF Pages build env (CF_PAGES_BRANCH / CF_PAGES_COMMIT_SHA).
//
// Contract (SPIKE-settled, fork (b) — prerendered +server.ts, vite.config.ts
// untouched, no fence repin):
//
//   GET /version.json → 200 application/json, EXACTLY three keys, two states:
//     CF build:  { source: 'cloudflare-pages', branch: <verbatim>, commit: <full 40-hex sha> }
//     otherwise: { source: 'not-a-cloudflare-pages-build', branch: null, commit: null }
//
//   There is NO third state and NO half-real state. The stamp claims
//   'cloudflare-pages' only when BOTH vars carry genuine-looking CF values:
//   non-empty branch AND a full 40-char lowercase-hex sha. Empty string,
//   missing var, truncated/whitespace/non-hex/uppercase sha, or only one var
//   present → the honest-absence shape. A default of 'main' or a plausible
//   fake sha would be a lie told exactly when the tool is being trusted
//   (issue #350 done-when; fail-loudly convention).
//
//   Fence: branch + sha ONLY — no env dump. Pinned here as an exact-key-set
//   assertion, with a poisoned env fixture proving extra vars cannot leak.
//
// Instrument (guard-instrument law): `buildStamp` is an exported PURE function
// taking an env-shaped record; every shape decision is pinned on it with
// inline fixtures and FULL-shape toEqual (objectContaining shipped 4 real bugs
// in this repo — never used here). The endpoint tests then pin that GET is a
// thin wrapper: reads process.env AT CALL TIME (not module-load time) and
// returns exactly the builder's output as JSON.
//
// `export const prerender = true` is load-bearing: this app is adapter-static
// + ssr=false, and the build FAILS without it — worse, a refactor that drops
// it would make the stamp silently disappear. Pinned both as a runtime export
// (=== true) and as literal source text at the fixed route path.
//
// (*MVOX:Tallis*)
//
// GREEN-phase note (*MVOX:Byrd*): `buildStamp` moved to the sibling
// `./build-stamp` module, not `./+server` — SvelteKit hard-validates every
// +server.ts export against a fixed allow-list (GET/POST/.../prerender/
// config/entries, or `_`-prefixed) and fails `vite build` unconditionally for
// any other name, prerendered or not (confirmed against
// @sveltejs/kit/src/utils/exports.js and by running the build). Import path
// only — every fixture, assertion, and pin below is unchanged.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStamp } from './build-stamp';
import { GET, prerender } from './+server';

/** A real-looking full git sha: exactly 40 lowercase hex chars. */
const FULL_SHA = '4169b0b8f2e1d3c5a7b9e0f1a2b3c4d5e6f70819';

const CF_STAMP = {
	source: 'cloudflare-pages',
	branch: 'dev',
	commit: FULL_SHA
};

const ABSENT_STAMP = {
	source: 'not-a-cloudflare-pages-build',
	branch: null,
	commit: null
};

describe('#350 buildStamp — pure stamp builder', () => {
	it('both CF vars present and well-formed → the full CF stamp shape, values verbatim', () => {
		expect(buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: FULL_SHA })).toEqual(
			CF_STAMP
		);
	});

	it('branch names with slashes survive verbatim and round-trip through JSON', () => {
		const stamp = buildStamp({
			CF_PAGES_BRANCH: 'feat/350-build-stamp',
			CF_PAGES_COMMIT_SHA: FULL_SHA
		});
		expect(stamp).toEqual({
			source: 'cloudflare-pages',
			branch: 'feat/350-build-stamp',
			commit: FULL_SHA
		});
		expect(JSON.parse(JSON.stringify(stamp))).toEqual(stamp);
	});

	it("a real CF build OF main is reported as main — only DEFAULTING to 'main' is banned", () => {
		expect(buildStamp({ CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: FULL_SHA })).toEqual({
			source: 'cloudflare-pages',
			branch: 'main',
			commit: FULL_SHA
		});
	});

	it('both vars absent → the honest-absence shape exactly (absent ≠ stale)', () => {
		const stamp = buildStamp({});
		expect(stamp).toEqual(ABSENT_STAMP);
		// Belt-and-braces pins on the lie the issue names: no 'main' default,
		// no empty-but-plausible sha, and the marker field says so plainly.
		expect(stamp.source).toBe('not-a-cloudflare-pages-build');
		expect(stamp.branch).toBeNull();
		expect(stamp.commit).toBeNull();
		expect(Object.values(stamp)).not.toContain('main');
		expect(Object.values(stamp)).not.toContain('');
	});

	it('undefined values behave identically to missing keys', () => {
		expect(
			buildStamp({ CF_PAGES_BRANCH: undefined, CF_PAGES_COMMIT_SHA: undefined })
		).toEqual(ABSENT_STAMP);
	});

	describe('mixed / half-real inputs are NOT a valid CF stamp (never half-real)', () => {
		it('branch present, sha missing → honest absence', () => {
			expect(buildStamp({ CF_PAGES_BRANCH: 'dev' })).toEqual(ABSENT_STAMP);
		});

		it('sha present, branch missing → honest absence', () => {
			expect(buildStamp({ CF_PAGES_COMMIT_SHA: FULL_SHA })).toEqual(ABSENT_STAMP);
		});

		it('empty-string branch is absence, not a branch (empty string ≠ set)', () => {
			expect(buildStamp({ CF_PAGES_BRANCH: '', CF_PAGES_COMMIT_SHA: FULL_SHA })).toEqual(
				ABSENT_STAMP
			);
		});

		it('empty-string sha is absence, not a sha', () => {
			expect(buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: '' })).toEqual(
				ABSENT_STAMP
			);
		});
	});

	describe('sha validation — full 40-hex only, nothing non-canonical accepted as a CF value', () => {
		it('a truncated (short) sha is NOT silently accepted', () => {
			expect(buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: '4169b0b' })).toEqual(
				ABSENT_STAMP
			);
		});

		it('a 39-char sha (one short of full) is rejected', () => {
			expect(
				buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: FULL_SHA.slice(0, 39) })
			).toEqual(ABSENT_STAMP);
		});

		it('a 41-char value is rejected', () => {
			expect(
				buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: FULL_SHA + 'a' })
			).toEqual(ABSENT_STAMP);
		});

		it('whitespace-padded sha is rejected, not trimmed into plausibility', () => {
			expect(
				buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: ` ${FULL_SHA} ` })
			).toEqual(ABSENT_STAMP);
		});

		it('embedded newline is rejected', () => {
			expect(
				buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: `${FULL_SHA}\n` })
			).toEqual(ABSENT_STAMP);
		});

		it('40 chars of non-hex is rejected', () => {
			expect(
				buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: 'z'.repeat(40) })
			).toEqual(ABSENT_STAMP);
		});

		it('uppercase hex is rejected — git shas are lowercase; anything else is not a git sha', () => {
			expect(
				buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: FULL_SHA.toUpperCase() })
			).toEqual(ABSENT_STAMP);
		});
	});

	describe('no-env-dump fence', () => {
		it('output carries EXACTLY the three contracted keys in the present case', () => {
			const stamp = buildStamp({ CF_PAGES_BRANCH: 'dev', CF_PAGES_COMMIT_SHA: FULL_SHA });
			expect(Object.keys(stamp).sort()).toEqual(['branch', 'commit', 'source']);
		});

		it('output carries EXACTLY the three contracted keys in the absent case', () => {
			expect(Object.keys(buildStamp({})).sort()).toEqual(['branch', 'commit', 'source']);
		});

		it('unrelated env vars in the input record never leak into the stamp', () => {
			const poisoned = {
				CF_PAGES_BRANCH: 'dev',
				CF_PAGES_COMMIT_SHA: FULL_SHA,
				CF_PAGES_URL: 'https://deadbeef.multivox.pages.dev',
				NODE_ENV: 'production',
				SECRET_TOKEN: 'leak-canary-do-not-emit'
			};
			const stamp = buildStamp(poisoned);
			expect(stamp).toEqual(CF_STAMP);
			expect(JSON.stringify(stamp)).not.toContain('leak-canary-do-not-emit');
			expect(JSON.stringify(stamp)).not.toContain('pages.dev');
		});
	});
});

describe('#350 /version.json endpoint module', () => {
	// GET takes no meaningful event input; loosen the call signature so these
	// tests pin behavior, not SvelteKit's RequestEvent plumbing.
	const get = GET as unknown as () => Response | Promise<Response>;

	const ENV_KEYS = ['CF_PAGES_BRANCH', 'CF_PAGES_COMMIT_SHA'] as const;
	let saved: Record<string, string | undefined>;

	// Explicit save/delete/restore — NOT ambient absence: a developer with
	// CF_PAGES_BRANCH exported in their shell must not be able to flip this
	// suite in either direction.
	beforeEach(() => {
		saved = {};
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	it('exports prerender === true — adapter-static breaks the build without it; pin it so a refactor cannot drop it silently', () => {
		expect(prerender).toBe(true);
	});

	it('the +server.ts at the FIXED route path src/routes/version.json/ carries the prerender export as literal source', () => {
		// Route dir = URL path in SvelteKit: this read fails loudly if anyone
		// moves the endpoint away from the contracted unauthenticated URL.
		const source = readFileSync(
			resolve(process.cwd(), 'src', 'routes', 'version.json', '+server.ts'),
			'utf-8'
		);
		expect(source).toContain('export const prerender = true');
	});

	it('GET in a CF Pages build env returns the full stamp as application/json', async () => {
		process.env.CF_PAGES_BRANCH = 'dev';
		process.env.CF_PAGES_COMMIT_SHA = FULL_SHA;

		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/^application\/json\b/);
		const body = await res.json();
		expect(body).toEqual(CF_STAMP);
		expect(Object.keys(body).sort()).toEqual(['branch', 'commit', 'source']);
	});

	it('GET outside a CF build returns the honest-absence stamp as application/json', async () => {
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/^application\/json\b/);
		expect(await res.json()).toEqual(ABSENT_STAMP);
	});

	it('GET preserves a slashed branch name through the JSON response verbatim', async () => {
		process.env.CF_PAGES_BRANCH = 'feat/350-build-stamp';
		process.env.CF_PAGES_COMMIT_SHA = FULL_SHA;

		const body = await (await get()).json();
		expect(body).toEqual({
			source: 'cloudflare-pages',
			branch: 'feat/350-build-stamp',
			commit: FULL_SHA
		});
	});

	it('GET reads process.env at CALL time, not module-load time — two calls, two envs, two answers', async () => {
		const first = await (await get()).json();
		expect(first).toEqual(ABSENT_STAMP);

		process.env.CF_PAGES_BRANCH = 'dev';
		process.env.CF_PAGES_COMMIT_SHA = FULL_SHA;

		const second = await (await get()).json();
		expect(second).toEqual(CF_STAMP);
	});

	it('GET never emits a half-real stamp when only one var is set', async () => {
		process.env.CF_PAGES_BRANCH = 'dev';
		// CF_PAGES_COMMIT_SHA deliberately left deleted.
		expect(await (await get()).json()).toEqual(ABSENT_STAMP);
	});
});
