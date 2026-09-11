// #321 RED — the partial-list notice copy lands in ALL FOUR locales
// (pattern: page.deactivate-i18n.spec.ts / page.ux-polish-i18n.spec.ts —
// audited from the message files themselves).
//
// The key contract (page specs render these through key-echo mocks; GREEN
// translates for real):
//   - library_partial_notice     — /library (works/editions/copies/lendings)
//   - rsvp_partial_notice        — agenda, the singer's lifetime answer set
//   - attendance_partial_notice  — agenda, the member's lifetime attendance
//   - roster_partial_notice      — /roster (active members, the archived-member
//                                  panel, and the admin_member_record overlay
//                                  behind the real names) — added by the #321
//                                  review F2 fix
//   - season_manage_partial_notice — the agenda's season-manage panel: its series
//                                  list and the season-wide event read behind the
//                                  occurrence counts. Added by the #321 review F1
//                                  fix, which took that panel from
//                                  console.warn-only to said-on-screen.
//   - picker_partial_members_notice / picker_partial_options_notice — the two
//                                  CLOSED-SET picker families, from the PO's
//                                  reachability ruling (2026-09-11): a truncated
//                                  option list reads as an ABSENCE, so it says so
//                                  inside the picker. Deliberately shared across
//                                  surfaces (the library's borrower and edition
//                                  pickers, the agenda/admin person selects, the
//                                  attendance panel) because the fact they state
//                                  is the same one.
//   - season_summary_partial_notice — the agenda's season attendance-rate table.
//                                  Confirmed in scope on the PO's second pass: the
//                                  reachability test EXTENDED the display-list
//                                  criterion to option-lists rather than replacing
//                                  it, and a read surface that silently drops
//                                  singers is the defect this issue was filed
//                                  about — the more so in a table that invites
//                                  comparison between named people.
//
// The copy MAY state real numbers ("showing N of M" — probe-proven leak-safe,
// scripts/migrations/probes/probe-321-authed-lesser-tier-subset-live-2026-09-11T00-42-57-032Z.json);
// whether it does is GREEN's sentence-level choice, so only presence and
// non-emptiness are pinned here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

const KEYS = [
	'library_partial_notice',
	'rsvp_partial_notice',
	'attendance_partial_notice',
	'roster_partial_notice',
	'season_manage_partial_notice',
	'picker_partial_members_notice',
	'picker_partial_options_notice',
	'season_summary_partial_notice'
];

function localeMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#321 copy — partial-list notices present in all four locales', () => {
	it.each(LOCALES)('%s.json carries every notice key, non-empty', (locale) => {
		const messages = localeMessages(locale);
		for (const key of KEYS) {
			expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
			expect(isMessageEmpty(messages[key]), `${locale}.json ${key} empty`).toBe(false);
		}
	});
});

// (*MVOX:Tallis* — RED spec, #321)
// (*MVOX:Josquin* — #321 review F2: roster_partial_notice)
// (*MVOX:Josquin* — #321 review F1: season_manage_partial_notice)
// (*MVOX:Josquin* — #321 review F2 second pass: season_summary_partial_notice)
