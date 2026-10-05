// @vitest-environment node

// Lingikogu (#256): the ruled et nav label; no singular link_* key (OAuth uses 'link').
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MessageFile = Record<string, unknown>;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function messages(locale: (typeof LOCALES)[number]): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#256 — the Estonian nav label is the ruled name', () => {
	it("et nav_links is 'Lingikogu' verbatim", () => {
		expect(messages('et')['nav_links']).toBe('Lingikogu');
	});
});

describe('#256 — grep-decoy guard: no singular link_* keys in any locale', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has no key matching /^link_/ (OAuth account-linking overloads the bare word)`, () => {
			const offenders = Object.keys(messages(locale)).filter((k) => /^link_/.test(k));
			expect(offenders).toEqual([]);
		});
	}
});

// (*MVOX:Tallis* — #256 RED)
