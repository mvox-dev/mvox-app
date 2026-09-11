// @vitest-environment node
//
// #328 RED — the i18n leg of the saved cue for the partials trio: season
// fields, event inline fields, event schedule items. Reads the RAW message
// files (messages/*.json), same shape as rsvpSavedKey.spec.ts /
// pendingGuardKeys.spec.ts: no global locale-completeness spec exists, so the
// slice carries its own four-locale spec.
//
// KEY NAMING (stated choice, following #326's stated per-surface convention —
// "one key per surface, mirroring that surface's existing failure key", the
// shape rsvp_saved/attendance_saved/links_reorder_saved/repertoire_manage_saved
// all follow). Each of the three surfaces already owns a failure key, so each
// saved key mirrors it:
//   season fields    season_manage_save_error   → season_manage_saved
//   event fields     event_edit_save_error      → event_edit_saved
//   schedule items   event_schedule_save_error  → event_schedule_saved
// (season_manage_conductor_saved is TAKEN by #325's conductor half — the
// field surface's own key derives from ITS failure key, not the conductor's.)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type MessageFile = Record<string, unknown>;

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
const KEYS = ['season_manage_saved', 'event_edit_saved', 'event_schedule_saved'] as const;

function messages(locale: (typeof LOCALES)[number]): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#328 — the trio saved keys exist non-empty in all four locales', () => {
	for (const key of KEYS) {
		for (const locale of LOCALES) {
			it(`${locale}.json has a non-empty ${key}`, () => {
				const value = messages(locale)[key];
				expect(typeof value, `${locale}.json › ${key} must be a string`).toBe('string');
				expect((value as string).trim(), `${locale}.json › ${key} must be non-empty`).not.toBe('');
			});
		}
	}
});

// (*MVOX:Tallis* — #328 RED)
