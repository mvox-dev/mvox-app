// A .svelte whose imports reach a module issuing a non-GET must also read the write gate.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
	namedBindings,
	untraceableForms,
	writesToEntu,
	writingExports
} from '$lib/testing/writeReach';

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
const LIB = join(SRC, 'lib');
const LIB_MODULES = new Map(
	ALL.filter((p) => p.endsWith('.ts') && !p.endsWith('.spec.ts') && p.startsWith(LIB)).map(
		(p) => [p, readFileSync(p, 'utf-8')] as const
	)
);

function resolveModule(specifier: string, fromFile: string): string | null {
	let base: string;
	if (specifier.startsWith('$lib/')) base = join(LIB, specifier.slice('$lib/'.length));
	else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
	else return null;
	base = base.replace(/\.js$/, '');
	return [base, base + '.ts', join(base, 'index.ts')].find((c) => LIB_MODULES.has(c)) ?? null;
}

const WRITING = writingExports(LIB_MODULES, resolveModule);
// Feedback is the one write that skips the gate: offline it waits on the device and is sent
// later (#611 body, Mihkel 2026-10-01). The exception names the file and its two seams.
const GATE_EXCEPTIONS: Record<string, string[]> = {
	'src/routes/+layout.svelte': ['$lib/feedback/feedbackEditor.svelte', '$lib/feedback/sendFeedback']
};

// The pill reads the gate for its data callers; they say why, checked below (#809).
const PILL = join(LIB, 'components', 'SegmentedPill.svelte');

/** Source files that import the component `target`, by $lib or relative specifier. */
function importersOf(target: string): string[] {
	const resolves = (spec: string, from: string) =>
		spec.startsWith('$lib/') ? join(LIB, spec.slice(5)) : resolve(dirname(from), spec);
	return ALL.filter((p) => /\.(svelte|ts)$/.test(p) && !p.endsWith('.spec.ts')).filter((p) =>
		[...readFileSync(p, 'utf-8').matchAll(/from\s*['"]((?:\$lib\/|\.)[^'"]*\.svelte)['"]/g)].some(
			([, spec]) => resolves(spec, p) === target
		)
	);
}

const rendersReason = (p: string) => /m\.write_unavailable_no_signal\(\)/.test(readFileSync(p, 'utf-8'));

/** The file says why, or every chain of files that render it reaches one that does. */
function reasonCovers(p: string, seen = new Set<string>()): boolean {
	if (rendersReason(p)) return true;
	if (seen.has(p)) return false;
	seen.add(p);
	const up = importersOf(p);
	return up.length > 0 && up.every((q) => reasonCovers(q, seen));
}

const WRITE_SEAMS = [...WRITING]
	.filter(([, names]) => names.size > 0)
	.map(([p]) => '$lib/' + relative(LIB, p).replace(/\.ts$/, '').split(/[\\/]/).join('/'));

/** The `$lib` imports of a .svelte file that bring in a binding which writes. */
function writingImports(path: string, source: string): string[] {
	const out: string[] = [];
	const pattern = /import\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;
	for (const [, typeOnly, clause, specifier] of source.matchAll(pattern)) {
		const module = typeOnly ? null : resolveModule(specifier, path);
		const names = module ? WRITING.get(module) : undefined;
		if (!names || names.size === 0) continue;
		const named = clause.match(/\{([\s\S]*)\}/)?.[1];
		const viaNamespace = /\*\s+as\s+/.test(clause);
		const viaDefault = /^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(clause) && names.has('default');
		if (viaNamespace || viaDefault || namedBindings(named ?? '').some(([name]) => names.has(name))) {
			out.push(specifier);
		}
	}
	return out;
}

/** Every `$lib/...` specifier this file imports VALUES from (a bare `import
 *  type { … } from` contributes nothing). */
