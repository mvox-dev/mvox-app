/**
 * #413 — the deploy gate's narrowness, pinned.
 *
 * `.github/workflows/roadmap.yml` runs `pnpm test:roadmap` rather than the
 * whole suite, so a red test elsewhere in the repo can no longer freeze a
 * public page built from nothing but issue data. That is only safe while the
 * tests in THIS directory cover the whole render path — which holds because
 * every non-spec file here imports its siblings, node builtins and `yaml`,
 * and nothing else.
 *
 * This test is that property, made mechanical. Reach outside the directory
 * from a render-path file and it fails here, loudly, instead of the gate
 * quietly going blind: the import is then either moved back, or the gate's
 * scope is re-argued and this fence widened with it. A narrowing that cannot
 * tell when it stopped being true is worse than no narrowing.
 *
 * Spec files are exempt on purpose — a test may reach for fixtures and
 * helpers anywhere; it is not part of what the workflow builds.
 *
 * (*PO:Gama*)
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(__dirname);

/** Packages a render-path file may import. `yaml` parses the older
 *  frontmatter body shape; node builtins carry the file and URL work. */
const ALLOWED_PACKAGES = new Set(['yaml']);

const isBuiltin = (spec: string): boolean => spec.startsWith('node:');
const isSibling = (spec: string): boolean => spec.startsWith('./') || spec.startsWith('../');

function renderPathFiles(): string[] {
	return readdirSync(DIR, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.spec.ts'))
		.map((d) => join(d.parentPath, d.name));
}

/** Every `from '…'` specifier in a file, import or re-export alike. */
function importSpecifiers(source: string): string[] {
	return [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]);
}

describe('#413 — the render path reaches no further than this directory', () => {
	it('finds the render-path files at all (an empty sweep would pass vacuously)', () => {
		expect(renderPathFiles().length).toBeGreaterThan(3);
	});

	it('every non-spec file imports only siblings, node builtins and the allowed packages', () => {
		const offenders: string[] = [];
		for (const file of renderPathFiles()) {
			for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
				if (isSibling(spec) || isBuiltin(spec) || ALLOWED_PACKAGES.has(spec)) continue;
				offenders.push(`${file.slice(DIR.length + 1)} → ${spec}`);
			}
		}
		expect(
			offenders,
			"the deploy gate runs only this directory's tests (#413). An import reaching outside it means " +
				'those tests no longer cover the whole render path: move the import back, or widen the gate in ' +
				'roadmap.yml and this fence together — never one without the other'
		).toEqual([]);
	});

	it('a sibling relative import is not mistaken for an outside one (the check can fail, not only pass)', () => {
		expect(importSpecifiers("import { x } from './render';\nimport { y } from 'svelte';")).toEqual([
			'./render',
			'svelte'
		]);
		expect(isSibling('./render')).toBe(true);
		expect(isSibling('svelte')).toBe(false);
	});
});
