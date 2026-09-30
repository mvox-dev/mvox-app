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
// Plural stems, an optional hyphen, and a trailing \w* on purpose: the narration
// is as often pluralised, hyphenated, or numbered with a suffix or range, all of
// which a closing \b lets pass. The shapes are pinned in commentRules.spec.ts.
const REVIEW_HISTORY = /\b(review[ -]rounds?|findings? \d+|slices? \d+)\w*/i;
const CODE_FILE = /\.(ts|mts|cts|js|mjs|cjs|svelte)$/;

interface LineKind {
	// Whole-line comment: what the run-length and share rules count.
	isComment: boolean;
	// The comment on the line, whole-line or trailing, '' when there is none.
	commentText: string;
}

// A trailing newline splits into a phantom empty final element; drop it here
// so callers count real lines only, once.
export function splitLines(source: string): string[] {
	const lines = source.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

// Quoted spans hide comment openers — `'https://x'` opens nothing — so walk the
// line and step over ' " ` spans before looking. An unterminated quote consumes
// the rest of the line, which reports no comment rather than a phantom one.
function trailingComment(line: string, markup: boolean): string {
	if (markup) {
		const opener = line.indexOf('<!--');
		return opener === -1 ? '' : line.slice(opener);
	}

	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === "'" || ch === '"' || ch === '`') {
			i++;
			while (i < line.length && line[i] !== ch) i += line[i] === '\\' ? 2 : 1;
			i++;
			continue;
		}
		if (ch === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) return line.slice(i);
		i++;
	}
	return '';
}

function leavesBlockOpen(commentText: string, markup: boolean): boolean {
	const [open, close] = markup ? ['<!--', '-->'] : ['/*', '*/'];
	return (
		commentText.startsWith(open) && commentText.lastIndexOf(open) > commentText.lastIndexOf(close)
	);
}

// A whole-comment line: `// x`, or a line inside a `/* */` / `<!-- -->` span, in
// whichever syntax its .svelte region (script/style/markup) uses. Code with a
// trailing `// note` is not one, but that note is still comment text.
function classifyLines(lines: string[], isSvelte: boolean): LineKind[] {
	const kinds: LineKind[] = [];
	let region: 'script' | 'style' | 'markup' = isSvelte ? 'markup' : 'script';
	let blockOpen = false;

	for (const line of lines) {
		const trimmed = line.trim();

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

		const markup = region === 'markup';

		if (blockOpen) {
			kinds.push({ isComment: true, commentText: line });
			if (trimmed.includes(markup ? '-->' : '*/')) blockOpen = false;
			continue;
		}

		const opensLine = markup
			? trimmed.startsWith('<!--')
			: trimmed.startsWith('//') || trimmed.startsWith('/*');

		if (opensLine) {
			kinds.push({ isComment: true, commentText: line });
			if (markup && !trimmed.slice(4).includes('-->')) blockOpen = true;
			if (!markup && trimmed.startsWith('/*') && !trimmed.slice(2).includes('*/'))
				blockOpen = true;
			continue;
		}

		const commentText = trailingComment(line, markup);
		kinds.push({ isComment: false, commentText });
		blockOpen = leavesBlockOpen(commentText, markup);
	}

	return kinds;
}

export function stripComments(source: string): string {
	const lines = source.split('\n');
	const kinds = classifyLines(lines, false);
	return lines
		.map((line, i) =>
			kinds[i].isComment ? '' : line.slice(0, line.length - kinds[i].commentText.length)
		)
		.join('\n');
}

// Two counting rules an author needs: CONSECUTIVE comment lines are one comment,
// so a compliant JSDoc touching a `//` directive reads as a single over-long run
// and a blank line between them is the fix; a block counts every line it spans.
export function checkCommentRules(file: string, source: string): CommentViolation[] {
	const lines = splitLines(source);
	const kinds = classifyLines(lines, file.endsWith('.svelte'));
	const violations: CommentViolation[] = [];

	let runStart = -1;
	for (let i = 0; i <= lines.length; i++) {
		const inRun = i < lines.length && kinds[i].isComment;
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
					detail: `${runLength} consecutive comment lines read as one comment, over the ${MAX_COMMENT_RUN}-line limit (a blank line splits them)`
				});
			}
			runStart = -1;
		}
	}

	// The content rules read comment TEXT, so a comment trailing code is caught
	// too: #506 bans narration from the source outright. The code it trails is
	// not part of the comment, hence not part of its length.
	for (let i = 0; i < lines.length; i++) {
		const text = kinds[i].commentText;
		if (text === '') continue;
		if (text.length > MAX_LINE_LENGTH) {
			violations.push({
				file,
				rule: 'line-too-long',
				line: i + 1,
				detail: `comment is ${text.length} characters, over the ${MAX_LINE_LENGTH}-character limit`
			});
		}
		if (REVIEW_HISTORY.test(text)) {
			violations.push({
				file,
				rule: 'review-history',
				line: i + 1,
				detail: 'comment reads as review-history narration, not why the code is this way'
			});
		}
	}

	// One comment line at the top of a file says what the file is, so it is outside the share.
	const top = lines.findIndex((line) => line.trim() !== '');
	const counted = (i: number) => kinds[i].isComment && i !== top;
	const commentCount = kinds.filter((_, i) => counted(i)).length;
	if (lines.length > 0 && commentCount / lines.length >= MAX_COMMENT_SHARE) {
		const firstCommentLine = kinds.findIndex((_, i) => counted(i));
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
export function changedFiles(options: { git?: GitRunner; diffFilter?: string } = {}): string[] {
	const git = options.git ?? runGit;
	const base = git(['merge-base', 'origin/main', 'HEAD']).trim();
	const diff = git(['diff', '--name-only', `--diff-filter=${options.diffFilter ?? 'd'}`, base]);
	return diff.split('\n').filter((line) => line.length > 0);
}
