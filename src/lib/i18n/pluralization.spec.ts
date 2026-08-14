// @vitest-environment happy-dom
//
// YELLOW-128.1 regression guard.
//
// Every other spec in this repo stubs `$lib/paraglide/messages.js` with hand-
// written arrow functions, so a message file that the Paraglide compiler
// cannot parse still yields a fully green `pnpm test` — the defect only
// surfaces at `pnpm build`, i.e. on the Cloudflare Pages deploy. This spec
// deliberately imports the REAL compiled messages so message-file syntax is
// covered by the test suite.
//
// It also pins the behaviour the ICU-plural attempt was reaching for: real
// CLDR category selection per locale, not a single invariant string. Note the
// categories exercised below are CLDR's, not intuition's — lv puts 0 in
// `zero`, uk splits 2-4 (`few`) from 5-20 (`many`) from fractional (`other`).
import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { m } from '$lib/paraglide/messages.js';
import { overwriteGetLocale, type Locale } from '$lib/paraglide/runtime.js';
import { messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

function withLocale(locale: Locale) {
	overwriteGetLocale(() => locale);
}

afterEach(() => {
	overwriteGetLocale(() => 'en' as Locale);
});

describe('library_available_summary pluralization', () => {
	it('selects singular vs plural in en', () => {
		withLocale('en');
		expect(m.library_available_summary({ count: 1 })).toBe('1 copy available for lending');
		expect(m.library_available_summary({ count: 0 })).toBe('0 copies available for lending');
		expect(m.library_available_summary({ count: 7 })).toBe('7 copies available for lending');
	});

	it('selects singular vs plural in et', () => {
		withLocale('et');
		expect(m.library_available_summary({ count: 1 })).toBe('1 eksemplar saadaval laenutamiseks');
		expect(m.library_available_summary({ count: 3 })).toBe('3 eksemplari saadaval laenutamiseks');
	});

	it('selects zero/one/other in lv', () => {
		withLocale('lv');
		// CLDR lv: n=0 and n%10=0 -> zero; n%10=1 and n%100!=11 -> one.
		expect(m.library_available_summary({ count: 0 })).toBe('0 eksemplāru pieejami izsniegšanai');
		expect(m.library_available_summary({ count: 1 })).toBe('1 eksemplārs pieejams izsniegšanai');
		expect(m.library_available_summary({ count: 3 })).toBe('3 eksemplāri pieejami izsniegšanai');
	});

	it('selects one/few/many in uk', () => {
		withLocale('uk');
		expect(m.library_available_summary({ count: 1 })).toBe('1 примірник доступний для видачі');
		expect(m.library_available_summary({ count: 3 })).toBe('3 примірники доступні для видачі');
		expect(m.library_available_summary({ count: 5 })).toBe('5 примірників доступно для видачі');
	});

	it('no locale file uses inline ICU MessageFormat — the plugin cannot parse it', () => {
		// The bug this spec exists for: `{count, plural, one {# copy} other {# copies}}`
		// is valid ICU but NOT valid @inlang/plugin-message-format. It fails at
		// `pnpm build` with "Invalid markup placeholder", killing the deploy.
		//
		// This assertion is a SOURCE scan on purpose. The compiled-output tests
		// above can pass on a stale ./src/lib/paraglide when the compiler errors
		// mid-run, so they are not a reliable regression net on their own; this
		// one reads messages/*.json and cannot be fooled by build artifacts.
		const icuArgument = /\{\s*\w+\s*,\s*(?:plural|select|selectordinal)\s*,/;
		const offenders: string[] = [];
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const file = `messages/${locale}.json`;
			const messages = JSON.parse(readFileSync(resolve(file), 'utf8')) as MessageFile;
			for (const [key, value] of Object.entries(messages)) {
				if (key.startsWith('$')) continue; // $schema
				for (const pattern of messagePatterns(value)) {
					if (icuArgument.test(pattern)) {
						offenders.push(`${file} ${key}: inline ICU argument — use a variant array`);
					}
					if (pattern.includes('#')) {
						offenders.push(`${file} ${key}: "#" is not a Paraglide placeholder — use {count}`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it('never falls through to the message-key fallback', () => {
		// The compiler emits `return "library_available_summary"` when no CLDR
		// category matched — that is the shape of a missing variant, and it would
		// render the raw key to the user.
		for (const locale of ['en', 'et', 'lv', 'uk'] as Locale[]) {
			withLocale(locale);
			for (const count of [0, 1, 2, 3, 5, 11, 21, 100]) {
				expect(m.library_available_summary({ count })).not.toBe('library_available_summary');
			}
		}
	});
});
