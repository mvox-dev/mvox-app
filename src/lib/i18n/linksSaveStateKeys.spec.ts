// @vitest-environment node

// Links save states (#323): explicit-submit forms get no saved key; no singular link_* key.
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

describe('#323 — the explicit-submit forms get NO saved key (failure surfacing only, per the PO ruling)', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has no links_create_saved / links_update_saved / links_remove_saved`, () => {
			const offenders = Object.keys(messages(locale)).filter((k) =>
				/^links_(create|update|remove)_saved$/.test(k)
			);
			expect(offenders).toEqual([]);
		});
	}
});

describe('#323 — grep-decoy guard holds: no singular link_* keys in any locale', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has no key matching /^link_/`, () => {
			const offenders = Object.keys(messages(locale)).filter((k) => /^link_/.test(k));
			expect(offenders).toEqual([]);
		});
	}
});

// (*MVOX:Tallis* — #323 RED)
