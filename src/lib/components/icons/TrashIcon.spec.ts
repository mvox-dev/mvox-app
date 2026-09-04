// @vitest-environment happy-dom
//
// #238 RED — TrashIcon: the app's FIRST reusable inline-SVG icon component,
// and the #237 trial instance (one definition here; the #237 sweep spends it).
//
// WHY: emoji glyphs (🗑 U+1F5D1, ⚙ U+2699, …) resolve to the platform's
// colour-emoji font, whose glyphs carry a baked-in palette and IGNORE the CSS
// `color` property — so #236's "red trashcan" shipped grey on real screens.
// The U+FE0E text-presentation selector is NOT a fix (inconsistent platform
// support). An inline SVG drawn with `currentColor` inherits the parent's
// text colour, so the existing text-red-700/hover:text-red-800 utilities
// finally tint it — no new palette entry, no per-site colour authoring.
//
// CONTRACT (GREEN must implement — src/lib/components/icons/TrashIcon.svelte,
// Svelte 5 runes):
//
//   RENDERS exactly one inline <svg> element:
//     - data-icon="trash" — the stable marker page suites use to prove the
//       rendered glyph IS this component (one definition, not a re-inlined
//       copy; page.agenda-admin.spec.ts asserts the same marker on the route)
//     - aria-hidden="true" — decorative ALWAYS; the accessible name belongs
//       to the wrapping control (the trashcan button's aria-label), never to
//       the icon
//     - a viewBox, so the icon scales to whatever box its class sizes it to
//     - every painted colour is `currentColor` (fill and/or stroke) — NO
//       hard-coded colour anywhere; the PARENT's text colour is the tint
//     - draws paths/shapes only: NO text content, NO emoji fallback glyph
//
//   PROPS
//     class  optional — landed onto the <svg> verbatim (sizing hook for the
//            #237 sweep's differently-sized call sites)

import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import TrashIcon from './TrashIcon.svelte';

afterEach(() => {
	cleanup();
});

describe('TrashIcon — reusable tintable trashcan (#238, the #237 trial)', () => {
	it('renders exactly one <svg>: data-icon="trash", aria-hidden, viewBox, glyph-free', () => {
		const { container } = render(TrashIcon);
		const svgs = container.querySelectorAll('svg');
		expect(svgs, 'exactly one svg root, nothing wrapped around it').toHaveLength(1);
		const svg = svgs[0];
		expect(svg.getAttribute('data-icon')).toBe('trash');
		expect(svg.getAttribute('aria-hidden'), 'decorative always').toBe('true');
		expect(svg.getAttribute('viewBox'), 'must scale by viewBox, not fixed pixels').toBeTruthy();
		// An SVG icon draws paths — it must not smuggle the emoji back in as a
		// text node, and it renders no visible text of its own.
		expect((svg.textContent ?? '').trim()).toBe('');
		expect(container.innerHTML).not.toMatch(/[\u{1F5D1}\u{FE0E}\u{FE0F}]/u);
	});

	it('paints with currentColor ONLY — the parent text colour is the tint, no hard-coded colour', () => {
		const { container } = render(TrashIcon);
		const svg = container.querySelector('svg') as SVGElement;
		expect(
			svg.outerHTML,
			'fill/stroke must be currentColor so text-red-700 (or any parent tint) applies'
		).toContain('currentColor');
		expect(svg.outerHTML, 'no hex colours baked in').not.toMatch(/#[0-9a-fA-F]{3,8}/);
		expect(svg.outerHTML, 'no named/functional colours baked in').not.toMatch(
			/(?:fill|stroke)\s*[:=]\s*["']?(?!currentColor|none)[a-z]/i
		);
	});

	it('a class prop lands on the <svg> — the sizing hook reusing call sites need', () => {
		const { container } = render(TrashIcon, { props: { class: 'h-4 w-4' } });
		const svg = container.querySelector('svg') as SVGElement;
		expect(Array.from(svg.classList)).toContain('h-4');
		expect(Array.from(svg.classList)).toContain('w-4');
	});
});

// (*MVOX:Tallis* — #238 RED: TrashIcon, the reusable currentColor SVG replacing
// the untintable 🗑 emoji; trial instance for the #237 icon sweep.)
