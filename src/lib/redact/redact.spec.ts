// #357 RED — the capture-redaction marker's definition module and its CSS
// mechanism. Two live invite bearer tokens reached chat through screenshots;
// a screenshot has no field names, only pixels — so sensitive elements must
// be visibly blanked in the DOM BEFORE the capture, and the capture runs
// against the blanked DOM.
//
// CONTRACT (GREEN must implement — src/lib/redact/redact.ts):
//
//   export const REDACT_ATTR = 'data-redact';
//     The marker for elements whose rendered value must not be captured. A
//     data- attribute, NOT a plain CSS class — its only purpose is to be
//     legible at the point of removal, and a class in a stylesheet reads as
//     styling (#357 body). Distinct from memberRecord.ts's
//     DEFAULT_REDACT_FIELDS (#282), which is server-side Entu readback
//     masking — this marker is a client capture-time concern only.
//
//   export const REDACT_TOGGLE_ATTR = 'data-redacting';
//     The root toggle, set on <html> by a HUMAN before taking a screenshot
//     (devtools: document.documentElement.setAttribute('data-redacting', '')).
//     No shipped UI control in this slice — #292, the real capture path, owns
//     wiring a visible engage control later. DEFAULT-INERT is load-bearing:
//     without the toggle the marker has NO rendering effect whatsoever.
//
//   CSS mechanism in src/app.css (pure CSS — no JS, no DOM mutation, NO new
//   i18n strings, so no Comenius surface):
//     html[data-redacting] [data-redact]           → position: relative
//     html[data-redacting] [data-redact]::after    → an opaque hatch overlay
//       (content + absolute inset-0 + repeating-linear-gradient over the
//       house ink tokens), so a redacted field reads as DELIBERATELY REMOVED
//       in the captured image, never as merely empty (#357: a reader must be
//       able to tell a redaction from a blank field).
//   A pseudo-element overlay cannot render on a replaced element like
//   <input>, which is WHY the marker sits on a wrapping element around the
//   value-bearing control (see RedactedField.spec.ts).
//
//   THE LIMIT, stated where you meet it (the byteStore.ts:1-14 /
//   page-shell.ts:1-9 carrying-the-limit pattern): the doc block beside the
//   marker's definition must enumerate the channels the marker does NOT
//   cover, verbatim from #357 — title attributes and tooltips, aria-label,
//   placeholder text, the browser's own autofill dropdown, the document
//   <title>, and the URL — and must state that the marker covers rendered
//   element content and nothing else, and that nothing claims a marked page
//   is a guaranteed-clean capture. Pinned below as literal strings so the
//   limit cannot silently rot out of the module.
//
//   Invite-link row (#357's second listed surface): since #360 the composed
//   invite URL is copy-only and never rendered into the DOM on ANY surface
//   (InviteSurface and the roster row both lost their readonly inputs), so
//   there is no rendered element to mark — the doc block must say so, so a
//   reader looking for the invite marker finds the reason instead of a gap.
//
// jsdom/happy-dom cannot screenshot: the PIXEL claim (overlay actually
// covers the value in a capture) rides the manual capture checklist in the
// landing comment. What CAN be pinned mechanically is pinned here: the
// constants, the literal CSS rule, and the limit prose.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';

const redactSource = () => readFileSync(resolve(process.cwd(), 'src/lib/redact/redact.ts'), 'utf-8');
const appCss = () => readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf-8');

describe('marker constants — a data- attribute, not a CSS class (#357)', () => {
	it("REDACT_ATTR is 'data-redact'", () => {
		expect(REDACT_ATTR).toBe('data-redact');
	});

	it("REDACT_TOGGLE_ATTR is 'data-redacting' — the human-set root toggle on <html>", () => {
		expect(REDACT_TOGGLE_ATTR).toBe('data-redacting');
	});
});

describe('the uncovered channels are documented BESIDE the marker definition — not in a PR description, not in a separate markdown file', () => {
	it('states the coverage boundary: rendered element content and nothing else', () => {
		expect(redactSource()).toContain(
			'The marker covers rendered element content and nothing else'
		);
	});

	it('enumerates every uncovered channel from #357 verbatim', () => {
		const src = redactSource();
		expect(src, 'title/tooltip channel').toContain('title attributes and tooltips');
		expect(src, 'aria-label channel').toContain('aria-label');
		expect(src, 'placeholder channel').toContain('placeholder text');
		expect(src, 'autofill channel (rendered above the page, outside the DOM)').toContain(
			'autofill'
		);
		expect(src, 'document title channel').toContain('document <title>');
		expect(src, 'URL channel (carries entity ids)').toContain('the URL');
	});

	it('claims NO guaranteed-clean capture — the closing line of the limit', () => {
		expect(redactSource()).toContain(
			'Nothing here claims a marked page is a guaranteed-clean capture'
		);
	});

	it("explains the invite-link row's absence: #360 made invite links copy-only, never rendered — no element exists to mark", () => {
		const src = redactSource();
		expect(src).toContain('#360');
		expect(src).toContain('copy-only');
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
		// No rule in app.css may style [data-redact] WITHOUT the root-toggle
		// guard — an unguarded rule would leak redaction styling into normal
		// rendering, breaking the default-inert contract that keeps every
		// existing PII-value spec byte-unmodified.
		const unguarded = appCss()
			.split('\n')
			.filter((l) => l.includes('[data-redact]') && !l.includes('html[data-redacting]'));
		expect(unguarded).toEqual([]);
	});
});
