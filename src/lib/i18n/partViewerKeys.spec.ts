// @vitest-environment node
//
// #427 RED — the part viewer's i18n leg. Reads the RAW message files
// (messages/*.json), the linksKeys.spec.ts shape: no global
// locale-completeness spec exists, so the slice carries its own four-locale
// spec.
//
// Contract (design ruling on #427):
//   - Group prefix `part_viewer_`, flat keys, present in ALL FOUR locales.
//   - THREE keys exactly: close, not_on_device, page_of. The conditional
//     fourth (part_viewer_open, an aria for the entry buttons) resolves to
//     NO KEY — the existing 'PDF'/'Open' labels are kept, so the exact-set
//     pin below also guards against a stray part_viewer_open (or any
//     part_viewer_ink_*) creeping in.
//   - part_viewer_page_of carries BOTH {current} and {total} in every locale
//     (the 'n / N' indicator — Inter, a pencil note in the margin).
//   - et/lv/uk are real translations, not English placeholders (Comenius
//     writes them in GREEN). page_of is exempt from the differs-from-en
//     check: '{current} / {total}' may legitimately be locale-identical.
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
	'part_viewer_not_on_device',
	'part_viewer_page_of'
] as const;

describe('#427 — part_viewer_ keys exist non-empty in all four locales', () => {
	for (const key of PART_VIEWER_KEYS) {
		it(`${key} exists non-empty in en/et/lv/uk`, () => {
			for (const locale of LOCALES) {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			}
		});
	}

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
			for (const key of ['part_viewer_close', 'part_viewer_not_on_device'] as const) {
				expect(
					messages(locale)[key],
					`${locale}.json › ${key} must not repeat the English copy`
				).not.toBe(en[key]);
			}
		}
	});

	it('the part_viewer_ group is EXACTLY this set — no conditional fourth key, nothing ink-shaped', () => {
		for (const locale of LOCALES) {
			const group = Object.keys(messages(locale))
				.filter((k) => k.startsWith('part_viewer_'))
				.sort();
			expect(group, locale).toEqual([...PART_VIEWER_KEYS].sort());
		}
	});
});

// (*MVOX:Tallis* — #427 RED)