function valueImportSpecifiers(source: string): string[] {
	const out: string[] = [];
	const pattern = /import\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;
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

describe('#643 — a write reached through other modules still counts', () => {
	const planted = (files: Record<string, string>) =>
		writingExports(new Map(Object.entries(files)), (spec) => spec.replace(/^\.\//, ''));

	it('a page reaching a writer two hops away is counted, and only through the writing export', () => {
		const writing = planted({
			writer: "export function save() { return f(url, { method: 'POST' }); }\nexport function read() {}",
			helper: "import { save, read } from './writer';\nexport const relay = () => save();\nexport const peek = () => read();",
			barrel: "export { relay, peek } from './helper';"
		});
		expect(writing.get('barrel')).toEqual(new Set(['relay']));
		expect(writing.get('helper')).toEqual(new Set(['relay']));
		expect(writing.get('writer')).toEqual(new Set(['save']));
	});

	it('an import cycle ends, and counts a writer only when one is reachable', () => {
		const cycle = {
			a: "import { b } from './b';\nexport function a() { return b(); }",
			b: "import { a } from './a';\nexport function b() { return a(); }"
		};
		expect(planted(cycle).get('a')).toEqual(new Set());
		const fed = planted({
			...cycle,
			b: "import { a } from './a';\nimport { c } from './c';\nexport function b() { a(); c(); }",
			c: "export function c() { return f(u, { method: 'DELETE' }); }"
		});
		expect(fed.get('a')).toEqual(new Set(['a']));
	});
});

describe('#643 — writeReach follows the forms it was taught, and refuses the rest', () => {
	const planted = (files: Record<string, string>) =>
		writingExports(new Map(Object.entries(files)), (spec) => spec.replace(/^\.\//, ''));
	const writer = 'function save() { return f(u, { method: "PUT" }); }';

	it('a default export and a default import carry the write', () => {
		const writing = planted({
			w: `export default ${writer}`,
			page: "import save from './w';\nexport const relay = () => save();"
		});
		expect(writing.get('w')).toEqual(new Set(['default']));
		expect(writing.get('page')).toEqual(new Set(['relay']));
		expect(planted({ w: `${writer}\nexport default save;` }).get('w')).toEqual(
			new Set(['default'])
		);
	});

	it('an export list with no semicolon still exports, and double quotes still count', () => {
		expect(planted({ w: `${writer}\nexport { save }` }).get('w')).toEqual(new Set(['save']));
		expect(writesToEntu('f(u, { method: "DELETE" })')).toBe(true);
	});

	it.each([
		["export * as ns from './w';", 'export * as ns from'],
		["export { default as save } from './w';", 'export { default } from'],
		["const w = await import('./w');\nw.save();", 'a whole module from import()'],
		["import('$lib/w').then(({ save }) => save());", 'import().then'],
		['export default { save };', 'a default-exported object'],
		['export default async function () {}', 'anonymous export default']
	])('the guard catches %s', (source, label) => {
		expect(untraceableForms(source)).toEqual([label]);
	});

	it('no file in src/lib or src/routes uses a form writeReach cannot trace', () => {
		const untraced = ALL.filter(
			(p) =>
				/\.(ts|svelte)$/.test(p) &&
				!p.endsWith('.spec.ts') &&
				[LIB, join(SRC, 'routes')].some((dir) => p.startsWith(dir))
		).flatMap((p) =>
			untraceableForms(readFileSync(p, 'utf-8')).map(
				(form) => `${rel(p)}: writeReach can't trace this form (${form}): teach it or rewrite`
			)
		);
		expect(untraced).toEqual([]);
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

	it("the feedback exception still names real write seams, so it cannot outlive them (#611)", () => {
		for (const seams of Object.values(GATE_EXCEPTIONS)) {
			for (const seam of seams) expect(WRITE_SEAMS, seam).toContain(seam);
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
			const excepted = GATE_EXCEPTIONS[rel(path)] ?? [];
			const seams = writingImports(path, source).filter((seam) => !excepted.includes(seam));
			if (seams.length === 0) continue;
			if (specifiers.includes(GATE_MODULE)) continue;
			offenders.push({ file: rel(path), seams: [...new Set(seams)].sort() });
		}
		expect(offenders).toEqual([]);
	});

	it('every gate reader also renders the reason — a disabled control with no sentence is half the fix', () => {
		const silent: string[] = [];
		for (const path of ALL.filter((p) => p.endsWith('.svelte'))) {
			if (path === PILL) continue;
			const source = readFileSync(path, 'utf-8');
			if (!valueImportSpecifiers(source).includes(GATE_MODULE)) continue;
			if (!/m\.write_unavailable_no_signal\(\)/.test(source)) silent.push(rel(path));
		}
		expect(silent).toEqual([]);
	});

	// A text scan on purpose: which pills save is markup, not an export (#809).
	it('every pill that saves to Entu sits on a surface that says why it is disabled offline', () => {
		const callers = importersOf(PILL).filter((p) =>
			[...readFileSync(p, 'utf-8').matchAll(/<SegmentedPill\b([\s\S]*?)\n\s*\/?>/g)].some(
				([, attrs]) => !/kind="ui"/.test(attrs)
			)
		);
		expect(callers.length).toBeGreaterThanOrEqual(4);
		expect(callers.filter((p) => !reasonCovers(p)).map(rel)).toEqual([]);
	});
});

// (*MVOX:Josquin* — #434, #535)
