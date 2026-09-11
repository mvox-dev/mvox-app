// @vitest-environment node
//
// #327 RED — the i18n leg of the attendance saved cue. Reads the RAW message
// files (messages/*.json), same shape as rsvpSavedKey.spec.ts (its #326
// sibling): no global locale-completeness spec exists, so the slice carries
// its own four-locale spec.
//
// KEY NAMING (per #326's stated choice (c), the per-surface convention):
//   • attendance_saved — this surface's OWN saved key, sibling to rsvp_saved /
//     links_reorder_saved / repertoire_manage_saved. Never shared with #326's
//     key: same cue shape, own key/node per surface (Gama's ruling, #328
//     comment 5637755878).
//   • attendance_tally_unconfirmed — the tally's visible optimistic marking
//     (issue #327 Done-when bullet 3, the RED stated choice pinned in
//     AttendanceSurface.saved-cue.spec.ts), named into the existing
//     attendance_tally family.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MessageFile = Record<string, unknown>;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
const KEYS = ['attendance_saved', 'attendance_tally_unconfirmed'] as const;

function messages(locale: (typeof LOCALES)[number]): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

for (const key of KEYS) {
	describe(`#327 — ${key} exists non-empty in all four locales`, () => {
		for (const locale of LOCALES) {
			it(`${locale}.json has a non-empty ${key}`, () => {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			});
		}
	});
}

// (*MVOX:Tallis* — #327 RED)
