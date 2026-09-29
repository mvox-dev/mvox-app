import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	COMMENT_FIXTURES_DIR,
	changedFiles,
	checkChangedFiles,
	checkCommentRules,
	selectCheckedFiles,
	type CommentRule,
	type CommentViolation
} from './commentRules';

const FIXTURES = 'src/lib/testing/comment-rules-fixtures/';

function fixture(name: string): string {
	return readFileSync(resolve(process.cwd(), FIXTURES, name), 'utf8');
}

function oneCommentIn20Lines(comment: string): string {
	const body = Array.from({ length: 19 }, (_, i) => `export const v${i} = ${i};`);
	return [comment, ...body].join('\n') + '\n';
}

function check(name: string): Array<Pick<CommentViolation, 'rule' | 'line'>> {
	return checkCommentRules(FIXTURES + name, fixture(name)).map(({ rule, line }) => ({
		rule,
		line
	}));
}

describe('checkCommentRules — the four violations, each from a planted fixture', () => {
	it('a run of 4 whole-line // comments is one comment over 3 lines', () => {
		expect(check('comment-too-long.ts')).toEqual([{ rule: 'comment-too-long', line: 3 }]);
	});

	it('a block comment spanning 5 lines is over 3 lines', () => {
		expect(check('block-too-long.ts')).toEqual([{ rule: 'comment-too-long', line: 1 }]);
	});

	it('a block opened after code on the same line still counts every line it spans', () => {
		expect(check('mid-line-block.ts')).toEqual([
			{ rule: 'comment-too-long', line: 2 },
			{ rule: 'review-history', line: 3 }
		]);
	});

	it('an html comment opened after markup on the same line still counts every line it spans', () => {
		expect(check('mid-line-block.svelte')).toEqual([
			{ rule: 'comment-too-long', line: 6 },
			{ rule: 'review-history', line: 7 }
		]);
	});

	it('a block opened and closed after code on one line leaves the next line as code', () => {
		const code = Array.from({ length: 19 }, (_, i) => `export const v${i} = ${i};`);
		const source = ['export const a = 1; /* why */', ...code].join('\n');
		expect(checkCommentRules('src/x.ts', source)).toEqual([]);
	});

	it('an html comment spanning 4 lines in svelte markup is over 3 lines', () => {
		expect(check('comment-too-long.svelte')).toEqual([{ rule: 'comment-too-long', line: 5 }]);
	});

	it('a comment line over 100 characters is reported', () => {
		expect(check('line-too-long.ts')).toEqual([{ rule: 'line-too-long', line: 2 }]);
	});

	it('comments at 15% of a file are too many', () => {
		expect(check('too-many-comments.ts').map((v) => v.rule)).toEqual(['too-many-comments']);
	});

	it('exactly 10% is already too many (2 of 20 lines, trailing newline not a line)', () => {
		expect(check('ten-percent.ts').map((v) => v.rule)).toEqual(['too-many-comments']);
	});

	it('every line a block comment spans counts toward the share', () => {
		expect(check('block-span-counts.ts').map((v) => v.rule)).toEqual(['too-many-comments']);
	});

	it('review-history phrases in comments are reported, case-insensitive', () => {
		expect(check('review-history.ts')).toEqual([
			{ rule: 'review-history', line: 5 },
			{ rule: 'review-history', line: 15 },
			{ rule: 'review-history', line: 25 },
			{ rule: 'review-history', line: 35 },
			{ rule: 'review-history', line: 45 },
			{ rule: 'review-history', line: 55 },
			{ rule: 'review-history', line: 65 },
			{ rule: 'review-history', line: 75 }
		]);
	});

	it('the plural and suffixed shapes are caught, not just the bare singular', () => {
		const narration = [
			'// review rounds settled the shape',
			'// review-round 2 kept the name',
			'// findings 1a-1d moved this',
			'// findings 2–4 reshaped this',
			'// slice 4b adds the rest',
			'// slices 1 and 2 landed together'
		];
		for (const line of narration) {
			expect(
				checkCommentRules('src/x.ts', oneCommentIn20Lines(line)).map((v) => v.rule)
			).toEqual(['review-history']);
		}
	});

	it('words that merely contain the stems are not narration', () => {
		const innocent = [
			'// the refinding of the root cause',
			'// a slice of the array',
			'// review the rounding here',
			'// finding the parent by id'
		];
		for (const line of innocent) {
			expect(checkCommentRules('src/x.ts', oneCommentIn20Lines(line)).map((v) => v.rule)).toEqual(
				[]
			);
		}
	});

	it('review-history phrases in a svelte script comment are reported', () => {
		expect(check('review-history.svelte')).toEqual([{ rule: 'review-history', line: 2 }]);
	});

	it('a compliant block touching a directive line merges into one over-long comment', () => {
		expect(check('adjacent-runs-merge.ts')).toEqual([{ rule: 'comment-too-long', line: 1 }]);
	});

	it('the comment-too-long detail names the run, so the blank-line fix is evident', () => {
		const found = checkCommentRules('src/x.ts', fixture('adjacent-runs-merge.ts'));
		expect(found[0].detail).toBe(
			'4 consecutive comment lines read as one comment, over the 3-line limit (a blank line splits them)'
		);
	});

	it('every violation names its file', () => {
		const found = checkCommentRules('src/x.ts', fixture('line-too-long.ts'));
		expect(found.map((v) => v.file)).toEqual(['src/x.ts']);
		expect(found[0].detail).toEqual(expect.any(String));
	});
});

