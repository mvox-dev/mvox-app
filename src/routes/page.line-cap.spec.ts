// Source files stay small enough to read whole: one cap, a shrink-only exception list, and a
// register of every file over the next step.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
	LINE_CAP_EXCEPTIONS,
	LINE_CAP_REGISTER,
	NEXT_STEP,
	STEP,
	addedFiles,
	addedOverNextStep,
	capViolations,
	countLines,
	registerMismatch,
	selectSourceFiles
} from '$lib/testing/lineCap';

const MAX_LINES = 1500;
const ROOT = process.cwd();
const PAGE = resolve(ROOT, 'src/routes/+page.svelte');
const DIRS = [resolve(ROOT, 'src/lib/components/agenda'), resolve(ROOT, 'src/lib/agenda')];

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

function lineCount(path: string): number {
	return countLines(readFileSync(path, 'utf-8'));
}

describe('#508 — no agenda file over the line cap', () => {
	it(`+page.svelte and every file under agenda/ is at most ${MAX_LINES} lines`, () => {
		const files = [PAGE, ...DIRS.flatMap(walk)];
		expect(files.length).toBeGreaterThan(10);
		const over = files
			.map((path) => ({ file: relative(ROOT, path), lines: lineCount(path) }))
			.filter(({ lines }) => lines > MAX_LINES);
		expect(over).toEqual([]);
	});
});

const ORIGINAL_EXCEPTIONS = [
	'src/lib/agenda/SeriesCreateForm.svelte',
	'src/lib/seasons/seasonManage.ts'
];

const planted = (n: number) => 'x\n'.repeat(n);

describe('#525 — the line-cap rules, each shown by a planted example', () => {
	it('counts lines as wc -l does for a file ending in a newline', () => {
		expect(countLines(planted(3))).toBe(3);
		expect(countLines('a\nb')).toBe(2);
		expect(countLines('')).toBe(0);
	});

	it('selects .ts and .svelte under src/, never specs or fixture dirs', () => {
		expect(
			selectSourceFiles([
				'src/lib/a.ts',
				'src/routes/b.svelte',
				'src/lib/a.spec.ts',
				'src/lib/c.js',
				'scripts/d.ts',
				'src/lib/testing/comment-rules-fixtures/e.ts',
				'src/lib/testing/line-cap-fixtures/f.ts'
			])
		).toEqual(['src/lib/a.ts', 'src/routes/b.svelte']);
	});

	it('a source file over the step fails, unless it is on the exception list', () => {
		const counts = { 'src/over.ts': STEP + 1, 'src/at.ts': STEP };
		expect(capViolations(counts, [])).toEqual([
			{ file: 'src/over.ts', lines: STEP + 1, reason: 'over-cap' }
		]);
		expect(capViolations(counts, ['src/over.ts'])).toEqual([]);
	});

	it('an exception at or under the step fails until it leaves the list', () => {
		expect(capViolations({ 'src/split.ts': STEP }, ['src/split.ts'])).toEqual([
			{ file: 'src/split.ts', lines: STEP, reason: 'exception-within-cap' }
		]);
		expect(capViolations({}, ['src/gone.ts'])).toEqual([
			{ file: 'src/gone.ts', lines: 0, reason: 'exception-within-cap' }
		]);
	});

	it('a register missing a file over the next step fails', () => {
		expect(registerMismatch({ 'src/big.ts': NEXT_STEP + 1 }, [])).toEqual({
			missing: ['src/big.ts'],
			stale: []
		});
	});

	it('a register listing a file at or under the next step, or no longer there, fails', () => {
		expect(
			registerMismatch({ 'src/small.ts': NEXT_STEP }, ['src/small.ts', 'src/gone.ts'])
		).toEqual({ missing: [], stale: ['src/gone.ts', 'src/small.ts'] });
	});

	it('an added file over the next step fails; one at the next step passes', () => {
		const counts = { 'src/new-big.ts': NEXT_STEP + 1, 'src/new-ok.ts': NEXT_STEP };
		expect(addedOverNextStep(['src/new-big.ts', 'src/new-ok.ts'], counts)).toEqual([
			{ file: 'src/new-big.ts', lines: NEXT_STEP + 1 }
		]);
	});

	it('added files are read against the merge-base with main, renames excluded, untracked included', () => {
		const calls: string[][] = [];
		const git = (args: string[]) => {
			calls.push(args);
			if (args[0] === 'merge-base') return 'base123\n';
			return args[0] === 'ls-files' ? 'src/lib/untracked.ts\n' : 'src/lib/new.ts\n';
		};
		expect(addedFiles({ git })).toEqual(['src/lib/new.ts', 'src/lib/untracked.ts']);
		expect(calls).toEqual([
			['merge-base', 'origin/main', 'HEAD'],
			['diff', '--name-only', '--diff-filter=A', 'base123'],
			['ls-files', '--others', '--exclude-standard']
		]);
	});
});

describe('#525 — every source file under src/ obeys the line cap', () => {
	const sources = selectSourceFiles(
		walk(resolve(ROOT, 'src')).map((path) => relative(ROOT, path).split('\\').join('/'))
	);
	const counts = Object.fromEntries(sources.map((file) => [file, lineCount(resolve(ROOT, file))]));

	it('scans the real tree, not a vacuum', () => {
		expect(sources.length).toBeGreaterThan(150);
	});

	it(`every source file is at most ${STEP} lines unless it is an exception`, () => {
		expect(capViolations(counts, LINE_CAP_EXCEPTIONS)).toEqual([]);
	});

	it('the exception list only shrinks: every entry is one of the original two', () => {
		expect(LINE_CAP_EXCEPTIONS.filter((file) => !ORIGINAL_EXCEPTIONS.includes(file))).toEqual([]);
		expect(new Set(LINE_CAP_EXCEPTIONS).size).toBe(LINE_CAP_EXCEPTIONS.length);
	});

	it(`the register lists exactly the source files over ${NEXT_STEP} lines`, () => {
		expect(registerMismatch(counts, LINE_CAP_REGISTER)).toEqual({ missing: [], stale: [] });
	});

	it(`every source file this change adds is at most ${NEXT_STEP} lines`, () => {
		expect(addedOverNextStep(selectSourceFiles(addedFiles()), counts)).toEqual([]);
	});
});

describe('#568 — an untracked new file counts as added', () => {
	const plantedFile = 'src/lib/testing/comment-rules-fixtures/planted-over-next-step.ts';

	afterEach(() => rmSync(resolve(ROOT, plantedFile), { force: true }));

	it('an untracked new file over the next step fails the added-file check', () => {
		writeFileSync(resolve(ROOT, plantedFile), planted(NEXT_STEP + 1));
		const added = addedFiles().filter((file) => file === plantedFile);
		const counts = { [plantedFile]: lineCount(resolve(ROOT, plantedFile)) };
		expect(addedOverNextStep(added, counts)).toEqual([{ file: plantedFile, lines: NEXT_STEP + 1 }]);
	});
});

describe('#525 — the related-spec run reaches the line-cap check', () => {
	it('test:changed runs src/routes/page.line-cap.spec.ts by path, which --changed never collects', () => {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts['test:changed']).toContain('src/routes/page.line-cap.spec.ts');
	});
});
