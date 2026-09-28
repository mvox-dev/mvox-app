// #434 slice 6/6 RED — the offline reason every write control shows.
//
// ONE shared key, `write_unavailable_no_signal`, in all four locales. Named
// after what the user reads (no connection, so nothing can be saved), never
// after the mechanism: #343's fence in
// src/routes/event/[id]/page.pdf-open-bytes.spec.ts rejects any key matching
// /offline|cache|byte_store|bytestore/i, and that fence is not edited.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
// Review round 3 (minor): the HELD reason — shown where a draft stays on screen
// unsaved (review F2) — is a second user-facing key and gets the same fence.
const KEYS = ['write_unavailable_no_signal', 'write_held_no_signal'] as const;

function messages(locale: string): Record<string, unknown> {
	return JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')) as Record<
		string,
		unknown
	>;
}

describe.each(KEYS)('%s — an offline write reason (#434 slice 6)', (KEY) => {
	it.each(LOCALES)('%s carries the key as a non-empty plain sentence (no params)', (locale) => {
		const value = messages(locale)[KEY];
		expect(typeof value, `${locale}.${KEY}`).toBe('string');
		expect((value as string).trim().length, `${locale}.${KEY}`).toBeGreaterThan(0);
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

// (*MVOX:Tallis* — #434 slice 6 RED; held key added, review round 3 *MVOX:Josquin*)
