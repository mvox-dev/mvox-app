// The not-active notice and deactivate refusals, read from all four message files.
import { describe, expect, it } from 'vitest';
import { messagePatterns, everyPatternContains } from '$lib/testing/messageFile.js';
import { LOCALES, readMessages as localeMessages } from '$lib/testing/pages/profile';

const NOTICE_KEY = 'membership_not_active_notice';
const REFUSAL_KEYS = ['roster_deactivate_refused_admin', 'roster_deactivate_refused_librarian'];

describe('#255 copy — the "not active" binding (Gama)', () => {
	it("en: the notice says 'not active' and never 'removed'/'deleted'/'deactivated'", () => {
		const messages = localeMessages('en');
		const patterns = messagePatterns(messages[NOTICE_KEY]).join(' ');
		expect(patterns.toLowerCase()).toContain('not active');
		expect(patterns).not.toMatch(/removed|deleted|deactivated/i);
	});

	it("et: relationship-language — never 'eemaldatud'/'kustutatud'/'deaktiveeritud'", () => {
		const messages = localeMessages('et');
		const patterns = messagePatterns(messages[NOTICE_KEY]).join(' ');
		expect(patterns).not.toMatch(/eemaldatud|kustutatud|deaktiveeritud/i);
	});

	it('the notice points at the choir, not support: the collective is a parameter of the copy', () => {
		const messages = localeMessages('en');
		expect(everyPatternContains(messages[NOTICE_KEY], '{collective}')).toBe(true);
	});
});

describe('#255 copy — the refusal names the remedy (Gama binding, the #252 lesson)', () => {
	it.each(REFUSAL_KEYS)('%s carries the collective placeholder in every locale', (key) => {
		for (const locale of LOCALES) {
			const messages = localeMessages(locale);
			expect(
				everyPatternContains(messages[key], '{collective}'),
				`${locale}.json ${key} lacks {collective}`
			).toBe(true);
		}
	});
});

// (*MVOX:Tallis*)
