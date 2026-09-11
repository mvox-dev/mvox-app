// @vitest-environment node
//
// #326 RED — the i18n leg of the RSVP saved cue. Reads the RAW message files
// (messages/*.json), same shape as linksSaveStateKeys.spec.ts: no global
// locale-completeness spec exists, so the slice carries its own four-locale
// spec.
//
// KEY NAMING (stated choice, following the existing per-surface convention):
// the failure keys are one-per-surface (rsvp_save_failed,
// attendance_save_failed, profile_save_error, repertoire_manage_error…), and
// #323/#324 continued that per-surface shape for their saved keys
// (links_reorder_saved, repertoire_manage_saved). A SHARED cross-surface
// saved key has no precedent — so this surface's key is `rsvp_saved`.
// CONSISTENCY: the sibling slice #327 mirrors the shape with its OWN
// per-surface key (attendance_saved) — same shape, own key/node per surface
// (Gama's ruling, #328 comment 5637755878); that key is #327's to add, not
// asserted here.
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

describe('#326 — rsvp_saved exists non-empty in all four locales', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json has a non-empty rsvp_saved`, () => {
			const value = messages(locale)['rsvp_saved'];
			expect(typeof value, `${locale}.json › rsvp_saved must be a string`).toBe('string');
			expect((value as string).trim(), `${locale}.json › rsvp_saved must be non-empty`).not.toBe(
				''
			);
		});
	}
});

// (*MVOX:Tallis* — #326 RED)
