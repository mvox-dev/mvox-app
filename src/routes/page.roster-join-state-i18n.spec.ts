// The dated join-state keys: en/et exact, lv/uk only present and carrying {date}.
import { describe, expect, it } from 'vitest';
import { messagePatterns, isMessageEmpty, everyPatternContains } from '$lib/testing/messageFile.js';
import { LOCALES, readMessages as localeMessages } from '$lib/testing/pages/profile';

const NEW_KEYS = [
	'roster_member_join_state_absent',
	'roster_member_join_state_invited',
	'roster_member_join_state_expired',
	'roster_member_join_state_joined'
] as const;

const EXACT: Record<(typeof NEW_KEYS)[number], { en: string; et: string }> = {
	roster_member_join_state_absent: {
		en: 'Not invited since {date}',
		et: 'Kutsumata alates {date}'
	},
	roster_member_join_state_invited: {
		en: 'Invited {date}',
		et: 'Kutsutud {date}'
	},
	roster_member_join_state_expired: {
		en: 'Invitation expired {date}',
		et: 'Kutse aegus {date}'
	},
	roster_member_join_state_joined: {
		en: 'Member since {date}',
		et: 'Liige alates {date}'
	}
};

describe('#467 — the four dated join-state keys exist in ALL FOUR locales and carry {date}', () => {
	for (const key of NEW_KEYS) {
		it.each(LOCALES)(`${key}: %s.json defines it, non-empty, with {date}`, (locale) => {
			const messages = localeMessages(locale);
			expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
			expect(isMessageEmpty(messages[key]), `${locale}.json ${key} is empty`).toBe(false);
			expect(
				everyPatternContains(messages[key], '{date}'),
				`${locale}.json ${key} dropped {date}`
			).toBe(true);
		});
	}
});

describe('#467 — en and et carry the authored copy exactly (et = Mihkel verbatim)', () => {
	for (const key of NEW_KEYS) {
		for (const locale of ['en', 'et'] as const) {
			it(`${key}: ${locale}.json is exactly the pinned text`, () => {
				expect(messagePatterns(localeMessages(locale)[key])).toEqual([EXACT[key][locale]]);
			});
		}
	}
});

describe('#467 — the OLD three bare chip keys are GONE from every locale (retired with the chip)', () => {
	const OLD_BARE_TEXT: Record<string, string[]> = {
		en: ['Not invited', 'Invited', 'Joined'],
		et: ['Pole kutsutud', 'Kutsutud', 'Liitunud'],
		lv: ['Neuzaicināts', 'Uzaicināts', 'Pievienojies'],
		uk: ['Не запрошений', 'Запрошений', 'Приєднався']
	};

	it.each(LOCALES)('%s: none of the four keys still renders the old bare label', (locale) => {
		const messages = localeMessages(locale);
		for (const key of NEW_KEYS) {
			for (const bare of OLD_BARE_TEXT[locale]) {
				expect(
					messagePatterns(messages[key]),
					`${locale}.json ${key} still carries the retired bare label "${bare}"`
				).not.toEqual([bare]);
			}
		}
	});
});

// (*MVOX:Tallis* — #467 RED: four dated keys × four locales, en/et exact,
//  lv/uk structural; old bare labels retired)
