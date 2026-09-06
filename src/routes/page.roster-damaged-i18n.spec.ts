// #264 item 5 RED — the damaged-`_parent` marker copy, pinned EXACTLY in all
// four locales (invariant 9 of the stage-2 contract: new i18n keys land in all
// four locale files with 4-locale exact-text pins).
//
// The key: `roster_section_parent_damaged`, with a `{name}` placeholder — the
// marker must NAME the damaged section (ruling item 5 pin iii; wired on the
// real route by page.roster-damaged-parent.spec.ts). Copy is calm and factual:
// it states WHAT is wrong (not exactly one parent record — covers both the
// zero-value and the duplicate-value detections) and WHAT is disabled.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

const KEY = 'roster_section_parent_damaged';

const EXACT: Record<string, string> = {
	en: 'The data for section {name} is damaged — it does not have exactly one parent record. Arranging is disabled for this section.',
	et: 'Hääleliigi {name} andmed on kahjustatud — sellel ei ole täpselt ühte ülemkirjet. Selle hääleliigi paigutamine on keelatud.',
	lv: 'Balss grupas {name} dati ir bojāti — tai nav tieši viena vecākā ieraksta. Šīs grupas kārtošana ir atspējota.',
	uk: 'Дані партії {name} пошкоджено — вона не має рівно одного батьківського запису. Впорядкування цієї партії вимкнено.'
};

function localeMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

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
