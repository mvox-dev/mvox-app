// #318 fences: what the MCP slice must not change. Byte pins move only behind a
// sanctioned change elsewhere, named next to the pin.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const sha256 = (path: string): string =>
	createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');

describe('the doc and its guard spec are byte-identical to HEAD — this slice reads them, never edits them', () => {
	// Repinned for #369, #372, #411, #422 and #704 (PO-ruled doc edits). A pin proves no
	// drift since that edit, never that the edit was right.
	it('docs/architecture/entu-rights-and-visibility-model.md is unchanged', () => {
		expect(
			sha256('docs/architecture/entu-rights-and-visibility-model.md'),
			'#318 builds a VIEW over the doc; a doc edit belongs to its own commissioned slice. Repin only behind a PO-ruled doc edit (sha256 of the file at the sanctioned state).'
		).toBe('1e0cb9d35faeb2b84df8c27e47999adef76897e142d27be2626194a5126778cf');
	});

	// Repinned for #422, #397 and #704, with the doc above.
	it('src/rights-model-identifiers.spec.ts (the guard spec) is unchanged', () => {
		expect(
			sha256('src/rights-model-identifiers.spec.ts'),
			'the guard spec is the doc\'s one mechanical guard and #318 must not touch it — the parser here is a second CONSUMER of its grammar, never an edit to it. Repin only from a slice whose mandate names that file.'
		).toBe('e5e9a086ba4e7c6e72f7034739b9561c5944f7c3e6cbff3364b2a32b9a61dc3d');
	});
});

describe('the static app is untouched', () => {
	it('svelte.config.js is unchanged', () => {
		// Repinned for #368 and #832 (the service worker manifest); pinned on its own terms
		// in src/lib/sw/swUpdate.spec.ts.
		expect(sha256('svelte.config.js')).toBe(
			'2dc1fada04898ec8171d3a9f4a544c72ecfdcd1a1ac7509d13479130dfb82a6c'
		);
	});

	it('vite.config.ts is unchanged (vitest.config.ts is NOT pinned — its include glob legitimately grows workers/**)', () => {
		// Repinned for #347 and #442, both sanctioned changes outside this slice.
		expect(sha256('vite.config.ts')).toBe(
			'63d38d3c144303ef0b00ba32aef6993fb225cf7ba0a06c3c0c859560206e96f5'
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
		'roadmap:fetch',
		'roadmap:render'
	];

	const BASELINE_DEV_DEPS = [
		'@inlang/paraglide-js',
		// #408: @resvg/resvg-js rasterises the install icons.
		'@resvg/resvg-js',
		'@sveltejs/adapter-static',
		'@sveltejs/kit',
		'@sveltejs/vite-plugin-svelte',
		'@tailwindcss/vite',
		'@testing-library/svelte',
		'@types/node',
		// #343: fake-indexeddb, a test shim like happy-dom.
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

	// Repinned for #427 (pdfjs-dist, the part viewer) and #612 (modern-screenshot, the
	// feedback capture). The by-name ban on MCP tooling is the next test.
	it('runtime dependencies are exactly the pre-slice-plus-#427-plus-#612 set — no @modelcontextprotocol/sdk, no wrangler, no @cloudflare/*', () => {
		expect(pkg().dependencies).toEqual({
			'modern-screenshot': '^4.7.0',
			'pdfjs-dist': '^6.3.289'
		});
	});

	it('devDependencies are exactly the pre-slice-plus-#408 set — no @modelcontextprotocol/sdk, no wrangler, no @cloudflare/*, nothing new', () => {
		expect(Object.keys(pkg().devDependencies).sort()).toEqual([...BASELINE_DEV_DEPS].sort());
	});

	it('no wrangler / MCP-SDK / cloudflare-tooling reference anywhere in package.json', () => {
		const raw = readFileSync(resolve(ROOT, 'package.json'), 'utf-8');
		for (const forbidden of ['wrangler', '@modelcontextprotocol', '@cloudflare']) {
			expect(raw.includes(forbidden), `package.json mentions ${forbidden} — out of this slice's mandate`).toBe(false);
		}
	});

	// Additions beyond the generator: check:workers, check:sw (#353), test:roadmap (#413)
	// and test:changed (#504), each commissioned outside this slice.
	it('every baseline script survives unchanged in name, and additions are exactly the bundle generator + the workers typecheck gate + the service-worker typecheck gate + the roadmap deploy gate + the related-spec iteration run', () => {
		const keys = Object.keys(pkg().scripts);
		for (const k of BASELINE_SCRIPTS) {
			expect(keys, `baseline script "${k}" was removed or renamed`).toContain(k);
		}
		const added = keys.filter((k) => !BASELINE_SCRIPTS.includes(k));
		expect(added.sort(), `added scripts: ${added.join(', ')}`).toEqual([
			'check:sw',
			'check:workers',
			'mcp:bundle',
			'test:changed',
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
