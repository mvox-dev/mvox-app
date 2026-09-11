// @vitest-environment node
//
// #325 RED — the i18n leg of the pending-guard slice (conductor +
// admin/librarian add/remove). Reads the RAW message files (messages/*.json),
// same shape as linksSaveStateKeys.spec.ts (#323): no global
// locale-completeness spec exists, so the slice carries its own four-locale
// spec.
//
// Contract (issue #325 + Gama's 2026-09-11 ruling):
//   - each half gains a visible SAVING notice (the caveat-slot paragraph shape
//     while the select is disabled — #321's precedent) and a SAVED
//     announcement — two new keys per half;
//   - the existing FAILURE keys are KEPT: the failure text stays byte-identical
//     on both halves (admin_roles_action_error / season_manage_save_error) —
//     no new failure key may replace them;
//   - all keys exist non-empty in ALL FOUR locales (en/et/lv/uk).
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

// The slice's NEW key set: saving notice + saved announcement, one pair per half.
const NEW_KEYS = [
	'admin_roles_saving',
	'admin_roles_saved',
	'season_manage_conductor_saving',
	'season_manage_conductor_saved'
] as const;

// The KEPT failure keys — already live, pinned here so the slice cannot
// swap them out (the "failure text kept byte-identical" criterion).
const KEPT_FAILURE_KEYS = ['admin_roles_action_error', 'season_manage_save_error'] as const;

describe('#325 — pending-guard save-state keys exist non-empty in all four locales', () => {
	for (const key of NEW_KEYS) {
		it(`${key} exists non-empty in en/et/lv/uk`, () => {
			for (const locale of LOCALES) {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			}
		});
	}
});

describe('#325 — the existing failure keys are KEPT in all four locales', () => {
	for (const key of KEPT_FAILURE_KEYS) {
		it(`${key} still exists non-empty in en/et/lv/uk`, () => {
			for (const locale of LOCALES) {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			}
		});
	}
});

// (*MVOX:Tallis* — #325 RED)
