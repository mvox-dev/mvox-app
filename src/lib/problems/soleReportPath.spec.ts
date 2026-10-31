// #1049: reportProblem is the one way into the problem log; no other module keeps or shapes one.
// A text scan over the source tree is the deliberate tool here: it is a fence, like #395's.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSourceFiles, isSoleCreatePathViolation } from '$lib/testing/soleLiteralGuard';

const FENCES = [
	{ needle: 'keepProblem', exempt: ['lib/problems/problemLog.ts', 'lib/problems/reportProblem.ts'] },
	{ needle: 'redactError', exempt: ['lib/problems/problemLog.ts', 'lib/problems/reportProblem.ts'] },
	{ needle: 'redactText', exempt: ['lib/problems/problemLog.ts', 'lib/problems/reportProblem.ts'] },
	{ needle: 'createProblemLog', exempt: ['lib/problems/problemLog.ts'] }
];

// A write straight into a problem log, by any name: getProblemLog()?.add(…), log.add(…).
const LOG_ADD = /(getProblemLog\(\)|\b\w*[lL]og)\s*\??\.\s*add\s*\(/;

function violations(rel: string, content: string): string[] {
	const found = FENCES.filter((f) => isSoleCreatePathViolation(rel, content, f.needle, f.exempt)).map(
		(f) => f.needle
	);
	const isSpec = rel.endsWith('.spec.ts');
	if (!isSpec && rel !== 'lib/problems/problemLog.ts' && LOG_ADD.test(content)) found.push('log.add');
	return found;
}

describe('#1049 sole report path: guard predicate (self-test)', () => {
	it('flags a module that keeps a problem or shapes its detail itself', () => {
		expect(violations('lib/library/libraryPageWrites.ts', "keepProblem('library', 'x', e);")).toEqual([
			'keepProblem'
		]);
		expect(violations('lib/events/X.svelte', 'detail: redactError(e)')).toEqual(['redactError']);
		expect(violations('lib/files/x.ts', 'const log = createProblemLog();')).toEqual(['createProblemLog']);
		expect(violations('lib/files/x.ts', "getProblemLog()?.add(identity, { area: 'x' });")).toEqual(['log.add']);
		expect(violations('lib/files/x.ts', 'await log.add(owner, row);')).toEqual(['log.add']);
		expect(violations('lib/files/x.ts', 'next.add(id); seen.add(id);')).toEqual([]);
	});

	it('does not flag the reporting module, the log, or a spec', () => {
		expect(violations('lib/problems/reportProblem.ts', 'return keepProblem(area, action, redactText(r));')).toEqual([]);
		expect(violations('lib/problems/problemLog.ts', 'void log.add(identity, row); createProblemLog();')).toEqual([]);
		expect(violations('lib/problems/x.spec.ts', 'keepProblem(); createProblemLog();')).toEqual([]);
	});
});

describe('#1049 sole report path (integration: real src/ tree)', () => {
	const libDir = join(import.meta.dirname, '..');
	const srcDir = join(libDir, '..');

	it('the reporting module does keep problems (the guard is not vacuous)', () => {
		const content = readFileSync(join(srcDir, 'lib/problems/reportProblem.ts'), 'utf-8');
		expect(content).toContain('keepProblem(');
	});

	it('no .ts/.svelte file under src/lib or src/routes outside the two modules keeps or shapes a report', () => {
		const found = [
			...findSourceFiles(libDir, ['.ts', '.svelte']),
			...findSourceFiles(join(srcDir, 'routes'), ['.ts', '.svelte'])
		]
			.map((full) => ({ rel: relative(srcDir, full), content: readFileSync(full, 'utf-8') }))
			.flatMap(({ rel, content }) => violations(rel, content).map((needle) => `${rel}: ${needle}`));
		expect(found).toEqual([]);
	});
});

// (*MVOX:Josquin*)
