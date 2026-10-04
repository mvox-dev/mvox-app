// @vitest-environment node
// The edition-file keys, read from the raw message files in all four locales.
import { describe, expect, it } from 'vitest';
import { LOCALES } from '$lib/testing/pages/profile';
import { type Locale, readMessages } from '$lib/testing/pages/files';

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

const PINNED_TEXT: Record<Locale, Record<(typeof NEW_KEYS)[number], string>> = {
	en: {
		library_edition_file_attach: 'Attach files',
		library_edition_file_open: 'Open',
		library_edition_file_uploading: 'Uploading…',
		library_edition_file_uploaded: '{filenames} attached.',
		library_edition_file_failed: 'Could not attach {filename}.',
		library_edition_file_broken: '{filename} failed and could not be cleaned up.',
		library_edition_file_error: 'Could not attach files.',
		library_edition_file_not_created:
			'{filename} was not attached — the server returned nothing for it.'
	},
	et: {
		library_edition_file_attach: 'Lisa failid',
		library_edition_file_open: 'Ava',
		library_edition_file_uploading: 'Üleslaadimine…',
		library_edition_file_uploaded: '{filenames} lisatud.',
		library_edition_file_failed: 'Faili {filename} lisamine ebaõnnestus.',
		library_edition_file_broken: 'Faili {filename} üleslaadimine ebaõnnestus ja katkine kirje võis alles jääda.',
		library_edition_file_error: 'Failide lisamine ebaõnnestus.',
		library_edition_file_not_created:
			'Faili {filename} ei lisatud — server ei tagastanud selle kohta midagi.'
	},
	lv: {
		library_edition_file_attach: 'Pievienot failus',
		library_edition_file_open: 'Atvērt',
		library_edition_file_uploading: 'Notiek augšupielāde…',
		library_edition_file_uploaded: '{filenames} pievienots.',
		library_edition_file_failed: 'Neizdevās pievienot failu {filename}.',
		library_edition_file_broken: 'Faila {filename} augšupielāde neizdevās, un bojāts ieraksts var būt palicis.',
		library_edition_file_error: 'Neizdevās pievienot failus.',
		library_edition_file_not_created:
			'Fails {filename} netika pievienots — serveris par to neko neatgrieza.'
	},
	uk: {
		library_edition_file_attach: 'Додати файли',
		library_edition_file_open: 'Відкрити',
		library_edition_file_uploading: 'Завантаження…',
		library_edition_file_uploaded: '{filenames} додано.',
		library_edition_file_failed: 'Не вдалося додати файл {filename}.',
		library_edition_file_broken: 'Завантаження файлу {filename} не вдалося, і пошкоджений запис міг залишитися.',
		library_edition_file_error: 'Не вдалося додати файли.',
		library_edition_file_not_created:
			'Файл {filename} не додано — сервер нічого не повернув для нього.'
	}
};

describe('#275 — locale parity: the eight library_edition_file_* keys exist, non-empty, exact text, in en/et/lv/uk', () => {
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
