// #408 — the maskable icon's safe zone, measured on the COMMITTED PNG.
//
// The W3C manifest spec defines the maskable safe zone as a CIRCLE: "center
// point in the center of the icon and with a radius of 2/5 (40%) of the icon
// size" (https://w3c.github.io/manifest/). Only that circle is guaranteed to
// survive whatever mask the OS applies — Android's round mask is the common
// one — so any ink outside it may be shaved off the home-screen icon.
//
// A centred 80% SQUARE is NOT that circle: its corners sit 0.566 of the canvas
// from the centre. Fitting the mark's bounding box into such a square (the
// first cut of scripts/icons/render-icons.ts) pushed 7% of the mark's ink past
// the radius and the M's top-right arm tip out to r = 256.9 px on a 512 canvas
// — outside even the full inscribed circle. Nothing in the suite measured icon
// geometry, so that was invisible to the gates; this spec is that instrument.
//
// It decodes the committed file rather than re-rasterising mvox-mark.svg on
// the fly: the artefact that ships is the thing under test.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { decodePng, maxInkRadius } from '$lib/testing/pngPixels';

const iconsDir = resolve(__dirname, '../static/icons');

// The two colours render-icons.ts draws with (--color-ink / --color-paper in
// src/app.css). "Ink" is anything darker than their luminance midpoint, so
// antialiased edge pixels are not counted as mark.
const INK_LUMINANCE = 0.299 * 0x2a + 0.587 * 0x26 + 0.114 * 0x20;
const PAPER_LUMINANCE = 0.299 * 0xf7 + 0.587 * 0xf1 + 0.114 * 0xe1;
const INK_THRESHOLD = (INK_LUMINANCE + PAPER_LUMINANCE) / 2;

// W3C: radius 2/5 of the icon size.
const SAFE_ZONE_RADIUS_FRACTION = 2 / 5;

function measure(fileName: string): { size: number; maxRadius: number; safeRadius: number } {
	const png = decodePng(readFileSync(resolve(iconsDir, fileName)));
	expect(png.width, `${fileName} is not square`).toBe(png.height);
	return {
		size: png.width,
		maxRadius: maxInkRadius(png, INK_THRESHOLD),
		safeRadius: png.width * SAFE_ZONE_RADIUS_FRACTION
	};
}

describe('static/icons/icon-maskable-512.png — W3C safe zone (#408)', () => {
	it('is the 512 canvas the manifest declares, and carries ink', () => {
		const { size, maxRadius } = measure('icon-maskable-512.png');
		expect(size).toBe(512);
		// Guards the measurement itself: a blank or undecoded icon would pass the
		// radius assertion below for the wrong reason.
		expect(maxRadius).toBeGreaterThan(0);
	});

	it('keeps ALL of the mark inside the safe circle (radius 40% of the icon)', () => {
		const { maxRadius, safeRadius } = measure('icon-maskable-512.png');
		expect(
			maxRadius,
			`furthest ink sits ${maxRadius.toFixed(1)}px from centre, outside the ${safeRadius}px safe circle — a round OS mask would crop it`
		).toBeLessThanOrEqual(safeRadius);
	});

	it('still fills most of the safe circle — inscribed, not shrunk to a dot', () => {
		const { maxRadius, safeRadius } = measure('icon-maskable-512.png');
		expect(maxRadius / safeRadius).toBeGreaterThan(0.85);
	});
});

describe('static/icons — the safe-zone measurement discriminates (#408)', () => {
	// Without this, "inside the circle" could be an artefact of a broken
	// measurement that finds no ink anywhere. The `any`-purpose icons are drawn
	// to a different rule on purpose (REGULAR_FIT fills 84% of the square, and
	// nothing crops them), so their ink MUST fall outside the same circle. If
	// this ever starts passing, the instrument stopped working.
	for (const fileName of ['icon-512.png', 'icon-192.png', 'apple-touch-icon-180.png']) {
		it(`${fileName} is unmasked artwork — its ink does leave the safe circle`, () => {
			const { maxRadius, safeRadius } = measure(fileName);
			expect(maxRadius).toBeGreaterThan(safeRadius);
		});
	}
});
