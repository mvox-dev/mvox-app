// #434 slice 6/6 review F1 — the structural fence that keeps the write gate
// from going out of date.
//
// THE FINDING this exists for: slice 6 gated the three OFFLINE-READ routes and
// stopped. Four other routes (/links, /roster, /profile, /admin) carried live
// write controls that stayed fully enabled offline with no reason text, and
// nothing pinned them — the per-page `exerciseEveryEnabledControl` sweeps are
// per page, so a route outside those three had nothing to fail.
//
// So the rule is stated once, over the whole tree, and derived rather than
// listed: a component that VALUE-imports from a module which issues a non-GET
// request must also read the write gate ($lib/net/online). The seam set is
// COMPUTED here from the sources, so a new action module is in scope the moment
// it is written — there is no list to forget to update.
//
// `import type` does not count: three components import only a `Level` /
// `RsvpStatus` type from a mixed read+write module and perform no write at all.
//
// This fence says nothing about whether the gate is applied CORRECTLY — that is
// each surface's own offline spec (page.write-offline-sweep.spec.ts and its
// siblings, which operate every enabled control and assert no write reaches the
// wire). It says only that no write surface can exist without one.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const GATE_MODULE = '$lib/net/online';

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

const ALL = walk(SRC);
const rel = (p: string) => relative(process.cwd(), p);

/** Modules that put a non-GET on the wire — the write seams. Derived from the
 *  sources, never a hand-kept list. */
const WRITE_SEAMS = ALL.filter(
	(p) => p.endsWith('.ts') && !p.endsWith('.spec.ts') && p.startsWith(join(SRC, 'lib'))
)
	.filter((p) => /method:\s*'(POST|DELETE|PUT|PATCH)'/.test(readFileSync(p, 'utf-8')))
	.map((p) => '$lib/' + relative(join(SRC, 'lib'), p).replace(/\.ts$/, '').split(/[\\/]/).join('/'));

/** Every `$lib/...` specifier this file imports VALUES from (a bare `import
 *  type { … } from` contributes nothing). */
function valueImportSpecifiers(source: string): string[] {
	const out: string[] = [];
	const pattern = /import\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const [, typeOnlyKeyword, clause, specifier] = match;
		if (typeOnlyKeyword) continue;
		// `import { type Level, listWorks }` still imports a value; `import { type
		// A, type B }` does not. Strip type-only named bindings, then ask whether
		// anything is left.
		const named = clause.match(/\{([\s\S]*)\}/)?.[1];
		if (named !== undefined) {
			const bindings = named
				.split(',')
				.map((b) => b.trim())
				.filter((b) => b.length > 0);
			const valueBindings = bindings.filter((b) => !/^type\s/.test(b));
			const hasDefaultOrNamespace = /^[^{]*[A-Za-z_$][^{]*,/.test(clause);
			if (valueBindings.length === 0 && !hasDefaultOrNamespace) continue;
		}
		out.push(specifier);
	}
	return out;
}

describe('#434 slice 6 review F1 — every write surface reads the write gate', () => {
	it('the derived write-seam set is non-empty and includes the four routes’ seams', () => {
		// A fence over an empty set passes vacuously. Pin the seams named in the
		// finding so a refactor that hides the non-GET behind a helper (and empties
		// this set) fails here rather than going quiet.
		expect(WRITE_SEAMS.length).toBeGreaterThan(10);
		for (const seam of [
			'$lib/links/linkActions',
			'$lib/roster/memberLifecycle',
			'$lib/roster/memberRecord',
			'$lib/sections/sectionActions',
			'$lib/admin/roleManagement',
			'$lib/invite/inviteData',
			'$lib/profile/profileData'
		]) {
			expect(WRITE_SEAMS, seam).toContain(seam);
		}
	});

	it('no .svelte file value-imports a write seam without also importing $lib/net/online', () => {
		const offenders: { file: string; seams: string[] }[] = [];
		for (const path of ALL.filter((p) => p.endsWith('.svelte'))) {
			const source = readFileSync(path, 'utf-8');
			const specifiers = valueImportSpecifiers(source);
			const seams = specifiers.filter((s) => WRITE_SEAMS.includes(s));
			if (seams.length === 0) continue;
			if (specifiers.includes(GATE_MODULE)) continue;
			offenders.push({ file: rel(path), seams: [...new Set(seams)].sort() });
		}
		// A page that genuinely writes nothing but value-imports a READ helper out
		// of a mixed read+write module would land here too. The honest fix then is
		// to move that read into its own module, not to widen this fence.
		expect(offenders).toEqual([]);
	});

	it('every gate reader also renders the reason — a disabled control with no sentence is half the fix', () => {
		const silent: string[] = [];
		for (const path of ALL.filter((p) => p.endsWith('.svelte'))) {
			const source = readFileSync(path, 'utf-8');
			if (!valueImportSpecifiers(source).includes(GATE_MODULE)) continue;
			if (!/m\.write_unavailable_no_signal\(\)/.test(source)) silent.push(rel(path));
		}
		expect(silent).toEqual([]);
	});
});

// (*MVOX:Josquin* — #434 slice 6 review F1)
