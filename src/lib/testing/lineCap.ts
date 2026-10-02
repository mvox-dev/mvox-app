import { COMMENT_FIXTURES_DIR, changedFiles, splitLines, type GitRunner } from './commentRules';

export const STEP = 500;
export const NEXT_STEP = 400;

// Shrink-only: each file leaves when its split lands.
export const LINE_CAP_EXCEPTIONS: readonly string[] = [
	'src/lib/sections/sectionActions.ts',
	'src/routes/+page.svelte'
];

export const LINE_CAP_REGISTER: readonly string[] = [
	'src/lib/agenda/SeriesCreateForm.svelte',
	'src/lib/components/StrokeSurface.svelte',
	'src/lib/components/admin/InviteSurface.svelte',
	'src/lib/events/EventRsvpSection.svelte',
	'src/lib/roster/memberLifecycle.ts',
	'src/lib/sections/sectionActions.ts',
	'src/routes/+page.svelte',
	'src/routes/part/[fileId]/+page.svelte'
];

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

export function registerMismatch(
	counts: LineCounts,
	register: readonly string[]
): { missing: string[]; stale: string[] } {
	const missing = Object.entries(counts)
		.filter(([file, lines]) => lines > NEXT_STEP && !register.includes(file))
		.map(([file]) => file)
		.sort();
	const stale = register.filter((file) => (counts[file] ?? 0) <= NEXT_STEP).sort();
	return { missing, stale };
}

export function addedOverNextStep(
	added: string[],
	counts: LineCounts
): Array<{ file: string; lines: number }> {
	return added
		.map((file) => ({ file, lines: counts[file] ?? 0 }))
		.filter(({ lines }) => lines > NEXT_STEP);
}

export function addedFiles(options: { git?: GitRunner } = {}): string[] {
	return changedFiles({ ...options, diffFilter: 'A' });
}
