// #463 RED — "Taustamuster ei liigu enam": the DeskSurface wood background
// must stand still. Mihkel (2026-09-23, verbatim in the issue body): the CSS
// background animation is too heavy for some users — disable it. The gradients
// stay exactly where they start; nothing else about the page changes.
//
// House pattern for CSS/markup facts on a component: read the .svelte SOURCE
// and assert on its text (precedent: page.roster-redaction.spec.ts,
// page.library.spec.ts). No mount + computed-style specs exist in this repo.
//
//   (1) NO ANIMATION — no `animation`/`animation-*` property and no
//       @keyframes anywhere in the <style> block. (RED: today the block
//       declares wood-orbit1/2/3 and three @keyframes.)
//   (2) STARTING POSITIONS KEPT — the six static --dx/--dy declarations on
//       .wood-bg stay, at exactly today's frame-0 values (each orbit's 0%
//       keyframe equals these, so the frozen surface looks the same).
//   (3) OFFSETS STILL APPLIED — the three gradient centres still read
//       calc(-4800px + var(--dxN)), so the static values keep holding the
//       gradients where they start.
//   (4) NOTHING ELSE CHANGES — background-attachment: fixed stays.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
	resolve(process.cwd(), 'src/lib/components/DeskSurface.svelte'),
	'utf-8'
);

const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/);
const style = styleMatch?.[1] ?? '';

describe('#463 — DeskSurface background stands still', () => {
	it('has a <style> block to assert against', () => {
		expect(styleMatch, 'DeskSurface.svelte must contain a <style>…</style> block').not.toBeNull();
		expect(style.length).toBeGreaterThan(0);
	});

	it('declares no animation property and no @keyframes in the style block', () => {
		expect(
			style,
			'no `animation:` / `animation-*:` declaration may remain — the background must not move'
		).not.toMatch(/\banimation(-[a-z]+)?\s*:/);
		expect(
			style,
			'no @keyframes may remain — dead once nothing animates'
		).not.toContain('@keyframes');
	});

	it('keeps the six static --dx/--dy starting values on .wood-bg', () => {
		// Each orbit's 0% keyframe equalled these values, so the frozen surface
		// renders byte-identical to today's frame-0 look.
		expect(style, '--dx1 stays at 10px').toMatch(/--dx1\s*:\s*10px/);
		expect(style, '--dy1 stays at 0px').toMatch(/--dy1\s*:\s*0px/);
		expect(style, '--dx2 stays at -5px').toMatch(/--dx2\s*:\s*-5px/);
		expect(style, '--dy2 stays at 8.66px').toMatch(/--dy2\s*:\s*8\.66px/);
		expect(style, '--dx3 stays at -5px').toMatch(/--dx3\s*:\s*-5px/);
		expect(style, '--dy3 stays at -8.66px').toMatch(/--dy3\s*:\s*-8\.66px/);
	});

	it('still positions the three ring layers through calc(-4800px + var(--dxN))', () => {
		expect(style, 'ring layer 1 centre keeps its offset').toMatch(
			/calc\(\s*-4800px\s*\+\s*var\(--dx1\)\s*\)/
		);
		expect(style, 'ring layer 2 centre keeps its offset').toMatch(
			/calc\(\s*-4800px\s*\+\s*var\(--dx2\)\s*\)/
		);
		expect(style, 'ring layer 3 centre keeps its offset').toMatch(
			/calc\(\s*-4800px\s*\+\s*var\(--dx3\)\s*\)/
		);
	});

	it('keeps background-attachment: fixed (nothing else about the page changes)', () => {
		expect(style).toMatch(/background-attachment\s*:\s*fixed/);
	});
});
