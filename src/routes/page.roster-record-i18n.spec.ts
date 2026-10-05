// The member-record editor keys, exact in all four locales; the route spec's mock can't see them.
import { describe, expect, it } from 'vitest';
import { messagePatterns } from '$lib/testing/messageFile.js';
import { LOCALES, readMessages as localeMessages } from '$lib/testing/pages/profile';

const EXACT: Record<string, Record<string, string>> = {
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
	roster_record_save_failed: {
		en: 'Couldn’t save — nothing was saved. The entered values are still in the form.',
		et: 'Salvestamine ebaõnnestus — midagi ei salvestatud. Sisestatud väärtused on endiselt vormis.',
		lv: 'Neizdevās saglabāt — nekas netika saglabāts. Ievadītās vērtības joprojām ir formā.',
		uk: 'Не вдалося зберегти — нічого не збережено. Введені значення залишилися у формі.'
	},
	roster_record_save_partial: {
		en: 'Saving partly failed — saved: {saved}. The rest was not saved.',
		et: 'Salvestamine ebaõnnestus osaliselt — salvestatud: {saved}. Ülejäänu jäi salvestamata.',
		lv: 'Saglabāšana daļēji neizdevās — saglabāts: {saved}. Pārējais netika saglabāts.',
		uk: 'Збереження частково не вдалося — збережено: {saved}. Решту не збережено.'
	},
	roster_record_name_required: {
		en: 'A real name is required — nothing was saved. Enter a name, then save again.',
		et: 'Pärisnimi on kohustuslik — midagi ei salvestatud. Sisesta nimi ja salvesta uuesti.',
		lv: 'Īstais vārds ir obligāts — nekas netika saglabāts. Ievadiet vārdu un saglabājiet vēlreiz.',
		uk: "Справжнє ім'я обов'язкове — нічого не збережено. Введіть ім'я та збережіть ще раз."
	},
	roster_record_phone_invalid: {
		en: 'The phone number can’t contain letters — nothing was saved. Remove the letters, then save again.',
		et: 'Telefoninumber ei tohi sisaldada tähti — midagi ei salvestatud. Eemalda tähed ja salvesta uuesti.',
		lv: 'Tālruņa numurs nedrīkst saturēt burtus — nekas netika saglabāts. Noņemiet burtus un saglabājiet vēlreiz.',
		uk: 'Номер телефону не може містити літер — нічого не збережено. Приберіть літери та збережіть ще раз.'
	},
	roster_record_email_invalid: {
		en: 'The email address doesn’t look valid — nothing was saved. Check the address, then save again.',
		et: 'E-posti aadress ei tundu õige — midagi ei salvestatud. Kontrolli aadressi ja salvesta uuesti.',
		lv: 'E-pasta adrese neizskatās derīga — nekas netika saglabāts. Pārbaudiet adresi un saglabājiet vēlreiz.',
		uk: 'Адреса ел. пошти виглядає недійсною — нічого не збережено. Перевірте адресу та збережіть ще раз.'
	},
	// A proper noun in every locale: the field takes the Estonian isikukood only.
	roster_record_id_code_label: {
		en: 'Isikukood',
		et: 'Isikukood',
		lv: 'Isikukood',
		uk: 'Isikukood'
	},
	roster_record_id_code_invalid: {
		en: 'The isikukood is not valid — nothing was saved. Check the code, then save again.',
		et: 'Isikukood ei ole õige — midagi ei salvestatud. Kontrolli koodi ja salvesta uuesti.',
		lv: 'Isikukood nav derīgs — nekas netika saglabāts. Pārbaudiet kodu un saglabājiet vēlreiz.',
		uk: 'Isikukood недійсний — нічого не збережено. Перевірте код та збережіть ще раз.'
	}
};

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
	it.each(LOCALES)('%s: roster_record_save_partial keeps {saved} — it must say what landed', (locale) => {
		const messages = localeMessages(locale);
		expect(messagePatterns(messages['roster_record_save_partial']).join(' ')).toContain('{saved}');
	});
});

describe('#388 — roster_record_damaged / roster_member_deactivate_failed / roster_member_reinstate_failed name no member', () => {
	const NAMELESS_KEYS = [
		'roster_record_damaged',
		'roster_member_deactivate_failed',
		'roster_member_reinstate_failed'
	] as const;

	for (const key of NAMELESS_KEYS) {
		it.each(LOCALES)(`${key}: %s.json carries copy with NO {placeholder}`, (locale) => {
			const messages = localeMessages(locale);
			const patterns = messagePatterns(messages[key]);
			expect(patterns.length, `${locale}.${key} renders at least one pattern`).toBeGreaterThan(0);
			for (const pattern of patterns) {
				expect(pattern, `${locale}.${key} must not interpolate anything`).not.toMatch(/\{[^}]*\}/);
			}
		});
	}
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

describe('#283/#285 — the refusal messages are STATIC: no placeholder, so no path for a typed value into the copy', () => {
	it.each(LOCALES)('%s: roster_record_phone_invalid, roster_record_email_invalid and roster_record_id_code_invalid carry no {placeholder}', (locale) => {
		const messages = localeMessages(locale);
		for (const key of [
			'roster_record_phone_invalid',
			'roster_record_email_invalid',
			'roster_record_id_code_invalid'
		]) {
			expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
			expect(messagePatterns(messages[key]).join(' ')).not.toMatch(/\{[^}]*\}/);
		}
	});
});

// (*MVOX:Tallis* — #268 #283 #285 #388 RED: record keys ×4 locales, exact and static-copy pins)
