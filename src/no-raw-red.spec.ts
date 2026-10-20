// #967 — error colour comes from the theme (`danger`, `danger-strong`,
// `danger-soft`), never from Tailwind's stock red scale. (*MVOX:Josquin*)
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname);
const RAW_RED = /[a-z]-red-\d/;

function sources(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && /\.(svelte|ts|css)$/.test(d.name) && !d.name.endsWith('.spec.ts'))
		.map((d) => join(d.parentPath, d.name));
}

describe('#967 — no stock red-<shade> utility in src', () => {
	it('scans a non-empty set of sources', () => {
		expect(sources().length).toBeGreaterThan(50);
	});

	it('uses the danger tokens instead of red-<shade> classes', () => {
		const offenders = sources().flatMap((file) =>
			readFileSync(file, 'utf-8')
				.split('\n')
				.flatMap((line, i) => (RAW_RED.test(line) ? [`${relative(SRC_ROOT, file)}:${i + 1}`] : []))
		);
		expect(offenders).toEqual([]);
	});

	it('defines the three danger tokens in the theme', () => {
		const css = readFileSync(join(SRC_ROOT, 'app.css'), 'utf-8');
		for (const t of ['--color-danger:', '--color-danger-strong:', '--color-danger-soft:']) {
			expect(css).toContain(t);
		}
	});
});
