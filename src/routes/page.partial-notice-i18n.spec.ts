// The partial-list notice keys exist and are non-empty in all four locales.
import { describe, expect, it } from 'vitest';
import { isMessageEmpty } from '$lib/testing/messageFile.js';
import { LOCALES, readMessages as localeMessages } from '$lib/testing/pages/profile';

const KEYS = [
	'library_partial_notice',
	'rsvp_partial_notice',
	'attendance_partial_notice',
	'roster_partial_notice',
	'season_manage_partial_notice',
	'picker_partial_members_notice',
	'picker_partial_options_notice',
	'season_summary_partial_notice'
];

describe('#321 copy — partial-list notices present in all four locales', () => {
	it.each(LOCALES)('%s.json carries every notice key, non-empty', (locale) => {
		const messages = localeMessages(locale);
		for (const key of KEYS) {
			expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
			expect(isMessageEmpty(messages[key]), `${locale}.json ${key} empty`).toBe(false);
		}
	});
});

// (*MVOX:Tallis* — RED spec, #321)
// (*MVOX:Josquin* — #321 review F1/F2: roster, season_manage, season_summary notices)
