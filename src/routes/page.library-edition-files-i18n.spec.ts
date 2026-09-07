// @vitest-environment node
//
// #275 RED — the i18n leg of the edition-files affordance. Reads the RAW
// message files (messages/*.json), same contract shape as
// page.library-create-edition-i18n.spec.ts: the nine new
// `library_edition_file_*` keys exist in ALL FOUR locales.
//
// COPY STATUS: #275 carries NO PO-pinned copy — every string below, the
// Estonian included, is an ENGINEERING DRAFT drawn from the existing library
// register (et "fail"/"ebaõnnestus" per the create-edition family's register;
// lv "fails"; uk "файл"). ALL FOUR locales are flagged REFINABLE in the
// delivery report — refining them later is a copy-edit against these
// exact-text pins, not a schema change.
//
// KEY SET (as needed per the slice, task item 10):
//   attach    — the attach control's accessible name / visible label
//   open      — the per-file open control
//   uploading — the per-batch in-flight indicator
//   uploaded  — sr-only success announcement; {filenames} names EXACTLY what
//               landed (#253 — never a bare "done")
//   failed    — per-file visible failure; {filename} names the file
//   broken    — the delete-failed phantom's row text; {filename}
//   error     — the batch-level transport failure (step-1 POST died,
//               nothing was created)
//   not-created — (review YELLOW) a selected file that step 1 returned NO
//               property for: nothing exists server-side and nothing landed,
//               which is a different thing to say than `failed`'s
//               created-then-cleaned-up; {filename}
//   open-error  — (review YELLOW) signing a file's download url failed. A
//               READ-path message: every member sees it, not just librarians.
//
// Filesize formatting carries NO i18n key: it is numeric/tabular text
// (the #207 rule-7 family), rendered locale-independently by
// editionFiles.formatFileSize.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MessageFile = Record<string, unknown>;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
type Locale = (typeof LOCALES)[number];

function readMessages(locale: Locale): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

const NEW_KEYS = [
	'library_edition_file_attach',
	'library_edition_file_open',
	'library_edition_file_uploading',
	'library_edition_file_uploaded',
	'library_edition_file_failed',
	'library_edition_file_broken',
	'library_edition_file_error',
	'library_edition_file_not_created',
	'library_edition_file_open_error'
] as const;

// Exact-text pins — engineering drafts, all four locales refinable (header).
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
			'{filename} was not attached — the server returned nothing for it.',
		library_edition_file_open_error: 'Could not open the file.'
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
			'Faili {filename} ei lisatud — server ei tagastanud selle kohta midagi.',
		library_edition_file_open_error: 'Faili avamine ebaõnnestus.'
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
			'Fails {filename} netika pievienots — serveris par to neko neatgrieza.',
		library_edition_file_open_error: 'Neizdevās atvērt failu.'
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
			'Файл {filename} не додано — сервер нічого не повернув для нього.',
		library_edition_file_open_error: 'Не вдалося відкрити файл.'
	}
};

describe('#275 — locale parity: the nine library_edition_file_* keys exist, non-empty, exact text, in en/et/lv/uk', () => {
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
