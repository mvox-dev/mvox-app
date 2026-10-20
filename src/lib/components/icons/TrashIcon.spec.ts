// @vitest-environment happy-dom

// Contract: one aria-hidden <svg> with a viewBox, painted only in currentColor, optional class.

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
		expect((svg.textContent ?? '').trim()).toBe('');
		expect(container.innerHTML).not.toMatch(/[\u{1F5D1}\u{FE0E}\u{FE0F}]/u);
	});

	it('paints with currentColor ONLY — the parent text colour is the tint, no hard-coded colour', () => {
		const { container } = render(TrashIcon);
		const svg = container.querySelector('svg') as SVGElement;
		expect(
			svg.outerHTML,
			'fill/stroke must be currentColor so text-danger (or any parent tint) applies'
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

// (*MVOX:Tallis* — #238 RED: TrashIcon, the reusable currentColor SVG)
