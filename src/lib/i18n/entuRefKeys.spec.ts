// @vitest-environment node

// EntuRef label (#487): label-in-name needs the visible short id and 'Entu' in every locale.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
const KEY = 'entu_ref_aria_label';

function messages(locale: (typeof LOCALES)[number]): Record<string, unknown> {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as Record<string, unknown>;
}

describe('#487 — entu_ref_aria_label embeds {short} in every locale', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json › ${KEY} renders with short='4154c4' containing '4154c4' and naming Entu`, () => {
			const value = messages(locale)[KEY];
			const text = value as string;
			expect(text).toContain('{short}');
			const rendered = text.replaceAll('{short}', '4154c4');
			expect(rendered).toContain('4154c4');
			expect(rendered).toContain('Entu');
			expect(rendered.replace('4154c4', '').replace('Entu', '').trim()).not.toBe('');
		});
	}

	it('non-English locales are translated, not copies of en', () => {
		const en = messages('en')[KEY];
		for (const locale of ['et', 'lv', 'uk'] as const) {
			expect(messages(locale)[KEY], `${locale}.json › ${KEY}`).not.toBe(en);
		}
	});
});

// (*MVOX:Tallis* — #487 RED)
