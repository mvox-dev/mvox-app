// @vitest-environment node
//
// #470 RED — the i18n leg of the native section pickers' [+] control. Reads
// the RAW message files (messages/*.json), same shape as rsvpSavedKey.spec.ts:
// no global locale-completeness spec exists, so the slice carries its own
// four-locale spec.
//
// `roster_section_add_label` names the [+] for a screen reader ("Add a section
// for {name}" / "Lisa hääleliik: {name}") — it MUST carry {name} in every
// locale, or every member's [+] collapses to the same announcement.
// `roster_unassigned` (the Määramata choice) already exists and is reused, not
// re-asserted here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { everyPatternContains, isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function messages(locale: (typeof LOCALES)[number]): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#470 — roster_section_add_label exists, non-empty, with {name}, in all four locales', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has a non-empty roster_section_add_label carrying {name}`, () => {
			const value = messages(locale)['roster_section_add_label'];
			expect(value, `${locale}.json › roster_section_add_label must exist`).toBeDefined();
			expect(
				isMessageEmpty(value),
				`${locale}.json › roster_section_add_label must be non-empty`
			).toBe(false);
			expect(
				everyPatternContains(value, '{name}'),
				`${locale}.json › roster_section_add_label must carry {name} in every variant`
			).toBe(true);
		});
	}
});

// (*MVOX:Tallis* — #470 RED)
