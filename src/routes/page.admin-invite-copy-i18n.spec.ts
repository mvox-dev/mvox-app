// #345 — locale-parity guard for the click-to-copy surface. NO new keys and
// NO wording changes: #345 only MOVES where two of these strings render (the
// confirmation off the button label into the status region), so the guard pins
// that the three existing keys stay present and non-empty in ALL FOUR locales
// — a GREEN that "simplifies" by dropping the now-static `admin_invite_copied`
// from a locale file would strip the announcement text itself.
//
// Pattern: page.ux-polish-i18n.spec.ts / page.deactivate-i18n.spec.ts (pure
// source scan of messages/*.json — no rendering; the page spec
// page.admin-invite-copy.spec.ts pins WHERE each key renders via key-echo
// mocks).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

// The three keys the copy flow renders: the static button label, the moved
// confirmation, and the failure alert.
const COPY_KEYS = ['admin_invite_copy', 'admin_invite_copied', 'admin_invite_copy_error'] as const;

function localeMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#345 copy-flow keys — present and non-empty in all four locales', () => {
	it.each(LOCALES)('%s.json carries all three copy-flow keys, non-empty', (locale) => {
		const messages = localeMessages(locale);
		for (const key of COPY_KEYS) {
			expect(key in messages, `${locale}.json is missing ${key}`).toBe(true);
			expect(isMessageEmpty(messages[key]), `${locale}.json has an empty ${key}`).toBe(false);
		}
	});
});
