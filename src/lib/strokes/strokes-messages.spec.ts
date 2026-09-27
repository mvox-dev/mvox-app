// #394 RED — the surface's control names exist in all four locales.
//
// Key names avoid every segment src/part-viewer-fence.spec.ts bans
// (ink/draw/layer family); that fence scans ALL message files and must stay
// green. Real translations, not English copies, in et/lv/uk.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
const KEYS = [
	'strokes_pen_red_aria_label',
	'strokes_pen_black_aria_label',
	'strokes_erase_aria_label',
	'strokes_undo_aria_label'
] as const;
const FORBIDDEN = new Set(['ink', 'inks', 'draw', 'draws', 'drawn', 'drawing', 'layer', 'layers']);

const messages = (locale: string) =>
	JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')) as Record<
		string,
		string
	>;

describe('#394 — StrokeSurface message keys', () => {
	it('every key exists with non-empty text in en/et/lv/uk', () => {
		for (const locale of LOCALES) {
			const m = messages(locale);
			for (const key of KEYS) {
				expect(typeof m[key], `${locale}.${key}`).toBe('string');
				expect(m[key].trim().length, `${locale}.${key}`).toBeGreaterThan(0);
			}
		}
	});

	it('en texts are the names the component spec asserts', () => {
		const en = messages('en');
		expect(KEYS.map((k) => en[k])).toEqual(['Red pen', 'Black pen', 'Erase strokes', 'Undo']);
	});

	it('et/lv/uk are translated, not English copies', () => {
		const en = messages('en');
		for (const locale of ['et', 'lv', 'uk']) {
			const m = messages(locale);
			for (const key of KEYS) expect(m[key], `${locale}.${key}`).not.toEqual(en[key]);
		}
	});

	it('no key segment is banned by the part-viewer fence', () => {
		for (const key of KEYS) {
			expect(key.split('_').filter((s) => FORBIDDEN.has(s)), key).toEqual([]);
		}
	});
});

// (*MVOX:Tallis* — #394 RED: messages)
