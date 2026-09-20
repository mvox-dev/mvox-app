// #408 RED — src/app.html links the web-app manifest and carries the
// head tags that make "Install as app" real on every platform.
//
// CONTRACT (GREEN edits src/app.html only — the strings below are pinned
// as exact attribute runs, self-closing style left to prettier):
//   - <link rel="manifest" href="/manifest.webmanifest">
//   - <meta name="theme-color" content="#f7f1e1">        (--color-paper)
//   - <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
//   - <meta name="apple-mobile-web-app-capable" content="yes">
//   - <meta name="apple-mobile-web-app-title" content="mvox">
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appHtml = readFileSync(resolve(__dirname, 'app.html'), 'utf-8');

describe('src/app.html — install-as-app head tags (#408)', () => {
	it('links the web-app manifest', () => {
		expect(appHtml).toContain('<link rel="manifest" href="/manifest.webmanifest"');
	});

	it('declares the theme colour as --color-paper (#f7f1e1)', () => {
		expect(appHtml).toContain('<meta name="theme-color" content="#f7f1e1"');
	});

	it('links the apple-touch-icon', () => {
		expect(appHtml).toContain(
			'<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png"'
		);
	});

	it('marks the app capable of standalone display on iOS, titled mvox', () => {
		expect(appHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
		expect(appHtml).toContain('<meta name="apple-mobile-web-app-title" content="mvox"');
	});
});
