import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export type CommentRule =
	| 'comment-too-long'
	| 'line-too-long'
	| 'too-many-comments'
	| 'review-history';

export interface CommentViolation {
	file: string;
	rule: CommentRule;
	line: number;
	detail: string;
}

export const COMMENT_FIXTURES_DIR = 'src/lib/testing/comment-rules-fixtures/';

const MAX_COMMENT_RUN = 3;
const MAX_LINE_LENGTH = 100;
const MAX_COMMENT_SHARE = 0.1;
const REVIEW_HISTORY = /\b(review round|finding \d+|slice \d+)\b/i;
const CODE_FILE = /\.(ts|js|svelte)$/;

// A trailing newline splits into a phantom empty final element; drop it here
// so callers count real lines only, once.
function splitLines(source: string): string[] {
	const lines = source.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

// A whole-comment line: `// x`, or a line inside a `/* */` / `<!-- -->` span,
// in whichever syntax its .svelte region (script/style/markup) uses. Code
// with a trailing `// note` is not a comment line — the code is what counts.
function classifyCommentLines(lines: string[], isSvelte: boolean): boolean[] {
	const isComment: boolean[] = new Array(lines.length).fill(false);
	let region: 'script' | 'style' | 'markup' = isSvelte ? 'markup' : 'script';
	let blockOpen = false;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		if (isSvelte) {
			if (trimmed.startsWith('<script')) region = 'script';
			else if (trimmed.startsWith('</script')) {
				region = 'markup';
				blockOpen = false;
			} else if (trimmed.startsWith('<style')) region = 'style';
			else if (trimmed.startsWith('</style')) {
				region = 'markup';
				blockOpen = false;
			}
		}

		if (blockOpen) {
			isComment[i] = true;
			if (trimmed.includes(region === 'markup' ? '-->' : '*/')) blockOpen = false;
			continue;
		}

		if (region === 'markup') {
			if (trimmed.startsWith('<!--')) {
				isComment[i] = true;
				if (!trimmed.slice(4).includes('-->')) blockOpen = true;
			}
		} else if (trimmed.startsWith('//')) {
			isComment[i] = true;
		} else if (trimmed.startsWith('/*')) {
			isComment[i] = true;
			if (!trimmed.slice(2).includes('*/')) blockOpen = true;
		}
	}

	return isComment;
}

export function checkCommentRules(file: string, source: string): CommentViolation[] {
	const lines = splitLines(source);
	const isComment = classifyCommentLines(lines, file.endsWith('.svelte'));
	const violations: CommentViolation[] = [];

	let runStart = -1;
	for (let i = 0; i <= lines.length; i++) {
		const inRun = i < lines.length && isComment[i];
		if (inRun) {
			if (runStart === -1) runStart = i;
			continue;
		}
		if (runStart !== -1) {
			const runLength = i - runStart;
			if (runLength > MAX_COMMENT_RUN) {
				violations.push({
					file,
					rule: 'comment-too-long',
					line: runStart + 1,
					detail: `comment spans ${runLength} lines, over the ${MAX_COMMENT_RUN}-line limit`
				});
			}
			runStart = -1;
		}
	}

	for (let i = 0; i < lines.length; i++) {
		if (!isComment[i]) continue;
		if (lines[i].length > MAX_LINE_LENGTH) {
			violations.push({
				file,
				rule: 'line-too-long',
				line: i + 1,
				detail: `comment line is ${lines[i].length} characters, over the ${MAX_LINE_LENGTH}-character limit`
			});
		}
		if (REVIEW_HISTORY.test(lines[i])) {
			violations.push({
				file,
				rule: 'review-history',
				line: i + 1,
				detail: 'comment reads as review-history narration, not why the code is this way'
			});
		}
	}

	const commentCount = isComment.filter(Boolean).length;
	if (lines.length > 0 && commentCount / lines.length >= MAX_COMMENT_SHARE) {
		const firstCommentLine = isComment.indexOf(true);
		const share = Math.round((commentCount / lines.length) * 100);
		violations.push({
			file,
			rule: 'too-many-comments',
			line: firstCommentLine === -1 ? 1 : firstCommentLine + 1,
			detail: `comments are ${share}% of ${lines.length} lines, at or over the ${MAX_COMMENT_SHARE * 100}% limit`
		});
	}

	return violations;
}

export function selectCheckedFiles(paths: string[]): string[] {
	return paths.filter((path) => CODE_FILE.test(path) && !path.startsWith(COMMENT_FIXTURES_DIR));
}

export function checkChangedFiles(
	changed: string[],
	readFile: (path: string) => string = (path) =>
		readFileSync(resolve(process.cwd(), path), 'utf8')
): CommentViolation[] {
	const violations: CommentViolation[] = [];
	for (const file of selectCheckedFiles(changed)) {
		violations.push(...checkCommentRules(file, readFile(file)));
	}
	return violations;
}

export type GitRunner = (args: string[]) => string;

function runGit(args: string[]): string {
	return execFileSync('git', args, { encoding: 'utf8', cwd: process.cwd() });
}

// Merge-base (not HEAD) as the diff root: a bare `diff base HEAD` would miss
// uncommitted work, and this check needs to see it while it is still local.
export function changedFiles(options: { git?: GitRunner } = {}): string[] {
	const git = options.git ?? runGit;
	const base = git(['merge-base', 'origin/main', 'HEAD']).trim();
	const diff = git(['diff', '--name-only', '--diff-filter=d', base]);
	return diff.split('\n').filter((line) => line.length > 0);
}
