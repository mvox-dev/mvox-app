// A .svelte that value-imports a module issuing a non-GET must also read the write gate.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stripComments } from '$lib/testing/commentRules';

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
// A deliberate pinned text check: a new write module is a seam once written. Comments don't count.
const WRITE_METHOD = /method:\s*'(POST|DELETE|PUT|PATCH)'/;
const writesToEntu = (source: string) => WRITE_METHOD.test(stripComments(source));

const DIRECT_SEAMS = ALL.filter(
	(p) => p.endsWith('.ts') && !p.endsWith('.spec.ts') && p.startsWith(join(SRC, 'lib'))
)
	.filter((p) => writesToEntu(readFileSync(p, 'utf-8')))
	.map((p) => '$lib/' + relative(join(SRC, 'lib'), p).replace(/\.ts$/, '').split(/[\\/]/).join('/'));

// Modules that hand a page its writes without issuing them; one counts as a seam
// while it value-imports a direct seam.
const WRITE_RELAYS = ['$lib/events/eventActions'];
const relaySource = (seam: string) =>
	readFileSync(join(SRC, 'lib', seam.replace(/^\$lib\//, '') + '.ts'), 'utf-8');
const WRITE_SEAMS = [
	...DIRECT_SEAMS,
	...WRITE_RELAYS.filter((relay) =>
		valueImportSpecifiers(relaySource(relay)).some((s) => DIRECT_SEAMS.includes(s))
	)
];

/** Every `$lib/...` specifier this file imports VALUES from (a bare `import
 *  type { … } from` contributes nothing). */
function valueImportSpecifiers(source: string): string[] {
	const out: string[] = [];
	const pattern = /import\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const [, typeOnlyKeyword, clause, specifier] = match;
		if (typeOnlyKeyword) continue;
		// `import { type Level, listWorks }` still imports a value; `import { type A, type B }`
		// does not, so drop the type-only bindings and ask whether anything is left.
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

describe('#535 — write-method text inside a comment makes no seam', () => {
	it('a file whose only write-method text is in comments is not a seam', () => {
		const source = [
			"// entuFetch(url, { method: 'POST' })",
			'/**',
			" * entuFetch(url, { method: 'DELETE' })",
			' */',
			"export const read = (url: string) => entuFetch(url); // { method: 'PUT' }"
		].join('\n');
		expect(writesToEntu(source)).toBe(false);
	});

	it('a real write in code is a seam', () => {
		expect(writesToEntu("await entuFetch(url, { method: 'POST' });")).toBe(true);
	});

	it('a real write with a trailing comment after it is still a seam', () => {
		expect(writesToEntu("await entuFetch(url, { method: 'PATCH' }); // edits in place")).toBe(true);
	});

	it("a '//' inside a string hides nothing after it", () => {
		expect(writesToEntu("await entuFetch('https://x', { method: 'DELETE' });")).toBe(true);
	});
});

describe('#434 — every write surface reads the write gate', () => {
	it('the derived write-seam set is non-empty and includes the four routes’ seams', () => {
		// A check over an empty set passes vacuously, so a refactor that hides the non-GET
		// behind a helper must fail here rather than go quiet.
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

	it('eventActions.ts counts as a write path: it relays the event page\'s writes', () => {
		expect(WRITE_SEAMS).toContain('$lib/events/eventActions');
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
		// A page that writes nothing but value-imports a read helper from a mixed module lands
		// here too; the fix is to move that read into its own module, not to widen this check.
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

// (*MVOX:Josquin* — #434, #535)
