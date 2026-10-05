// @vitest-environment node
// The edition-file keys, read from the raw message files in all four locales.
import { describe, expect, it } from 'vitest';
import { LOCALES } from '$lib/testing/pages/profile';
import { readMessages } from '$lib/testing/pages/files';

const NEW_KEYS = [
	'library_edition_file_attach',
	'library_edition_file_open',
	'library_edition_file_uploading',
	'library_edition_file_uploaded',
	'library_edition_file_failed',
	'library_edition_file_broken',
	'library_edition_file_error',
	'library_edition_file_not_created'
] as const;

describe('#275 — locale parity: the eight library_edition_file_* keys exist, non-empty, in en/et/lv/uk', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json carries every new key, non-empty`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
				const value = messages[key];
				expect(
					typeof value === 'string' && value.trim().length > 0,
					`${locale}.json ${key} must be a non-empty string`
				).toBe(true);
			}
		});
	}

	it('no locale carries library_edition_file_open_error — the surface that showed it is gone (#427)', () => {
		for (const locale of LOCALES) {
			expect(
				'library_edition_file_open_error' in readMessages(locale),
				`${locale}.json still carries the retired open-error key`
			).toBe(false);
		}
	});

	it('every locale keeps the {filenames} placeholder in the uploaded-announcement and the {filename} placeholder in failed, broken AND not_created — a locale that drops one announces a nameless outcome (#253; survives any later copy refinement)', () => {
		for (const locale of LOCALES) {
			const messages = readMessages(locale);
			expect(
				String(messages.library_edition_file_uploaded),
				`${locale}.json library_edition_file_uploaded must carry {filenames}`
			).toContain('{filenames}');
			for (const key of [
				'library_edition_file_failed',
				'library_edition_file_broken',
				'library_edition_file_not_created'
			] as const) {
				expect(
					String(messages[key]),
					`${locale}.json ${key} must carry {filename}`
				).toContain('{filename}');
			}
		}
	});
});

// (*MVOX:Tallis* — #275 RED)
