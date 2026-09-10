/**
 * #307 — label chip colour math.
 *
 * Pure, dependency-free WCAG 2.x relative-luminance helper used to pick a
 * readable text colour for a chip painted in an arbitrary label colour.
 * Kept apart from render.ts because it is its own well-defined spec (a
 * formula with named worst cases), not board-rendering logic.
 *
 * (*MVOX:Palestrina*)
 */

/** One sRGB channel in [0, 255] linearized per the WCAG relative-luminance formula. */
function linearize(channel: number): number {
	const c = channel / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 2.x relative luminance of a 6-digit hex colour, WITHOUT the leading
 * `#` — exactly the format the GitHub REST API reports label colours in
 * ("The hexadecimal color code for the label, without the leading #").
 */
export function relativeLuminance(hex: string): number {
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Text colour to paint on a chip whose background is `hex`.
 *
 * Threshold: black text (`#000000`) once relativeLuminance(hex) > 0.179,
 * white (`#ffffff`) otherwise. 0.179 is where (L + 0.05) / (0 + 0.05) = 4.5 —
 * the lightest background that still gives pure-black text WCAG AA 4.5:1
 * contrast. GitHub does not publish its own label-text-colour threshold;
 * this one is stated and grounded in the WCAG contrast-ratio math rather
 * than picked by eye.
 */
export function labelTextColor(hex: string): string {
	return relativeLuminance(hex) > 0.179 ? '#000000' : '#ffffff';
}
