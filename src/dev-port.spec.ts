// #347 RED — the Spaces bucket's GET allowlist admits http://localhost:3000
// and no other local origin (Argo's convention — verified 2026-09-14:
// localhost:5173 preflights 403). Vite's default port is 5173, and when its
// chosen port is taken Vite's default is to increment to the next free one —
// so `port: 3000` alone can silently drift to 3001, where the bucket 403s and
// the developer sees a CORS error instead of a port error. Two config lines
// fix both halves:
//
//   1. `server: { port: 3000, strictPort: true }` — strictPort is the part
//      that matters: refuse to start rather than drift. A refusal naming the
//      port is a five-second diagnosis; a CORS error caused by port drift is
//      an afternoon.
//   2. A comment at the site names WHY 3000 — the allowlist makes the port an
//      external contract, not a preference.
//   3. Nothing else moves — no build/preview/test port config appears.
//
// Config-shape pin per the ios-form-zoom precedent: assert on the READ SOURCE
// of vite.config.ts, not an import — importing the config would drag the
// sveltekit/tailwind/paraglide plugins into the test env.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '..', 'vite.config.ts'), 'utf-8');

/** Source with all line and block comments removed. */
function stripComments(src: string): string {
	return src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
}

/** All line and block comments in the source, concatenated. */
function comments(src: string): string {
	return [...src.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)].map((m) => m[0]).join('\n');
}

/** Span of the first `<key>: { ... }` in `src`, brace-matched; null if absent. */
function blockSpan(src: string, key: string): { start: number; end: number } | null {
	const m = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(src);
	if (!m) return null;
	const start = src.indexOf('{', m.index);
	let depth = 0;
	for (let i = start; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) return { start: m.index, end: i + 1 };
	}
	return null;
}

const code = stripComments(source);
const serverSpan = blockSpan(code, 'server');
const serverBody = serverSpan ? code.slice(serverSpan.start, serverSpan.end) : null;

describe('#347 dev port — vite.config.ts pins the dev server to 3000, strictly', () => {
	it('declares a server block', () => {
		expect(
			serverBody,
			'expected vite.config.ts to declare a `server: { ... }` block — without one, `vite dev` takes the default port 5173, which the bucket allowlist rejects'
		).not.toBeNull();
	});

	it('pins port: 3000', () => {
		expect(
			serverBody ?? '',
			'expected the server block to set `port: 3000` — the only local origin the bucket allowlist admits'
		).toMatch(/\bport\s*:\s*3000\b/);
	});

	it('sets strictPort: true — refuse to start rather than drift and surface as CORS', () => {
		expect(
			serverBody ?? '',
			'expected the server block to set `strictPort: true` — without it, an occupied 3000 silently becomes 3001, the bucket 403s, and the failure masquerades as an allowlist/CORS problem'
		).toMatch(/\bstrictPort\s*:\s*true\b/);
	});
});

describe('#347 dev port — the WHY lives at the site', () => {
	// The port is an external contract (Argo allowlisted exactly this origin on
	// the bucket), not a preference — the comment must say so, or the next
	// editor "tidies" the pin away.
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

describe('#347 dev port — nothing else moves', () => {
	// Build, preview, and test port config were absent before and must stay
	// absent: strip the server block and assert no port config remains.
	const remainder = serverSpan
		? code.slice(0, serverSpan.start) + code.slice(serverSpan.end)
		: code;

	it('no preview block appears', () => {
		expect(
			remainder,
			'expected no `preview:` config — the preview port was never pinned and #347 does not touch it'
		).not.toMatch(/\bpreview\s*:/);
	});

	it('no port config outside the server block', () => {
		expect(
			remainder,
			'expected no `port:`/`strictPort` outside the server block — build/preview/test ports stay untouched'
		).not.toMatch(/\bport\s*:|\bstrictPort\b/);
	});
});

// (*MVOX:Tallis*)
