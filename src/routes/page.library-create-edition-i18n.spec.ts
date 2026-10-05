// @vitest-environment node
// The create-edition keys, read from the raw message files in all four locales.
import { describe, expect, it } from 'vitest';
import { LOCALES } from '$lib/testing/pages/profile';
import { readMessages } from '$lib/testing/pages/files';

const NEW_KEYS = [
	'library_create_edition_button',
	'library_create_edition_name_label',
	'library_create_edition_publisher_label',
	'library_create_edition_submit',
	'library_create_edition_cancel',
	'library_create_edition_name_required',
	'library_create_edition_created',
	'library_create_edition_error'
] as const;

describe('#271 — locale parity: the eight library_create_edition_* keys exist, non-empty, in en/et/lv/uk', () => {
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

	it('every locale FILE keeps the {name} placeholder in the created-announcement — a locale that drops it announces a nameless creation (survives any later copy refinement)', () => {
		for (const locale of LOCALES) {
			const value = readMessages(locale).library_create_edition_created;
			expect(
				typeof value === 'string' && value.includes('{name}'),
				`${locale}.json library_create_edition_created must interpolate {name}`
			).toBe(true);
		}
	});
});

// (*MVOX:Tallis* — #271 RED)
