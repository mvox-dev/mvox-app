// #345 — locale-parity guard for the click-to-copy surface: the three copy-
// flow keys stay present and non-empty in ALL FOUR locales — a GREEN that
// "simplifies" by dropping the now-static `admin_invite_copied` from a locale
// file would strip the announcement text itself.
// #360 adds a WORDING guard on `admin_invite_copy_error` (see below): the key
// is REWORDED (still no new keys) to name the re-send recourse.
//
// Pattern: page.ux-polish-i18n.spec.ts / page.deactivate-i18n.spec.ts (pure
// source scan of messages/*.json — no rendering; the page spec
// page.admin-invite-copy.spec.ts pins WHERE each key renders via key-echo
// mocks).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

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

// ── #360 — the failure copy names the re-send recourse ────────────────────────
//
// Gama's ruling (issue #360, verbatim): "a failed copy says plainly that the
// link could not be copied and that the invite can be re-sent" — the recourse
// lives in the MESSAGE because the manual-selection fallback is deliberately
// gone: with nothing on screen to select, the reworded string is the only
// recovery path the user is told about. Both surfaces render this same key
// (`admin_invite_copy_error`), so one wording guard covers both.
//
// The page suites (page.admin-invite-copy.spec.ts, page.roster-invite-copy
// .spec.ts) pin that the alert renders THIS key; this guard pins that the key
// SAYS what the alert must say — per-locale stems, so Comenius keeps phrasing
// freedom, but "names re-sending the invite" is machine-checked.
//
// HONESTY FENCE (Gama): nothing may imply the link was protected — the copy
// merely failed; the token is as live as ever until re-sending replaces it.

/** Every rendered pattern must reference the INVITE and a RE-SEND action. */
const RESEND_STEMS: Record<(typeof LOCALES)[number], RegExp[]> = {
	en: [/invite/i, /re-?send/i],
	et: [/kutse/i, /uuesti/i],
	lv: [/ielūgum|uzaicināj/i, /vēlreiz|atkārtoti|no jauna/i],
	uk: [/запрошенн/i, /повторно|ще раз|знову/i]
};

/** No pattern may claim the secret was protected/kept safe. */
const PROTECTION_CLAIMS: Record<(typeof LOCALES)[number], RegExp> = {
	en: /protect|secur|safe/i,
	et: /kaits|turvali/i,
	lv: /aizsarg|droš/i,
	uk: /захищ|безпеч/i
};

describe('#360 admin_invite_copy_error — reworded to name the re-send recourse, all four locales', () => {
	it.each(LOCALES)('%s.json: the failure copy names re-sending the invite', (locale) => {
		const patterns = messagePatterns(localeMessages(locale)['admin_invite_copy_error']);
		expect(patterns.length, `${locale}.json admin_invite_copy_error is empty`).toBeGreaterThan(0);
		for (const pattern of patterns) {
			for (const stem of RESEND_STEMS[locale]) {
				expect(
					stem.test(pattern),
					`${locale}.json admin_invite_copy_error must name the re-send recourse (missing ${stem}): "${pattern}"`
				).toBe(true);
			}
		}
	});

	it.each(LOCALES)('%s.json: the failure copy implies NO protection of the link (honesty fence)', (locale) => {
		const patterns = messagePatterns(localeMessages(locale)['admin_invite_copy_error']);
		for (const pattern of patterns) {
			expect(
				PROTECTION_CLAIMS[locale].test(pattern),
				`${locale}.json admin_invite_copy_error must not imply the link was protected: "${pattern}"`
			).toBe(false);
		}
	});
});
