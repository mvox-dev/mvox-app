import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';

// mvox-app#278 (Gama ruling, issue comment 5564100053, 2026-09-07) — the
// writer-by-construction guard. #163 C6 style: source-level, walk-the-tree,
// no cleverness about HOW a write happens.
//
// Bentham's answer to the original open question — "only lib/ledger-writer.ts
// writes into seed-results/ today" — is TRUE and does not retire the guard.
// It is a claim about the present; this guard is about the future. The
// `.gitignore` blanket-ignore from #185 was also correct on the day it was
// written, and it still ended up force-added past ~50 times (#274's hole A).
// "Only the writer writes" has the same shape as "nobody commits seed
// results" — an accurate description of current practice that nothing
// prevents from drifting. The failure this guards against is irreversible
// in a way a missed DRY_RUN or a stale comment is not: real member PII in a
// public repo's git history cannot be un-committed, only rewritten-out at
// much greater cost. Cheap guard, permanent failure — that asymmetry is the
// whole argument (Gama, verbatim reasoning on the ruling).
//
// PREDICATE (Bentham's ruling, act-and-report, relayed via #278): any
// non-spec `.ts` file under `scripts/migrations/` that calls `writeFileSync`
// WITHOUT importing `lib/ledger-writer` is a violation — except the writer
// itself and an ENUMERATED grandfather list of exactly 12 pre-existing
// scripts. This is deliberately a per-FILE check (does this file import the
// writer at all), not a per-call-site check bound to a specific destination
// path — matching Gama's "it does not need to be clever about *how* the
// write happens; if a future script finds a novel way in, the guard failing
// to catch that is acceptable. It has to close the obvious door, not every
// door." Confirmed against seed-182-crede-sections-2026-08-27.ts, which
// calls `writeFileSync` directly for an UNRELATED snapshot artifact
// (`scripts/migrations/snapshots/`) but also imports `lib/ledger-writer` for
// its ledger — the file-level check correctly passes it; a call-site-level
// check would have needed to understand which write targets seed-results/,
// which is exactly the cleverness the ruling says not to build.
//
// GRANDFATHER LIST — why enumerated, not silent. These 12 scripts predate
// #274, write straight to `seed-results/` via their own local `writeFileSync`
// (the pre-#274 pattern), and were outside #274's audit scope (neither
// crede-touching nor `ledgers/`-origin, so both audit criteria missed them).
// All are polyphony-era, already DRY_RUN-guarded, synthetic-data artefacts —
// low risk TODAY. The risk the guard exists for is a FUTURE crede-instance
// script pasted from one of these as a starting template (Gama: "someone
// starting from an existing script... a one-off written fresh, or one
// copied from git history... inherits none of tonight's work"). Migrating
// these 12 onto the shared writer is real, deferred hygiene — tracked as an
// explicit unchecked item on mvox-app#278, NOT done in this round, so the
// grandfather set is the STATED answer to "why do these still bypass the
// writer", never an implicit one a reader has to reconstruct. A NEW script
// pasted from one of these twelve is a NEW file — not on this list — and
// fails the guard loudly, which is the actual protection.
const GRANDFATHERED_PRE_274_WRITERS = [
	'config-menu-admin-only-2026-08-09.ts',
	'db-root-owner-backfill-2026-08-09.ts',
	'delete-corroborated-orphans-2026-08-08.ts',
	'library-instance-tier-widen-2026-08-08.ts',
	'library-visibility-2026-08-08.ts',
	'member-display-config-2026-08-08.ts',
	'menu-empty-shells-2026-08-08.ts',
	'meta-descriptions-2026-08-09.ts',
	'narrow-person-refs-2026-08-08.ts',
	'orphan-115-disposition-2026-08-08.ts',
	'retire-application-probe-bulletin-2026-08-08.ts',
	'widen-member-refs-2026-08-07.ts'
] as const;

/** The writer itself, self-exempt — same convention as C6 excluding its own file. */
const WRITER_REL_PATH = join('lib', 'ledger-writer.ts');

function violations(): string[] {
	const migrationsDir = join(import.meta.dirname, '..'); // scripts/migrations/lib → scripts/migrations
	const candidates = findSourceFiles(migrationsDir, ['.ts']);
	const out: string[] = [];
	for (const full of candidates) {
		const rel = relative(migrationsDir, full);
		if (rel.endsWith('.spec.ts')) continue; // tests may reference writeFileSync in mocks/assertions
		if (rel === WRITER_REL_PATH) continue; // the writer is the sole intended caller
		if ((GRANDFATHERED_PRE_274_WRITERS as readonly string[]).includes(rel)) continue;

		const content = readFileSync(full, 'utf-8');
		if (content.includes('writeFileSync') && !content.includes('ledger-writer')) {
			out.push(rel);
		}
	}
	return out.sort();
}

describe('mvox-app#278 — only lib/ledger-writer.ts writes seed-results/ ledgers (writer-by-construction)', () => {
	it('no non-spec .ts under scripts/migrations/, outside the writer and the enumerated grandfather list, calls writeFileSync without importing lib/ledger-writer', () => {
		expect(
			violations(),
			'A new script bypassing lib/ledger-writer.ts was found. If this is a genuinely new pre-#274-style ' +
				'artefact writer, route it through lib/ledger-writer.ts instead — that is the fix, not adding it ' +
				'to GRANDFATHERED_PRE_274_WRITERS above (that list is closed; it names exactly the 12 scripts that ' +
				'predate #274, not a place to file new exemptions).'
		).toEqual([]);
	});

	it('the grandfather list itself still matches reality — exactly these 12, no fewer, no more', () => {
		// Guards the guard: if a grandfathered script gets migrated onto the
		// writer (the deferred #278 hygiene item), its entry here becomes
		// stale — this fails loudly rather than silently over-exempting.
		const migrationsDir = join(import.meta.dirname, '..');
		const stillBypassing = (GRANDFATHERED_PRE_274_WRITERS as readonly string[]).filter((rel) => {
			const content = readFileSync(join(migrationsDir, rel), 'utf-8');
			return content.includes('writeFileSync') && !content.includes('ledger-writer');
		});
		expect(stillBypassing.sort(), 'a grandfathered script no longer bypasses the writer — remove it from the list').toEqual(
			[...GRANDFATHERED_PRE_274_WRITERS].sort()
		);
	});
});

// (*MVOX:Perotin*)
