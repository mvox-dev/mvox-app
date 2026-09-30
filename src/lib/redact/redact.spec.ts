// jsdom cannot screenshot, so the overlay is pinned by its literal CSS; pixels are checked by hand.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';

const appCss = () => readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf-8');

describe('marker constants — a data- attribute, not a CSS class (#357)', () => {
	it("REDACT_ATTR is 'data-redact'", () => {
		expect(REDACT_ATTR).toBe('data-redact');
	});

	it("REDACT_TOGGLE_ATTR is 'data-redacting' — the human-set root toggle on <html>", () => {
		expect(REDACT_TOGGLE_ATTR).toBe('data-redacting');
	});
});

describe('the CSS mechanism in src/app.css — pinned by literal string (the page-shell.ts house pattern)', () => {
	it('carries the base rule: html[data-redacting] [data-redact] gets position: relative (the anchor for the overlay)', () => {
		const match = appCss().match(/html\[data-redacting\] \[data-redact\]\s*\{([^}]*)\}/);
		expect(match, 'rule `html[data-redacting] [data-redact] { ... }` must exist').not.toBeNull();
		expect(match![1]).toContain('position: relative');
	});

	it('carries the pseudo-element overlay block: an opaque hatch that reads as DELIBERATELY REMOVED, not blank', () => {
		const match = appCss().match(/html\[data-redacting\] \[data-redact\]::after\s*\{([^}]*)\}/);
		expect(
			match,
			'rule `html[data-redacting] [data-redact]::after { ... }` must exist'
		).not.toBeNull();
		const block = match![1];
		expect(block, 'a pseudo-element needs content to render').toMatch(/content: ['"]{2}/);
		expect(block).toContain('position: absolute');
		expect(block).toContain('inset: 0');
		expect(block, 'the hatch — a stripe pattern, not a flat blank').toContain(
			'repeating-linear-gradient'
		);
		expect(block, 'house ink tokens, never stock Tailwind hues').toContain('var(--color-ink)');
		expect(block).toContain('var(--color-ink-2)');
	});

	it('the selectors are DEFAULT-INERT by construction: every redaction rule requires the html[data-redacting] root toggle', () => {
		// An unguarded rule would leak redaction styling into normal rendering and
		// change every existing PII-value spec's output.
		const unguarded = appCss()
			.split('\n')
			.filter((l) => l.includes('[data-redact]') && !l.includes('html[data-redacting]'));
		expect(unguarded).toEqual([]);
	});
});

// (*MVOX:Tallis*)
