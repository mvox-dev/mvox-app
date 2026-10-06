// @vitest-environment node

// Part viewer copy (#427, #615): the part_viewer_ key set, page_of placeholders, translations.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MessageFile = Record<string, unknown>;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function messages(locale: (typeof LOCALES)[number]): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

const PART_VIEWER_KEYS = [
	'part_viewer_close',
	'part_viewer_draw',
	'part_viewer_hide_marks',
	'part_viewer_not_on_device',
	'part_viewer_page_of'
] as const;

describe('#427 — part_viewer_ keys: placeholders, translation, key set', () => {
	it('part_viewer_page_of carries {current} and {total} in every locale', () => {
		for (const locale of LOCALES) {
			const value = messages(locale)['part_viewer_page_of'] as string;
			expect(value, `${locale}.json › part_viewer_page_of`).toContain('{current}');
			expect(value, `${locale}.json › part_viewer_page_of`).toContain('{total}');
		}
	});

	it('et/lv/uk are translated, not English placeholders (page_of exempt — a numeric format may coincide)', () => {
		const en = messages('en');
		for (const locale of ['et', 'lv', 'uk'] as const) {
			for (const key of PART_VIEWER_KEYS.filter((k) => k !== 'part_viewer_page_of')) {
				expect(
					messages(locale)[key],
					`${locale}.json › ${key} must not repeat the English copy`
				).not.toBe(en[key]);
			}
		}
	});

	it('the part_viewer_ group is EXACTLY this set', () => {
		for (const locale of LOCALES) {
			const group = Object.keys(messages(locale))
				.filter((k) => k.startsWith('part_viewer_'))
				.sort();
			expect(group, locale).toEqual([...PART_VIEWER_KEYS].sort());
		}
	});
});

// (*MVOX:Tallis* — #427 RED)
