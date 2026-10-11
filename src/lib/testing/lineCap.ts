import { COMMENT_FIXTURES_DIR, splitLines } from './commentRules';

export const STEP = 400;

// Shrink-only: each file leaves when its split lands.
export const LINE_CAP_EXCEPTIONS: readonly string[] = [];

const FIXTURE_DIRS = [COMMENT_FIXTURES_DIR, 'src/lib/testing/line-cap-fixtures/'];
const SOURCE_FILE = /\.(ts|svelte)$/;

export type LineCounts = Readonly<Record<string, number>>;

export interface CapViolation {
	file: string;
	lines: number;
	reason: 'over-cap' | 'exception-within-cap';
}

export function countLines(source: string): number {
	return splitLines(source).length;
}

export function selectSourceFiles(paths: string[]): string[] {
	return paths.filter(
		(path) =>
			path.startsWith('src/') &&
			SOURCE_FILE.test(path) &&
			!path.endsWith('.spec.ts') &&
			!FIXTURE_DIRS.some((dir) => path.startsWith(dir))
	);
}

export function capViolations(counts: LineCounts, exceptions: readonly string[]): CapViolation[] {
	const over: CapViolation[] = Object.entries(counts)
		.filter(([file, lines]) => lines > STEP && !exceptions.includes(file))
		.map(([file, lines]) => ({ file, lines, reason: 'over-cap' }));
	const within: CapViolation[] = exceptions
		.filter((file) => (counts[file] ?? 0) <= STEP)
		.map((file) => ({ file, lines: counts[file] ?? 0, reason: 'exception-within-cap' }));
	return [...over, ...within].sort((a, b) => a.file.localeCompare(b.file));
}
