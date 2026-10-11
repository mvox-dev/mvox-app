// Runs scripts/ci/notes-only.sh on path lists: true only when every changed path is under teams/mvox-dev/memory/ or inboxes/.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/ci/notes-only.sh');

function verdict(paths: string[]): string {
	const run = spawnSync('bash', [script], {
		input: paths.length ? paths.join('\n') + '\n' : '',
		encoding: 'utf8'
	});
	expect(run.status).toBe(0);
	return run.stdout;
}

describe('notes-only.sh', () => {
	it('is true when every path is under memory/ or inboxes/', () => {
		expect(verdict(['teams/mvox-dev/memory/josquin.md', 'teams/mvox-dev/inboxes/a.json'])).toBe(
			'true\n'
		);
	});

	it('is false for other teams/ paths', () => {
		expect(verdict(['teams/mvox-dev/memory/a.md', 'teams/mvox-dev/prompts/josquin.md'])).toBe(
			'false\n'
		);
		expect(verdict(['teams/mvox-dev/roster.json'])).toBe('false\n');
	});

	it('is false when a path outside teams/ is mixed in', () => {
		expect(verdict(['teams/mvox-dev/memory/josquin.md', 'src/app.ts'])).toBe('false\n');
	});

	it('is false for an empty list', () => {
		expect(verdict([])).toBe('false\n');
	});

	it('is false for paths that only look like teams/', () => {
		expect(verdict(['teamsx/a.md'])).toBe('false\n');
		expect(verdict(['src/teams/a.md'])).toBe('false\n');
	});
});
