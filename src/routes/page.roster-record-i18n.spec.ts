// #268 RED — the member-record editor's i18n keys, pinned EXACTLY in all four
// locales (the standing invariant: new i18n keys land in all four locale files
// with 4-locale exact-text pins — the page.roster-damaged-i18n.spec.ts pattern).
//
// Naming follows the roster page's 66-key `roster_*` convention:
// `roster_record_*`. Labels are the RELEASED copy ("labels as proposed",
// Mihkel 2026-09-07): Pärisnimi / Telefon / E-post / Sünnikuupäev. English says
// "date of birth" EVERYWHERE user-facing — "birthdate" is the code identifier
// only, "birth date" is not used (terminology ruling on the issue).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

const EXACT: Record<string, Record<string, string>> = {
	// Static sr-only pencil label — composes with the row's visible name inside
	// the button (#262), so it carries NO placeholder.
	roster_record_edit_label: {
		en: 'Edit member details:',
		et: 'Muuda liikme andmeid:',
		lv: 'Rediģēt dalībnieka datus:',
		uk: 'Редагувати дані учасника:'
	},
	roster_record_name_label: {
		en: 'Real name',
		et: 'Pärisnimi',
		lv: 'Īstais vārds',
		uk: "Справжнє ім'я"
	},
	roster_record_phone_label: {
		en: 'Phone',
		et: 'Telefon',
		lv: 'Tālrunis',
		uk: 'Телефон'
	},
	roster_record_email_label: {
		en: 'Email',
		et: 'E-post',
		lv: 'E-pasts',
		uk: 'Ел. пошта'
	},
	roster_record_birthdate_label: {
		en: 'Date of birth',
		et: 'Sünnikuupäev',
		lv: 'Dzimšanas datums',
		uk: 'Дата народження'
	},
	roster_record_save: {
		en: 'Save',
		et: 'Salvesta',
		lv: 'Saglabāt',
		uk: 'Зберегти'
	},
	roster_record_cancel: {
		en: 'Cancel',
		et: 'Tühista',
		lv: 'Atcelt',
		uk: 'Скасувати'
	},
	roster_record_saved: {
		en: 'Member details saved.',
		et: 'Liikme andmed on salvestatud.',
		lv: 'Dalībnieka dati saglabāti.',
		uk: 'Дані учасника збережено.'
	},
	// Failure tells the truth: nothing was saved, the values are still there.
	roster_record_save_failed: {
		en: 'Couldn’t save — nothing was saved. The entered values are still in the form.',
		et: 'Salvestamine ebaõnnestus — midagi ei salvestatud. Sisestatud väärtused on endiselt vormis.',
		lv: 'Neizdevās saglabāt — nekas netika saglabāts. Ievadītās vērtības joprojām ir formā.',
		uk: 'Не вдалося зберегти — нічого не збережено. Введені значення залишилися у формі.'
	},
	// Partial failure says exactly what landed (#253). {saved} = the landed
	// field LABELS (never values).
	roster_record_save_partial: {
		en: 'Saving partly failed — saved: {saved}. The rest was not saved.',
		et: 'Salvestamine ebaõnnestus osaliselt — salvestatud: {saved}. Ülejäänu jäi salvestamata.',
		lv: 'Saglabāšana daļēji neizdevās — saglabāts: {saved}. Pārējais netika saglabāts.',
		uk: 'Збереження частково не вдалося — збережено: {saved}. Решту не збережено.'
	},
	// Review F2 refusal copy — the gate that keeps the DOMAIN-shared `name` from
	// being written empty. Pinned here like every sibling: the editor spec's
	// paraglide mock is a Proxy that synthesises `[roster_record_name_required]`
	// from the key name alone, so it would pass even with the key missing from
	// et/lv/uk entirely. This table is the only thing that reads the shipped text.
	roster_record_name_required: {
		en: 'A real name is required — nothing was saved. Enter a name, then save again.',
		et: 'Pärisnimi on kohustuslik — midagi ei salvestatud. Sisesta nimi ja salvesta uuesti.',
		lv: 'Īstais vārds ir obligāts — nekas netika saglabāts. Ievadiet vārdu un saglabājiet vēlreiz.',
		uk: "Справжнє ім'я обов'язкове — нічого не збережено. Введіть ім'я та збережіть ще раз."
	},
	// #283 phone-guard refusal — STATIC copy naming the field, NEVER echoing the
	// typed value (crede real-PII law, memberRecord.ts header). Same register as
	// roster_record_name_required; et drafted first, all four refinable.
	roster_record_phone_invalid: {
		en: 'The phone number can’t contain letters — nothing was saved. Remove the letters, then save again.',
		et: 'Telefoninumber ei tohi sisaldada tähti — midagi ei salvestatud. Eemalda tähed ja salvesta uuesti.',
		lv: 'Tālruņa numurs nedrīkst saturēt burtus — nekas netika saglabāts. Noņemiet burtus un saglabājiet vēlreiz.',
		uk: 'Номер телефону не може містити літер — нічого не збережено. Приберіть літери та збережіть ще раз.'
	},
	// #283 email-guard refusal — the guard behind it is the BROWSER'S own
	// checkValidity() and must stay the weakest rule that closes the hole
	// (Gama's recorded line); the copy, like every refusal here, is static and
	// value-free.
	roster_record_email_invalid: {
		en: 'The email address doesn’t look valid — nothing was saved. Check the address, then save again.',
		et: 'E-posti aadress ei tundu õige — midagi ei salvestatud. Kontrolli aadressi ja salvesta uuesti.',
		lv: 'E-pasta adrese neizskatās derīga — nekas netika saglabāts. Pārbaudiet adresi un saglabājiet vēlreiz.',
		uk: 'Адреса ел. пошти виглядає недійсною — нічого не збережено. Перевірте адресу та збережіть ще раз.'
	},
	// Damaged data (#264): names the member, states that nothing was changed.
	roster_record_damaged: {
		en: 'The details for {name} are damaged — more than one record exists. Editing is disabled and nothing was changed.',
		et: 'Liikme {name} andmed on kahjustatud — kirjeid on rohkem kui üks. Muutmine on keelatud ja midagi ei muudetud.',
		lv: 'Dalībnieka {name} dati ir bojāti — ir vairāk nekā viens ieraksts. Rediģēšana ir atspējota, un nekas netika mainīts.',
		uk: 'Дані учасника {name} пошкоджено — існує більше ніж один запис. Редагування вимкнено, нічого не змінено.'
	}
};

function localeMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#268 — roster_record_* keys, exact text in all four locales', () => {
	for (const key of Object.keys(EXACT)) {
		it.each(LOCALES)(`${key}: %s.json carries the exact pinned text`, (locale) => {
			const messages = localeMessages(locale);
			expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
			expect(messages[key]).toBe(EXACT[key][locale]);
		});
	}
});

describe('#268 — placeholders survive translation', () => {
	it.each(LOCALES)('%s: roster_record_damaged keeps {name} — the alert must name the member', (locale) => {
		const messages = localeMessages(locale);
		expect(messagePatterns(messages['roster_record_damaged']).join(' ')).toContain('{name}');
	});

	it.each(LOCALES)('%s: roster_record_save_partial keeps {saved} — it must say what landed', (locale) => {
		const messages = localeMessages(locale);
		expect(messagePatterns(messages['roster_record_save_partial']).join(' ')).toContain('{saved}');
	});
});

describe('#268 — terminology ruling: English says "date of birth", never "birth date"/"birthdate" in user-facing copy', () => {
	it('the en birthdate label is exactly "Date of birth"', () => {
		expect(localeMessages('en')['roster_record_birthdate_label']).toBe('Date of birth');
	});

	it('no new en value uses "birth date" or "birthdate" as words — the code identifier stays out of copy', () => {
		const en = localeMessages('en');
		for (const key of Object.keys(EXACT)) {
			expect(String(en[key] ?? '')).not.toMatch(/birth ?date/i);
		}
	});
});

describe('#283 — the two refusal messages are STATIC: no placeholder, so no path for a typed value into the copy', () => {
	// The editor spec's paraglide proxy mock synthesises `[key]` from the key
	// name alone, so it cannot see the shipped text at all — this direct file
	// read is the only real check that the refusals stay value-free.
	it.each(LOCALES)('%s: roster_record_phone_invalid and roster_record_email_invalid carry no {placeholder}', (locale) => {
		const messages = localeMessages(locale);
		for (const key of ['roster_record_phone_invalid', 'roster_record_email_invalid']) {
			// Existence asserted here too — messagePatterns(undefined) is [], and a
			// vacuous pass on a missing key is the partial-assertion trap.
			expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
			expect(messagePatterns(messages[key]).join(' ')).not.toMatch(/\{[^}]*\}/);
		}
	});
});

// (*MVOX:Tallis* — #268 RED, 4-locale exact-text pins)
// (*MVOX:Tallis* — #283 RED: phone/email refusal keys ×4 locales, static-copy pins)
