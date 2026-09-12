// #318 RED — slice fences: what this slice must NOT change, pinned where
// cheap (guard-spec precedent: byte pins with repin instructions).
//
// The slice is green-field under workers/entu-rights-mcp/ only. The doc stays
// the single home of every rule; the guard spec stays the doc's one mechanical
// guard; the static app (src/, svelte.config.js, vite.config.ts) is untouched;
// package.json gains AT MOST a scripts entry for the generator — no runtime
// dependencies, no @modelcontextprotocol/sdk, no wrangler devDep, no
// @cloudflare/* (tests are pure node; activation is PO-gated and happens
// outside this pipeline).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const sha256 = (path: string): string =>
	createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');

describe('the doc and its guard spec are byte-identical to HEAD — this slice reads them, never edits them', () => {
	it('docs/architecture/entu-rights-and-visibility-model.md is unchanged', () => {
		expect(
			sha256('docs/architecture/entu-rights-and-visibility-model.md'),
			'#318 builds a VIEW over the doc; a doc edit belongs to its own commissioned slice. Repin only behind a PO-ruled doc edit (sha256 of the file at the sanctioned state).'
		).toBe('df3ffdb3492f20b61d0e06cd118c1600188f78fb9191a5fa760cfda1cce69b97');
	});

	it('src/rights-model-identifiers.spec.ts (the guard spec) is unchanged', () => {
		expect(
			sha256('src/rights-model-identifiers.spec.ts'),
			'the guard spec is the doc\'s one mechanical guard and #318 must not touch it — the parser here is a second CONSUMER of its grammar, never an edit to it. Repin only from a slice whose mandate names that file.'
		).toBe('f6b6c047a564467895e2d3f4bdd6dedc4b896cf3c51ff7b886c870972248f55a');
	});
});

describe('the static app is untouched', () => {
	it('svelte.config.js is unchanged', () => {
		expect(sha256('svelte.config.js')).toBe(
			'3a07fbeab3aeb4cfc9fad08947d284401a5d92844bb5498138107409e6da1488'
		);
	});

	it('vite.config.ts is unchanged (vitest.config.ts is NOT pinned — its include glob legitimately grows workers/**)', () => {
		expect(sha256('vite.config.ts')).toBe(
			'ce5b914782f6d14f58f031bcac087cffb597b64c8e37fdbbb3497290682f2a09'
		);
	});
});

describe('package.json: at most a generator scripts entry', () => {
	const pkg = () =>
		JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
			dependencies?: Record<string, string>;
			devDependencies: Record<string, string>;
			scripts: Record<string, string>;
		};

	const BASELINE_SCRIPTS = [
		'dev',
		'build',
		'preview',
		'prepare',
		'check',
		'test',
		'test:watch',
		'migrate:t4-10:dry',
		'migrate:t4-10:live',
		'migrate:t3-1:dry',
		'migrate:t3-1:live',
		'migrate:t3-1-bundle3:dry',
		'migrate:t3-1-bundle3:live',
		'migrate:widen-member-refs:dry',
		'migrate:widen-member-refs:live',
		'roadmap:fetch',
		'roadmap:render'
	];

	const BASELINE_DEV_DEPS = [
		'@inlang/paraglide-js',
		'@sveltejs/adapter-static',
		'@sveltejs/kit',
		'@sveltejs/vite-plugin-svelte',
		'@tailwindcss/vite',
		'@testing-library/svelte',
		'@types/node',
		// #343 repin — fake-indexeddb PO-approved on the issue (comment
		// IC_kwDOTubdKM8AAAABUHJaew): a test-environment shim for a browser
		// API node lacks, the exact happy-dom precedent. `dependencies`
		// staying ABSENT is the line this fence actually guards (above).
		'fake-indexeddb',
		'happy-dom',
		'svelte',
		'svelte-check',
		'tailwindcss',
		'tsx',
		'typescript',
		'vite',
		'vitest',
		'yaml'
	];

	it('no runtime dependencies — the field stays absent', () => {
		expect(pkg().dependencies).toBeUndefined();
	});

	it('devDependencies are exactly the pre-slice set — no @modelcontextprotocol/sdk, no wrangler, no @cloudflare/*, nothing new', () => {
		expect(Object.keys(pkg().devDependencies).sort()).toEqual([...BASELINE_DEV_DEPS].sort());
	});

	it('no wrangler / MCP-SDK / cloudflare-tooling reference anywhere in package.json', () => {
		const raw = readFileSync(resolve(ROOT, 'package.json'), 'utf-8');
		for (const forbidden of ['wrangler', '@modelcontextprotocol', '@cloudflare']) {
			expect(raw.includes(forbidden), `package.json mentions ${forbidden} — out of this slice's mandate`).toBe(false);
		}
	});

	// REVIEW fix round (findings comment 5642106513) widens this fence: the
	// gate finding (#3) needs a second script, `check:workers`, chained into
	// `check` — still zero runtime/dev dependencies (asserted above).
	it('every baseline script survives unchanged in name, and additions are exactly the bundle generator + the workers typecheck gate', () => {
		const keys = Object.keys(pkg().scripts);
		for (const k of BASELINE_SCRIPTS) {
			expect(keys, `baseline script "${k}" was removed or renamed`).toContain(k);
		}
		const added = keys.filter((k) => !BASELINE_SCRIPTS.includes(k));
		expect(added.sort(), `added scripts: ${added.join(', ')}`).toEqual(['check:workers', 'mcp:bundle']);
	});
});

describe('the generated bundle is GITIGNORED — a committed copy would be the independent rule store #318 forbids', () => {
	it('.gitignore covers workers/entu-rights-mcp/generated/', () => {
		const gitignore = readFileSync(resolve(ROOT, '.gitignore'), 'utf-8');
		expect(
			gitignore.includes('workers/entu-rights-mcp/generated'),
			'.gitignore has no entry for workers/entu-rights-mcp/generated/ — the emitted rules bundle must never be committable; the doc is the only home a rule has'
		).toBe(true);
	});
});
