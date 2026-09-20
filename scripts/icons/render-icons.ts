// #408 — rasterises static/icons/mvox-mark.svg (the MV-ligature source of
// truth, committed verbatim from issue #408's body) into the PNGs the web
// app manifest and apple-touch-icon reference. The SVG is never redrawn;
// this script only reads its two <path> elements and its viewBox and draws
// them at pixel sizes resvg can rasterise.
//
// Run: PATH=~/.local/share/pnpm:$PATH pnpm exec tsx scripts/icons/render-icons.ts
//
// Idempotent: re-running produces byte-identical PNGs (fixed inputs, no
// randomness, no timestamps) — review verifies by re-running and checking
// `git status` shows no PNG change.
//
// Colours are read from src/app.css tokens; the values are pinned here as
// hex constants (this script does not parse CSS at run time) with the
// token names carried in the comments below so the two stay traceable.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLOR_PAPER = '#f7f1e1'; // --color-paper (src/app.css)
const COLOR_INK = '#2a2620'; // --color-ink (src/app.css)

// icon-192 / icon-512 / apple-touch-icon-180: the mark's bounding box is
// scaled to fill this fraction of the square canvas (a small margin, not a
// safe-zone reservation — nothing crops these).
const REGULAR_FIT = 0.84;
// icon-maskable-512: the OS applies its own mask shape and guarantees only
// the central 80% of the canvas survives (W3C maskable-icon safe zone), so
// the mark is scaled to fit inside that fraction instead.
const MASKABLE_SAFE_ZONE = 0.8;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(scriptDir, '../../static');
const iconsDir = resolve(staticDir, 'icons');

const svgSource = readFileSync(resolve(iconsDir, 'mvox-mark.svg'), 'utf-8');

const viewBoxMatch = svgSource.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
if (!viewBoxMatch) {
	throw new Error('mvox-mark.svg: no viewBox found');
}
const [, minXStr, minYStr, widthStr, heightStr] = viewBoxMatch;
const minX = Number(minXStr);
const minY = Number(minYStr);
const markWidth = Number(widthStr);
const markHeight = Number(heightStr);

const pathData = [...svgSource.matchAll(/<path d="([^"]+)"\/>/g)].map((match) => match[1]);
if (pathData.length !== 2) {
	throw new Error(`mvox-mark.svg: expected 2 <path> elements, found ${pathData.length}`);
}

/** Builds a flat SVG: an opaque background rect, then the mark centred and scaled to fit `fit` of the canvas. */
function buildIconSvg(canvasSize: number, fit: number, background: string, color: string): string {
	const scale = (canvasSize * fit) / Math.max(markWidth, markHeight);
	const markCenterX = minX + markWidth / 2;
	const markCenterY = minY + markHeight / 2;
	const translateX = canvasSize / 2 - scale * markCenterX;
	const translateY = canvasSize / 2 - scale * markCenterY;
	const paths = pathData.map((d) => `<path d="${d}"/>`).join('');
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">` +
		`<rect width="${canvasSize}" height="${canvasSize}" fill="${background}"/>` +
		`<g transform="translate(${translateX},${translateY}) scale(${scale})" fill="${color}">${paths}</g>` +
		`</svg>`
	);
}

function renderPng(svg: string, size: number): Buffer {
	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
	return resvg.render().asPng();
}

function writeIcon(fileName: string, svg: string, size: number): void {
	const png = renderPng(svg, size);
	const outPath = resolve(iconsDir, fileName);
	writeFileSync(outPath, png);
	console.log(`wrote ${outPath} (${png.length} bytes)`);
}

mkdirSync(iconsDir, { recursive: true });

writeIcon('icon-192.png', buildIconSvg(192, REGULAR_FIT, COLOR_PAPER, COLOR_INK), 192);
writeIcon('icon-512.png', buildIconSvg(512, REGULAR_FIT, COLOR_PAPER, COLOR_INK), 512);
writeIcon(
	'icon-maskable-512.png',
	buildIconSvg(512, MASKABLE_SAFE_ZONE, COLOR_PAPER, COLOR_INK),
	512
);
writeIcon(
	'apple-touch-icon-180.png',
	buildIconSvg(180, REGULAR_FIT, COLOR_PAPER, COLOR_INK),
	180
);
