// @vitest-environment node

// Section picker copy (#470): [+] names the member; the write banner never claims a create.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { everyPatternContains, type MessageFile } from '$lib/testing/messageFile.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function messages(locale: (typeof LOCALES)[number]): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#470 — roster_section_add_label carries {name} in all four locales', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json roster_section_add_label carries {name}`, () => {
			const value = messages(locale)['roster_section_add_label'];
			expect(
				everyPatternContains(value, '{name}'),
				`${locale}.json › roster_section_add_label must carry {name} in every variant`
			).toBe(true);
		});
	}
});

describe('#470 F1 — roster_section_write_failed never claims a create', () => {
	// The words each locale must NOT use: the retired copy's "created"/"added"
	// claim in that locale's own wording. A banner that fires on an unassign may
	// not say a section was created.
	const FORBIDDEN: Record<(typeof LOCALES)[number], string[]> = {
		en: ['creat', 'added'],
		et: ['loodi', 'loomine'],
		lv: ['izveido'],
		uk: ['створен']
	};

	for (const locale of LOCALES) {
		it(`${locale}.json has a create-free roster_section_write_failed`, () => {
			const value = messages(locale)['roster_section_write_failed'];
			const text = JSON.stringify(value).toLowerCase();
			for (const word of FORBIDDEN[locale]) {
				expect(
					text.includes(word),
					`${locale}.json › roster_section_write_failed must not claim a section was created ("${word}")`
				).toBe(false);
			}
		});

		it(`${locale}.json no longer carries the retired roster_section_assign_failed`, () => {
			expect(messages(locale)['roster_section_assign_failed']).toBeUndefined();
		});
	}
});

// (*MVOX:Tallis* — #470 RED)
