// StrokeSurface control names (#394): ruled en, translated et/lv/uk, no part-viewer-fence segment.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
