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
	// #369 repin (PO-approved 2026-09-15, Gama; recorded on #369) — BOTH pins move
	// once, together, and this is the commissioned doc-edit slice the original
	// repin instruction points at. The edit: ER-26 and its §7.5 home (a reference
	// carries the referenced person's name and email in its own `.string`, whatever
	// `props` asked for), plus the guard spec's own maintenance for it — the
	// numbering sweep learns the third id-state (RESERVED: ER-24/ER-25 held by
	// #364) and the doc-remainder pin re-derives. Precedent for moving a byte pin
	// this way rather than loosening it: #322 and #330, both recorded inside the
	// guard spec's own pin comments. These pins prove no drift SINCE this edit,
	// never that the edit was right.
	//
	// #372 repin (PO-approved 2026-09-15, Gama; ruling recorded on #372) — both
	// move together again for ER-27 and its §7.6 home (creating a child under a
	// parent is governed by `_editor` on that parent). Same caveat.
	//
	// #411 repin (PO ruling, Gama 2026-09-18; Mihkel released the issue and
	// widened the docs carve-out) — both move together again, and this one edits
	// NO rule: the "What this changes" SUPERSEDED marker claimed ~15 person
	// prop-defs still sat at `domain`, true when written 2026-08-06 and false
	// since #181 flipped them on 2026-08-27. The guard spec moves with it only
	// because its doc-remainder pin re-derives. A fence that preserves a stale
	// privacy claim about a live-pilot database is holding the wrong thing still;
	// the claim reached a reader as a real exposure before the dates were checked.
	// Same caveat: these pins prove no drift SINCE this edit, never that the edit
	// was right.
	it('docs/architecture/entu-rights-and-visibility-model.md is unchanged', () => {
		expect(
			sha256('docs/architecture/entu-rights-and-visibility-model.md'),
			'#318 builds a VIEW over the doc; a doc edit belongs to its own commissioned slice. Repin only behind a PO-ruled doc edit (sha256 of the file at the sanctioned state).'
		).toBe('abf007d4e59dd68fe9b8aa9d413055666f10d238de76f5408a6c779f49e31cc9');
	});

	// #397 repin (Mihkel-ruled 2026-09-18, closing #364) — the guard spec's
	// RESERVED table stops citing #364: ER-24/25 retired, never minting, their
	// numbers permanently empty so no citation ever repoints. Same caveat as
	// #369/#372 above: this pin proves no drift SINCE that edit, never that the
	// edit was right.
	it('src/rights-model-identifiers.spec.ts (the guard spec) is unchanged', () => {
		expect(
			sha256('src/rights-model-identifiers.spec.ts'),
			'the guard spec is the doc\'s one mechanical guard and #318 must not touch it — the parser here is a second CONSUMER of its grammar, never an edit to it. Repin only from a slice whose mandate names that file.'
		).toBe('7b857533cc3076ebd0d33b011d5817e2b1953c15f51d2af4d698d376c2bca72a');
	});
});

describe('the static app is untouched', () => {
	it('svelte.config.js is unchanged', () => {
		// Repinned for #368 (kit.serviceWorker.files — excluding the CF Pages
		// config files from the service worker's install-time precache, which
		// otherwise takes the whole install down when CF declines to serve a path
		// it only consumes as deploy config). Same reasoning as the vite.config.ts
		// repin below and the #322 ER-pin precedent: this pin's job is catching
		// ACCIDENTAL drift from workers/entu-rights-mcp/, and refreshing it on a
		// sanctioned change outside that scope is the pin working as designed. The
		// change itself is pinned on its own terms in src/lib/sw/swUpdate.spec.ts.
		expect(sha256('svelte.config.js')).toBe(
			'f9224c961ef6d940b1ab5524e2aa78871019fa7a60fa9594f0fe25cf9699eece'
		);
	});

	it('vite.config.ts is unchanged (vitest.config.ts is NOT pinned — its include glob legitimately grows workers/**)', () => {
		// Repinned for #347 (dev port 3000 + strictPort — a sanctioned,
		// commissioned change to vite.config.ts, not this slice's work): the
		// pin's job is catching ACCIDENTAL drift from workers/entu-rights-mcp/,
		// and refreshing it on a sanctioned change outside that scope is the
		// pin working as designed (#322 ER-pin precedent).
		expect(sha256('vite.config.ts')).toBe(
			'bf74d50dd99763fcb8335c43f3d38f07fabc638955655411496e0b6ef5aac363'
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

	// Repinned for #427 (pdfjs-dist — the fullscreen part viewer's PDF
	// renderer, a sanctioned, commissioned change to the STATIC APP, not this
	// slice's work): this pin's job is catching this slice's OWN scripts
	// entry from growing MCP-SDK/wrangler/cloudflare runtime deps alongside
	// it (guarded explicitly, by name, in the very next test), not
	// forbidding the app from ever gaining a legitimate dependency —
	// refreshing it on a sanctioned change outside this slice's scope is the
	// pin working as designed (#322 ER-pin / svelte.config.js precedent
	// above).
	it('runtime dependencies are exactly the pre-slice-plus-#427 set — no @modelcontextprotocol/sdk, no wrangler, no @cloudflare/*', () => {
		expect(pkg().dependencies).toEqual({ 'pdfjs-dist': '^6.3.289' });
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
	// #353 widens this fence again: `check:sw` type-checks src/service-worker.ts
	// on its own tsconfig (svelte-check's generated tsconfig excludes that file
	// by name — see tsconfig.sw.json's own comment), chained into `check` the
	// same way `check:workers` is. Unrelated to this slice's own mandate, but
	// this fence's job is catching ACCIDENTAL script drift FROM
	// workers/entu-rights-mcp/ — a sanctioned, commissioned addition elsewhere
	// is the pin working as designed (#322 ER-pin precedent, same as the
	// vite.config.ts repin above for #347).
	// #413 widens it once more: `test:roadmap` runs the roadmap's own tests,
	// which is what .github/workflows/roadmap.yml gates the board deploy on
	// now — it ran the whole suite before, so a prompt-template fence held the
	// public page stale for ten hours (2026-09-19). Commissioned by Mihkel;
	// still zero runtime/dev dependencies, still nothing from this slice.
	it('every baseline script survives unchanged in name, and additions are exactly the bundle generator + the workers typecheck gate + the service-worker typecheck gate + the roadmap deploy gate', () => {
		const keys = Object.keys(pkg().scripts);
		for (const k of BASELINE_SCRIPTS) {
			expect(keys, `baseline script "${k}" was removed or renamed`).toContain(k);
		}
		const added = keys.filter((k) => !BASELINE_SCRIPTS.includes(k));
		expect(added.sort(), `added scripts: ${added.join(', ')}`).toEqual([
			'check:sw',
			'check:workers',
			'mcp:bundle',
			'test:roadmap'
		]);
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
