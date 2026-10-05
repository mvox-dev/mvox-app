// The offline reasons every write control shows, named for what the user reads, not the mechanism.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
// The held reason shows where an unsaved draft stays on screen; it gets the same fence.
// So do the two lines a feedback saved on the device shows (#611).
const KEYS = [
	'write_unavailable_no_signal',
	'write_held_no_signal',
	'feedback_saved_send_later',
	'feedback_send_after_sign_in'
] as const;

function messages(locale: string): Record<string, unknown> {
	return JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')) as Record<
		string,
		unknown
	>;
}

describe.each(KEYS)('%s — an offline write reason (#434 slice 6)', (KEY) => {
	it.each(LOCALES)('%s carries the key as a plain sentence (no params)', (locale) => {
		const value = messages(locale)[KEY];
		expect(value as string, `${locale}.${KEY} takes no params`).not.toMatch(/\{[a-z_]+\}/i);
	});

	it('the four locales are four translations, not one English string copied', () => {
		const en = messages('en')[KEY];
		for (const locale of ['et', 'lv', 'uk'] as const) {
			expect(messages(locale)[KEY], locale).not.toBe(en);
		}
	});

	it('the key name clears #343’s fence (/offline|cache|byte_store|bytestore/i)', () => {
		expect(KEY).not.toMatch(/offline|cache|byte_store|bytestore/i);
	});
});

// (*MVOX:Tallis* — #434 RED; held key added *MVOX:Josquin*)