describe('checkCommentRules — what is not a violation', () => {
	it('a compliant ts file passes: 3-line JSDoc, long code line, phrases only in strings', () => {
		expect(check('compliant.ts')).toEqual([]);
	});

	it('a compliant svelte file passes', () => {
		expect(check('compliant.svelte')).toEqual([]);
	});

	it('a code line with a trailing // is not a comment line', () => {
		expect(check('trailing-comments.ts')).toEqual([]);
	});
});

describe('checkCommentRules — a trailing comment escapes the counting rules, not the content rules', () => {
	function rules(source: string): CommentRule[] {
		return checkCommentRules('src/x.ts', source + '\n').map((v) => v.rule);
	}

	it('narration trailing a code line is reported, // and /* */ alike', () => {
		expect(rules('export const x = 1; // review round 3 asked for this')).toEqual([
			'review-history'
		]);
		expect(rules('export const x = 1; /* slice 4 added this */')).toEqual(['review-history']);
	});

	it('narration in a trailing comment inside svelte markup is reported', () => {
		const markup = '<p>x</p> <!-- findings 2 moved this -->';
		expect(checkCommentRules('src/X.svelte', markup + '\n').map((v) => v.rule)).toEqual([
			'review-history'
		]);
	});

	it('a trailing comment over 100 characters is reported, the code it trails uncounted', () => {
		expect(rules(`export const x = 1; // ${'q'.repeat(140)}`)).toEqual(['line-too-long']);
		expect(rules(`export const someVeryLongName = ${'1'.repeat(140)};`)).toEqual([]);
	});

	it('a // inside a string opens no comment, so a url is not narration', () => {
		expect(rules("const u = 'https://x'; // ok")).toEqual([]);
		expect(rules("const u = 'https://x'; // finding 3")).toEqual(['review-history']);
		expect(rules(`const u = "https://${'x'.repeat(140)}";`)).toEqual([]);
		expect(rules('const u = `https://x/findings 3`;')).toEqual([]);
	});

	it('the counting rules still ignore trailing comments', () => {
		const fourInARow = Array.from({ length: 4 }, (_, i) => `const v${i} = ${i}; // note ${i}`);
		expect(rules(fourInARow.join('\n'))).toEqual([]);
	});
});

describe('selectCheckedFiles — which changed paths are checked', () => {
	it('keeps code files anywhere in the repo', () => {
		const code = [
			'src/lib/a.ts',
			'src/routes/x/+page.svelte',
			'src/lib/a.spec.ts',
			'scripts/migrations/run.ts',
			'.claude/workflows/tdd-slice-pipeline.js',
			'scripts/migrations/lib/loader.mjs',
			'scripts/migrations/lib/register-loader.mjs',
			'tools/legacy.cjs',
			'tools/mod.mts',
			'tools/mod.cts'
		];
		expect(selectCheckedFiles(code)).toEqual(code);
	});

	it('drops non-code files', () => {
		expect(
			selectCheckedFiles([
				'README.md',
				'.github/workflows/ci.yml',
				'package.json',
				'messages/en.json'
			])
		).toEqual([]);
	});

	it('drops the planted fixtures, so the real check never trips on them', () => {
		expect(COMMENT_FIXTURES_DIR).toBe(FIXTURES);
		expect(
			selectCheckedFiles([FIXTURES + 'comment-too-long.ts', FIXTURES + 'compliant.svelte'])
		).toEqual([]);
	});
});

describe('checkChangedFiles — only the changed set is checked', () => {
	const contents: Record<string, string> = {
		'src/touched.ts': fixture('compliant.ts'),
		'src/untouched.ts': fixture('comment-too-long.ts')
	};

	it('a violating file outside the changed set is not read or reported', () => {
		const read: string[] = [];
		const found = checkChangedFiles(['src/touched.ts', 'README.md'], (p) => {
			read.push(p);
			return contents[p];
		});
		expect(found).toEqual([]);
		expect(read).toEqual(['src/touched.ts']);
	});

	it('a changed file that breaks the rules fails', () => {
		const found = checkChangedFiles(['src/untouched.ts'], (p) => contents[p]);
		expect(found.map(({ file, rule, line }) => ({ file, rule, line }))).toEqual([
			{ file: 'src/untouched.ts', rule: 'comment-too-long', line: 3 }
		]);
	});
});

describe('changedFiles — the changed set against main', () => {
	it('diffs the working tree against the merge base with origin/main, deletions excluded', () => {
		const calls: string[][] = [];
		const git = (args: string[]): string => {
			calls.push(args);
			if (args[0] === 'merge-base') return 'abc123\n';
			return 'src/a.ts\nREADME.md\n\n';
		};
		expect(changedFiles({ git })).toEqual(['src/a.ts', 'README.md']);
		expect(calls).toEqual([
			['merge-base', 'origin/main', 'HEAD'],
			['diff', '--name-only', '--diff-filter=d', 'abc123']
		]);
	});

	it('runs against the real repository without throwing', () => {
		const files = changedFiles();
		expect(Array.isArray(files)).toBe(true);
		for (const f of files) expect(typeof f).toBe('string');
	});
});

describe('CI can compute the changed set', () => {
	it('the CI checkout fetches full history so origin/main exists', () => {
		const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
		const checkout = ci.slice(ci.indexOf('uses: actions/checkout'));
		const step = checkout.slice(0, checkout.search(/\n\s*- name:/));
		expect(step).toMatch(/fetch-depth:\s*0\b/);
	});
});

describe('the related-spec run reaches the comment check', () => {
	it('test:changed runs src/comment-rules.spec.ts by path, which --changed never collects', () => {
		const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts['test:changed']).toBe(
			'vitest run --changed origin/main && vitest run src/comment-rules.spec.ts'
		);
	});
});
