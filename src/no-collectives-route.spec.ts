// #338 RED — the separate /collectives page is DELETED, and nothing in src/
// may still point at it. The picker that replaces it lives in the agenda
// header (page.collective-picker.spec.ts); this guard makes the page's death
// structural, the same way a dead `href` bit us on #313.
//
// Two facts, both file-system-level (the house guard idiom — scan real
// sources, mirroring src/unclassed-controls.spec.ts / src/ios-form-zoom.spec.ts,
// so GREEN cannot pass by patching a component nothing mounts):
//
//   1. `src/routes/collectives/` does not exist.
//   2. No non-spec source under src/ contains `href="/collectives"` — the
//      three agenda link targets (switch link, none-state link, error-state
//      link) all resolve to in-place controls, not navigations.
//
// Spec files are excluded from the scan: NavShell.spec.ts keeps its SYNTHETIC
// 'collectives' fixture entry (it tests the visibility API, not the real
// entry list — untouched by #338), and this file names the needle itself.
// The nav entry's own death (NAV_ENTRIES 7 → 6, no '/collectives' route) is
// pinned in src/lib/nav/entries.links.spec.ts.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname);

function sourceFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter(
			(d) =>
				d.isFile() &&
				(d.name.endsWith('.svelte') || d.name.endsWith('.ts')) &&
				!d.name.endsWith('.spec.ts')
		)
		.map((d) => join(d.parentPath, d.name))
		.filter((f) => !relative(SRC_ROOT, f).startsWith(join('lib', 'paraglide')));
}

describe('#338 — the /collectives page is dead', () => {
	it('src/routes/collectives/ no longer exists', () => {
		expect(
			existsSync(join(SRC_ROOT, 'routes', 'collectives')),
			'src/routes/collectives/ must be deleted — the picker lives in the agenda header now'
		).toBe(false);
	});

	it('no href="/collectives" remains anywhere in src (non-spec sources)', () => {
		const needle = 'href="/collectives"';
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			const source = readFileSync(file, 'utf-8');
			let idx = source.indexOf(needle);
			while (idx !== -1) {
				const line = source.slice(0, idx).split('\n').length;
				offenders.push(`${relative(SRC_ROOT, file)}:${line}`);
				idx = source.indexOf(needle, idx + 1);
			}
		}
		expect(
			offenders,
			`links to the deleted /collectives page (a dead href is the #313 failure):\n${offenders.join('\n')}`
		).toEqual([]);
	});

	it('scans a non-trivial set of sources (sanity: the walker works)', () => {
		expect(sourceFiles().length).toBeGreaterThan(10);
	});
});

// (*MVOX:Tallis* — #338 RED)
