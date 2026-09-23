// #467 RED — the roster join-state DATED lines' i18n keys, pinned in all four
// locale files (the page.roster-record-i18n.spec.ts pattern: the route spec's
// paraglide mock synthesises `[key {…}]` from the key name alone, so only this
// direct file read sees the shipped text).
//
// The chip's three bare labels become four parameterised sentences taking
// {date} (the admin_invite_show_once pattern, messages/en.json:77):
//   roster_member_join_state_absent   — "not invited since <yyyy-mm-dd>"
//   roster_member_join_state_invited  — "invited at <yyyy-mm-dd>"
//   roster_member_join_state_expired  — "invitation expired at <yyyy-mm-dd>"
//   roster_member_join_state_joined   — "member since <yyyy-mm-dd>"
//
// et is Mihkel's copy VERBATIM (issue #467, "Estonian copy, the defaults"); en
// mirrors his four request lines. lv/uk are pinned STRUCTURALLY only (present,
// non-empty, carrying {date}) — their wording is the i18n phase's call
// (Comenius), reviewed for existence + parameter, not for exact text here.
//
// The OLD three bare keys are retired with the chip itself: any survivor is a
// dead key that would let a stale JOIN_STATE_LABEL lookup keep compiling.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	messagePatterns,
	isMessageEmpty,
	everyPatternContains,
	type MessageFile
} from '$lib/testing/messageFile.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

const NEW_KEYS = [
	'roster_member_join_state_absent',
	'roster_member_join_state_invited',
	'roster_member_join_state_expired',
	'roster_member_join_state_joined'
] as const;

/** Exact copy for the two authored locales; Mihkel's et defaults verbatim. */
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

function localeMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

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
	// The three keys the #294 chip used. `roster_member_join_state_absent` and
	// siblings are REUSED names but with {date} — "gone" here means: no locale
	// may still carry the old BARE (parameterless) text for them. The bare
	// shape is exactly a value without {date}, already excluded above; what
	// this block pins additionally is that no locale kept a bare DUPLICATE
	// under the old names' text (e.g. et "Pole kutsutud" surviving anywhere
	// among the four keys).
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
