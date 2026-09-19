// mvox-app#401 — GREEN. Reconstructs the result ledger for the #369 remedy's
// live run (15.09.2026 14:39 EEST): 19 self-`_editor` grants on crede, per
// Mihkel's verbatim authorization at the team console, post-verify sweep
// 24/24. That run predates issue-standard.md §12 (adopted 2026-09-18, which
// requires a live run to commit its result ledger) — the script
// (remedy-369-crede-self-editor-grant-2026-09-15.ts) is already committed;
// its result was not. This script builds the missing ledger AFTER THE FACT,
// from #369's own recorded body and its already-written (gitignored)
// instance ledger — NO live Entu call, no network, none of the live
// loaders (the runner config helper, credentials, or the Entu request
// client).
//
// Ids and counts only (ER-26: bare ids, never `.string`); no name, email,
// phone, birthdate or id_code value anywhere in the payload — nothing here
// needs those, so the DEFAULT_REDACT_FIELDS denylist in lib/ledger-writer.ts
// never even has occasion to fire.
//
// `sensitive: true` (this is crede) + `committed: { allow: [...] }` (the
// #402 allowlist twin) gets us both halves in one call: the usual instance
// twin lands in gitignored crede-instance/ (stock writeLedger behavior,
// pinned here per the task ruling "either is fine, pin it" — nothing
// downstream reads it), and the committed twin — ids, counts, the sweep
// result, and the reconstruction marker, nothing else — lands tracked in
// plain seed-results/, the one file this issue is actually about.
//
// Precedent for the reconstruction marker shape: seed-results/t3-1-bundles-
// 1-2-3-reconstructed-2026-08-07T10-46-51-000Z.json.

import { writeLedger } from '../lib/ledger-writer';

// The 19 person ids from #369's TARGET_IDS (remedy-369-crede-self-editor-
// grant-2026-09-15.ts:47-67) — every one of them received the grant in the
// live run (no flagged/skip outcomes that day). Ids only — never `.string`.
const PERSON_IDS = [
	'6a92a3f0ca67df980f415489',
	'6a92a3f1ca67df980f4154a3',
	'6a92a3f2ca67df980f4154bd',
	'6a92a3f3ca67df980f4154d7',
	'6a92a3f4ca67df980f4154f1',
	'6a92a3f4ca67df980f41550b',
	'6a92a3f5ca67df980f415525',
	'6a92a3f6ca67df980f41553f',
	'6a92a3f6ca67df980f415559',
	'6a92a3f7ca67df980f415573',
	'6a92a3f8ca67df980f41558d',
	'6a92a3f8ca67df980f4155a7',
	'6a92a3f9ca67df980f4155c1',
	'6a92a3faca67df980f4155db',
	'6a92a3faca67df980f4155f5',
	'6a92a3fbca67df980f41560f',
	'6a92a3fcca67df980f415629',
	'6a92a3fcca67df980f415643',
	'6a92a3feca67df980f415677'
];

async function main(): Promise<void> {
	writeLedger({
		scriptName: 'reconstructed-401-ledger-15-09-grant-run',
		dryRun: false,
		db: 'mvox_crede',
		sensitive: true,
		// mvox-app#417 — the recorded run of record already names its
		// authorizer; passed through so the new live-run preflight (which
		// this reconstruction, run at import time with dryRun:false, is
		// subject to like any other live write) has something to check.
		// Name and channel, no URL, and that is the honest value here: this
		// authorization was spoken at the team console and written down in
		// the BODY of #369 ("Authorized by Mihkel at the team console,
		// verbatim: …"), which carries no comment to link to. #417 review
		// round 2 (Bentham) flagged the gap between this example and the
		// preflight's error text; the text now states what it enforces
		// (non-blank, not the sentinel, no '@') and asks for a link only
		// where one exists — do not copy a fabricated URL in here to make a
		// shape look satisfied.
		authorizedBy: 'Mihkel (team console, verbatim)',
		committed: {
			allow: [
				'personIds',
				'grantCount',
				'postSweep',
				'held',
				'of',
				'runAt',
				'authorizedBy',
				'reconstructed',
				'reconstructedAt',
				'reconstructionNote'
			]
		},
		payload: {
			personIds: PERSON_IDS,
			grantCount: PERSON_IDS.length,
			postSweep: { held: 24, of: 24 },
			runAt: '2026-09-15T14:39+03:00',
			authorizedBy: 'Mihkel (team console, verbatim)',
			reconstructed: true,
			reconstructedAt: new Date().toISOString(),
			reconstructionNote:
				'#401 reconstructed, never live-captured — built after the fact from #369\'s own recorded run (script committed at remedy-369-crede-self-editor-grant-2026-09-15.ts; this ledger is its missing result).'
		}
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

// (*MVOX:Tallis*)
