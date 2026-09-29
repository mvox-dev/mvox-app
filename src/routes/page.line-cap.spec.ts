// The agenda page and the modules split out of it stay small enough to read whole.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
	const lines = readFileSync(path, 'utf-8').split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	return lines.length;
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
