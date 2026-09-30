import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { findSourceFiles } from './soleLiteralGuard';

let root = '';

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'find-source-'));
	for (const dir of ['lib/paraglide', 'lib/a', 'routes']) mkdirSync(join(root, dir), { recursive: true });
	for (const file of [
		'lib/a/x.ts',
		'lib/a/x.spec.ts',
		'lib/a/X.svelte',
		'lib/a/notes.md',
		'lib/paraglide/messages.ts',
		'routes/+page.svelte'
	]) {
		writeFileSync(join(root, file), '');
	}
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const found = (...args: Parameters<typeof findSourceFiles>) =>
	findSourceFiles(...args)
		.map((f) => relative(root, f))
		.sort();

describe('findSourceFiles', () => {
	it('lists every file with a matching extension, specs and generated dirs included', () => {
		expect(found(root, ['.ts', '.svelte'])).toEqual([
			'lib/a/X.svelte',
			'lib/a/x.spec.ts',
			'lib/a/x.ts',
			'lib/paraglide/messages.ts',
			'routes/+page.svelte'
		]);
	});

	it('drops specs with excludeSpecs', () => {
		expect(found(root, ['.ts'], { excludeSpecs: true })).toEqual([
			'lib/a/x.ts',
			'lib/paraglide/messages.ts'
		]);
	});

	it('does not descend into a skipped directory name', () => {
		expect(found(root, ['.ts', '.svelte'], { excludeSpecs: true, skipDirs: ['paraglide'] })).toEqual(
			['lib/a/X.svelte', 'lib/a/x.ts', 'routes/+page.svelte']
		);
	});
});
