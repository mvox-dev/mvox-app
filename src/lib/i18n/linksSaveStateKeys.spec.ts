// @vitest-environment node
//
// #323 RED — the i18n leg of the links save-states slice. Reads the RAW
// message files (messages/*.json), same shape as linksKeys.spec.ts: no global
// locale-completeness spec exists, so the slice carries its own four-locale
// spec.
//
// Contract (issue #323 + Gama's 2026-09-11 adjacent-scope ruling):
//   - the reorder auto-save surface gets a FAILURE key and a SAVED key;
//   - the explicit-submit forms (create/update/delete) get FAILURE keys ONLY
//     — saved is self-evident on explicit submit, no saved key exists for
//     them;
//   - all keys exist non-empty in ALL FOUR locales (en/et/lv/uk);
//   - GREP DECOY GUARD carried forward from #256: every key is `links_*`
//     (plural) — NO key beginning `link_` (singular) may be introduced
//     (OAuth account-linking overloads the bare word).
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

// The slice's full key set: reorder failure + saved, form failures.
const SAVE_STATE_KEYS = [
	'links_reorder_failed',
	// #323 review F2 — the plain failure key claims "showing the order the
	// server holds"; that claim only holds when the post-failure re-read
	// actually landed. The _stale variant covers the branch where it did not.
	'links_reorder_failed_stale',
	'links_reorder_saved',
	'links_create_failed',
	'links_update_failed',
	'links_remove_failed'
] as const;

describe('#323 — links save-state keys exist non-empty in all four locales', () => {
	for (const key of SAVE_STATE_KEYS) {
		it(`${key} exists non-empty in en/et/lv/uk`, () => {
			for (const locale of LOCALES) {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			}
		});
	}
});

describe('#323 — the explicit-submit forms get NO saved key (failure surfacing only, per the PO ruling)', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has no links_create_saved / links_update_saved / links_remove_saved`, () => {
			const offenders = Object.keys(messages(locale)).filter((k) =>
				/^links_(create|update|remove)_saved$/.test(k)
			);
			expect(offenders).toEqual([]);
		});
	}
});

describe('#323 — grep-decoy guard holds: no singular link_* keys in any locale', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has no key matching /^link_/`, () => {
			const offenders = Object.keys(messages(locale)).filter((k) => /^link_/.test(k));
			expect(offenders).toEqual([]);
		});
	}
});

// (*MVOX:Tallis* — #323 RED)
