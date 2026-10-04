// @vitest-environment node
// The create-edition keys, read from the raw message files in all four locales.
import { describe, expect, it } from 'vitest';
import { LOCALES } from '$lib/testing/pages/profile';
import { type Locale, readMessages } from '$lib/testing/pages/files';

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

const PINNED_TEXT: Record<Locale, Record<(typeof NEW_KEYS)[number], string>> = {
	en: {
		library_create_edition_button: 'Add edition',
		library_create_edition_name_label: 'Name',
		library_create_edition_publisher_label: 'Publisher',
		library_create_edition_submit: 'Create edition',
		library_create_edition_cancel: 'Cancel',
		library_create_edition_name_required: 'Edition name is required.',
		library_create_edition_created: '{name} created.',
		library_create_edition_error: 'Could not create the edition.'
	},
	et: {
		library_create_edition_button: 'Lisa väljaanne',
		library_create_edition_name_label: 'Nimi',
		library_create_edition_publisher_label: 'Kirjastaja',
		library_create_edition_submit: 'Loo väljaanne',
		library_create_edition_cancel: 'Tühista',
		library_create_edition_name_required: 'Väljaande nimi on kohustuslik.',
		library_create_edition_created: '{name} loodud.',
		library_create_edition_error: 'Väljaande loomine ebaõnnestus.'
	},
	lv: {
		library_create_edition_button: 'Pievienot izdevumu',
		library_create_edition_name_label: 'Nosaukums',
		library_create_edition_publisher_label: 'Izdevējs',
		library_create_edition_submit: 'Izveidot izdevumu',
		library_create_edition_cancel: 'Atcelt',
		library_create_edition_name_required: 'Izdevuma nosaukums ir obligāts.',
		library_create_edition_created: '{name} izveidots.',
		library_create_edition_error: 'Neizdevās izveidot izdevumu.'
	},
	uk: {
		library_create_edition_button: 'Додати видання',
		library_create_edition_name_label: 'Назва',
		library_create_edition_publisher_label: 'Видавець',
		library_create_edition_submit: 'Створити видання',
		library_create_edition_cancel: 'Скасувати',
		library_create_edition_name_required: 'Потрібно вказати назву видання.',
		library_create_edition_created: '{name} створено.',
		library_create_edition_error: 'Не вдалося створити видання.'
	}
};

describe('#271 — locale parity: the eight library_create_edition_* keys exist, non-empty, exact text, in en/et/lv/uk', () => {
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

		it(`${locale}.json pins the exact text (engineering drafts — all four locales flagged refinable)`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(messages[key], `${locale}.json ${key}`).toBe(PINNED_TEXT[locale][key]);
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
