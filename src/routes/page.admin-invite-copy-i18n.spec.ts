// The invite copy-flow keys in all four locales; the failure copy names re-sending the invite.
import { describe, expect, it } from 'vitest';
import { messagePatterns } from '$lib/testing/messageFile.js';
import { LOCALES, readMessages as localeMessages } from '$lib/testing/pages/profile';

const RESEND_STEMS: Record<(typeof LOCALES)[number], RegExp[]> = {
	en: [/invite/i, /re-?send/i],
	et: [/kutse/i, /uuesti/i],
	lv: [/ielūgum|uzaicināj/i, /vēlreiz|atkārtoti|no jauna/i],
	uk: [/запрошенн/i, /повторно|ще раз|знову/i]
};

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
