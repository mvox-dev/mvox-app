// @vitest-environment node
//
// #271 RED — the i18n leg of the create-edition affordance. This spec reads
// the RAW message files (messages/*.json), not the compiled Paraglide output,
// because the contract is about the FILES: the eight new
// `library_create_edition_*` keys exist in ALL FOUR locales, mirroring the
// `library_create_work_*` template key-for-key.
//
// COPY STATUS: #271 carries NO PO-pinned copy — every string below, the
// Estonian included, is an ENGINEERING DRAFT drawn from the existing
// library_create_work_* / library_edition_* register (et "väljaanne" per
// library_editions_empty, "kirjastaja" per library_edition_publisher_unknown;
// lv "izdevums"/"izdevējs"; uk "видання"/"видавець"). ALL FOUR locales are
// flagged REFINABLE in the delivery report — refining them later is a
// copy-edit against these exact-text pins, not a schema change.
//
// LENGTH NOTE: the control sits in the ml-4-indented edition tree under the
// page's max-w-md column, so the longest lv/uk strings have the least room in
// the app. The wrap/overflow sanity pin for that lives in
// page.library-create-edition.spec.ts (class contract — happy-dom computes no
// layout); HERE the length concern is only that no locale's draft balloons
// past its create-work sibling register.
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
	'library_create_edition_button',
	'library_create_edition_name_label',
	'library_create_edition_publisher_label',
	'library_create_edition_submit',
	'library_create_edition_cancel',
	'library_create_edition_name_required',
	'library_create_edition_created',
	'library_create_edition_error'
] as const;

// Exact-text pins — engineering drafts, all four locales refinable (see
// header). The {name} placeholder in *_created follows the
// library_create_work_created template verbatim.
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
