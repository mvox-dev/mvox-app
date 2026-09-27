// @vitest-environment node
//
// #487 RED — the i18n leg of EntuRef. Reads the RAW message files. The link's
// accessible name comes from `entu_ref_aria_label` with a {short} parameter;
// label-in-name (WCAG 2.5.3) requires the rendered label to CONTAIN the
// visible short id, and to say the record opens in Entu in a new tab. All
// four locales must carry a real translation.
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

describe('#487 — entu_ref_aria_label exists in all four locales and embeds {short}', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json › ${KEY} renders with short='4154c4' containing '4154c4' and naming Entu`, () => {
			const value = messages(locale)[KEY];
			expect(typeof value, `${locale}.json › ${KEY} must be a string`).toBe('string');
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
