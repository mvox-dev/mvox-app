// #408 RED — static/manifest.webmanifest, the file that makes Chrome, Edge
// and Android offer installation at all (none exists in the tree today).
//
// CONTRACT (GREEN):
//   - static/manifest.webmanifest parses as JSON and equals the WHOLE object
//     pinned below (toEqual — no extra keys, no missing keys). `lang` is
//     deliberately ABSENT: the app ships four locales, none is THE language.
//   - every icon the manifest lists exists as a committed file under static/
//     (they join the service-worker precache through the existing files()
//     filter — no swPolicy change; see sw-untouched-by-install.spec.ts).
//   - the SVG source of the mark (issue #408 body, delivered by Mihkel
//     2026-09-20) is committed VERBATIM as static/icons/mvox-mark.svg — the
//     source of truth the PNGs are rasterised from, never redrawn.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const staticDir = resolve(__dirname, '../static');
const manifestPath = resolve(staticDir, 'manifest.webmanifest');

describe('static/manifest.webmanifest (#408)', () => {
	it('exists and parses as JSON', () => {
		expect(existsSync(manifestPath), 'static/manifest.webmanifest missing').toBe(true);
		expect(() => JSON.parse(readFileSync(manifestPath, 'utf-8'))).not.toThrow();
	});

	it('is EXACTLY the settled shape — name mvox, standalone, paper colours, three icons', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		expect(manifest).toEqual({
			name: 'mvox',
			short_name: 'mvox',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			background_color: '#f7f1e1',
			theme_color: '#f7f1e1',
			icons: [
				{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
				{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
				{
					src: '/icons/icon-maskable-512.png',
					sizes: '512x512',
					type: 'image/png',
					purpose: 'maskable'
				}
			]
		});
	});

	it('every icon src the manifest lists exists under static/', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
			icons: Array<{ src: string }>;
		};
		for (const icon of manifest.icons) {
			expect(
				existsSync(resolve(staticDir, `.${icon.src}`)),
				`static${icon.src} missing`
			).toBe(true);
		}
	});
});

describe('static/icons — committed artwork (#408)', () => {
	it('the apple-touch-icon app.html links exists', () => {
		expect(existsSync(resolve(staticDir, 'icons/apple-touch-icon-180.png'))).toBe(true);
	});

	it('the MV-ligature SVG source of truth is committed verbatim', () => {
		const svgPath = resolve(staticDir, 'icons/mvox-mark.svg');
		expect(existsSync(svgPath), 'static/icons/mvox-mark.svg missing').toBe(true);
		const svg = readFileSync(svgPath, 'utf-8');
		// pins from the issue-body SVG — the mark is not redrawn
		expect(svg).toContain('viewBox="-43.27 -8.00 271.27 256.00"');
		expect(svg).toContain('fill="currentColor"');
		expect(svg.match(/<path /g)?.length).toBe(2);
		expect(svg).toContain('M -2.12,12 Q 0,0 12,0 L 32,0');
		expect(svg).toContain('M 30.6,110 Q 24.6,110 26.38,115.35');
	});
});
