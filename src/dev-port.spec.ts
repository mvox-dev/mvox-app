// The bucket allowlist admits localhost:3000 only, so the dev server must never drift to 3001.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../vite.config';

const source = readFileSync(resolve(__dirname, '..', 'vite.config.ts'), 'utf-8');

/** All line and block comments in the source, concatenated. */
function comments(src: string): string {
	return [...src.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)].map((m) => m[0]).join('\n');
}

describe('#347 dev port — the dev server is pinned to 3000, strictly', () => {
	it('serves on port 3000 and refuses to start when it is taken', () => {
		expect(config.server).toEqual({ port: 3000, strictPort: true });
	});

	it('pins no preview port', () => {
		expect(config.preview).toBeUndefined();
	});
});

describe('#347 dev port — the WHY lives at the site', () => {
	// Fence, by design: the next editor must meet the allowlist reason before tidying the pin away.
	it('a comment names the bucket allowlist as the reason for 3000', () => {
		const c = comments(source);
		expect(
			c,
			'expected a comment naming http://localhost:3000 as the allowlisted origin'
		).toContain('http://localhost:3000');
		expect(
			c,
			"expected the comment to name the bucket's GET allowlist — the external contract that makes 3000 non-negotiable"
		).toMatch(/allowlist/i);
	});
});

// (*MVOX:Tallis*)
