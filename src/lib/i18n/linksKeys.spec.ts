// @vitest-environment node
//
// #256 RED — the i18n leg of the Lingikogu (link collection) slice. Reads the
// RAW message files (messages/*.json), same shape as personPickerKeys.spec.ts:
// no global locale-completeness spec exists, so the slice carries its own
// four-locale spec.
//
// Contract:
//   - `nav_links` exists non-empty in ALL FOUR locales; et is Gama/Mihkel's
//     verbatim 'Lingikogu'.
//   - The page's CRUD strings (the key set below) exist non-empty in all four
//     locales. en copy is pinned only as present/non-empty — no verbatim en
//     ruling exists.
//   - GREP DECOY GUARD (blast finding): the bare string 'link' is overloaded
//     by OAuth account-linking (`intent: 'link'`). Every key of this feature
//     is `links_*` (plural) or `nav_links`; NO key beginning `link_`
//     (singular) may be introduced in any locale.
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

// The feature's full key set — nav label + the page's own strings.
const LINKS_KEYS = [
	'nav_links',
	'links_title',
	'links_empty',
	'links_load_error',
	'links_add_name_label',
	'links_add_url_label',
	'links_add_description_label',
	'links_add_submit',
	'links_edit',
	'links_save',
	'links_cancel',
	'links_remove',
	'links_move_up',
	'links_move_down'
] as const;

describe('#256 — Lingikogu keys exist non-empty in all four locales', () => {
	for (const key of LINKS_KEYS) {
		it(`${key} exists non-empty in en/et/lv/uk`, () => {
			for (const locale of LOCALES) {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			}
		});
	}
});

describe('#256 — the Estonian nav label is the ruled name', () => {
	it("et nav_links is 'Lingikogu' verbatim", () => {
		expect(messages('et')['nav_links']).toBe('Lingikogu');
	});
});

describe('#256 — grep-decoy guard: no singular link_* keys in any locale', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has no key matching /^link_/ (OAuth account-linking overloads the bare word)`, () => {
			const offenders = Object.keys(messages(locale)).filter((k) => /^link_/.test(k));
			expect(offenders).toEqual([]);
		});
	}
});

// (*MVOX:Tallis* — #256 RED)
