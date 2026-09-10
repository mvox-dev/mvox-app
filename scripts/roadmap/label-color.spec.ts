/**
 * #307 RED — label chip colour math.
 *
 * Contract for a new pure module `scripts/roadmap/label-color.ts`:
 *
 *   relativeLuminance(hex: string): number
 *     WCAG 2.x relative luminance of a 6-digit hex colour WITHOUT the
 *     leading `#` — exactly the format the GitHub REST API reports label
 *     colours in ("The hexadecimal color code for the label, without the
 *     leading #"). Each sRGB channel c in [0,1] linearizes as
 *     c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4, then
 *     L = 0.2126*R + 0.7152*G + 0.0722*B.
 *
 *   labelTextColor(hex: string): string
 *     '#000000' when relativeLuminance(hex) > 0.179, else '#ffffff'.
 *     The 0.179 crossover is where (L+0.05)/(0+0.05) = 4.5 — i.e. the
 *     background is the lightest colour that still gives pure-black text
 *     WCAG AA 4.5:1 contrast. GitHub's own threshold is undocumented;
 *     this one is stated and grounded in the WCAG math.
 *
 * Pinned against the LIVE mvox-app palette (verified via gh api 2026-09-10):
 * the two named worst cases from #307 — blocked #b60205 and wontfix #ffffff —
 * plus one clear mid-range colour on each side of the threshold
 * (epic #6f42c1, L≈0.111 → light text; enhancement #a2eeef, L≈0.750 → dark text).
 *
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import { labelTextColor, relativeLuminance } from './label-color';

describe('relativeLuminance', () => {
	it('is 1 for white and 0 for black — the anchors of the scale', () => {
		expect(relativeLuminance('ffffff')).toBeCloseTo(1, 5);
		expect(relativeLuminance('000000')).toBeCloseTo(0, 5);
	});

	it('computes the WCAG value for blocked #b60205 (the dark worst case)', () => {
		expect(relativeLuminance('b60205')).toBeCloseTo(0.1, 2);
	});

	it('computes the WCAG value for epic #6f42c1', () => {
		expect(relativeLuminance('6f42c1')).toBeCloseTo(0.111, 2);
	});
});

describe('labelTextColor', () => {
	it('picks light text on blocked #b60205 — worst case named by #307', () => {
		expect(labelTextColor('b60205')).toBe('#ffffff');
	});

	it('picks dark text on wontfix #ffffff — the other named worst case', () => {
		expect(labelTextColor('ffffff')).toBe('#000000');
	});

	it('picks light text on a mid-range dark colour (epic #6f42c1)', () => {
		expect(labelTextColor('6f42c1')).toBe('#ffffff');
	});

	it('picks dark text on a mid-range light colour (enhancement #a2eeef)', () => {
		expect(labelTextColor('a2eeef')).toBe('#000000');
	});

	it('picks dark text on in-process #95ea29 — light green from the live palette', () => {
		expect(labelTextColor('95ea29')).toBe('#000000');
	});
});
