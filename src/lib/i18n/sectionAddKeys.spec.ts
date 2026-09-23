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
//
// F1 review fix — `roster_section_write_failed` is the section-write banner's
// ONE message, shared by assign, unassign and move. It replaced
// `roster_section_assign_failed` ("The section was created, but the member
// couldn't be added to it."), which was written for the retired picker-CREATE
// flow: after #470 nothing on this path creates a section, so that sentence was
// untrue for all three writers (and actively backwards for a refused unassign).
// The new string must therefore stay NEUTRAL about which way the change went and
// must not claim anything was created — asserted per locale below.
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

describe('#470 F1 — roster_section_write_failed exists, non-empty, in all four locales', () => {
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
		it(`${locale}.json has a non-empty, create-free roster_section_write_failed`, () => {
			const value = messages(locale)['roster_section_write_failed'];
			expect(value, `${locale}.json › roster_section_write_failed must exist`).toBeDefined();
			expect(
				isMessageEmpty(value),
				`${locale}.json › roster_section_write_failed must be non-empty`
			).toBe(false);
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
