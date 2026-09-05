// #255 done-when 8 RED — the copy bindings, auditable from the message files
// themselves (pattern: page.ux-polish-i18n.spec.ts):
//
//   - Gama COPY BINDING (read by a person being told she is out of a choir):
//     "not active" — NEVER "removed", "deleted" or "deactivated" (punitive, or
//     jargon about a record rather than a relationship); points at the CHOIR,
//     not support. Estonian register: relationship-language, never
//     'eemaldatud'/'kustutatud'.
//   - The refusal names the REMEDY: who holds what role and where to remove it
//     — so the refusal keys must carry the collective placeholder the page
//     spec proves gets filled.
//   - All new copy lands in all four locales (en/et/lv/uk).
//
// GREEN owns the actual sentences; these tests pin the key names, their
// presence in every locale, and the forbidden-vocabulary boundary.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	isMessageEmpty,
	messagePatterns,
	everyPatternContains,
	type MessageFile
} from '$lib/testing/messageFile.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function localeMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

// The #255 key contract (page/layout specs render these through key mocks;
// GREEN translates them for real).
const NOTICE_KEY = 'membership_not_active_notice';
const REFUSAL_KEYS = ['roster_deactivate_refused_admin', 'roster_deactivate_refused_librarian'];

describe('#255 copy — presence in all four locales (done-when 8)', () => {
	it.each(LOCALES)('%s.json carries the notice and refusal keys, non-empty', (locale) => {
		const messages = localeMessages(locale);
		for (const key of [NOTICE_KEY, ...REFUSAL_KEYS]) {
			expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
			expect(isMessageEmpty(messages[key]), `${locale}.json ${key} empty`).toBe(false);
		}
	});
});

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
