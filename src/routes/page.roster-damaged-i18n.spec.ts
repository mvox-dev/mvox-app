// The damaged-parent marker copy, exact in all four locales.
import { describe, expect, it } from 'vitest';
import { messagePatterns } from '$lib/testing/messageFile.js';
import { readMessages as localeMessages } from '$lib/testing/pages/profile';

const KEY = 'roster_section_parent_damaged';

const EXACT: Record<string, string> = {
	en: 'The data for section {name} is damaged — it does not have exactly one parent record. Arranging is disabled for this section.',
	et: 'Hääleliigi {name} andmed on kahjustatud — sellel ei ole täpselt ühte ülemkirjet. Selle hääleliigi paigutamine on keelatud.',
	lv: 'Balss grupas {name} dati ir bojāti — tai nav tieši viena vecākā ieraksta. Šīs grupas kārtošana ir atspējota.',
	uk: 'Дані партії {name} пошкоджено — вона не має рівно одного батьківського запису. Впорядкування цієї партії вимкнено.'
};

describe('#264 — roster_section_parent_damaged, exact text in all four locales', () => {
	it.each(Object.keys(EXACT))('%s.json carries the key with the exact pinned text', (locale) => {
		const messages = localeMessages(locale);
		expect(KEY in messages, `${locale}.json missing ${KEY}`).toBe(true);
		expect(messages[KEY]).toBe(EXACT[locale]);
	});

	it.each(Object.keys(EXACT))('%s: the {name} placeholder survives — the marker must name the section', (locale) => {
		const messages = localeMessages(locale);
		const patterns = messagePatterns(messages[KEY]).join(' ');
		expect(patterns).toContain('{name}');
	});
});

// (*MVOX:Tallis* — #264 item 5 RED, 4-locale exact-text pins)
