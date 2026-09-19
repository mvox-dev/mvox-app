import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';

// mvox-app#417 (RED, Tallis) — the live-run authorization fence.
// Pattern: seedResultsWriter.guard.spec.ts (#278) — source-level, walk the
// tree, no cleverness about HOW a mutation happens (Gama, quoted there: the
// guard "has to close the obvious door, not every door").
//
// RULE: every script under scripts/migrations/ that imports `loadCredeCfg`
// AND issues a mutating Entu call must call `assertLiveRunAuthorized(...)`
// (the #417 preflight exported by lib/ledger-writer.ts) BEFORE its first
// mutating call. `writeLedger` runs only AFTER the POSTs in every live
// script observed (research-417-digest.md: grant-294 POST at :115,
// writeLedger at :161), so the writer's own internal check can never stop a
// mutation — only a per-script preflight can, and only a fence keeps future
// scripts honest about calling it.
//
// MUTATION MARKERS — two, matching how every crede script mutates today:
// (1) an in-file `method: 'POST'|'PATCH'|'PUT'|'DELETE'` on its entuFetch,
// (2) an awaited call into lib/ensure-schema-type.ts's mutating helpers
//     (`ensureEntityType`/`ensurePropDef`/`ensureAddFrom`) or a local
//     `ensureEntity` (seed-293's in-file POST helper — its `method: 'POST'`
//     is caught by (1) anyway).
// A file with neither marker (the read-only probes) is out of scope.
//
// ORDERING is checked textually: the first `assertLiveRunAuthorized(` CALL
// (the `(` excludes the import line) must appear before the first mutation
// marker. Verified satisfiable for all 14 files on today's tree: 13 call
// `readDryRun()` textually before their first marker (the digest's "call the
// preflight right after readDryRun()" placement lands before it); the 14th,
// seed-233, mutates inside its exported engine `runSeed233S1` — its
// preflight belongs at the top of that engine, before `ensurePropDef`,
// which is also the better home (the gate travels with the mutating code
// its spec exercises). A textual check cannot PROVE runtime order — that
// residual is accepted per the #278 precedent above; the obvious door is a
// script that never calls the preflight at all, and that door this closes.
//
// SCOPE: `lib/` is excluded from discovery — script-runner.ts merely
// DEFINES loadCredeCfg, and the ensure-schema-type helpers receive cfg as
// an argument; run discipline (dry-run flag, authorization) belongs to the
// entrypoint script that owns the run. Spec files are excluded as always.
// Grandfathered writers from the frozen legacy db's era (loadCfg, own
// writeFileSync) never import loadCredeCfg, so they are out of scope by
// construction (#407 froze that era as dated history).

/**
 * The 14 crede-mutating scripts, enumerated from the #417 research digest
 * §(d) and re-verified against this tree by the discovery test below. A NEW
 * script that imports loadCredeCfg and mutates must BOTH appear here and
 * call the preflight — failing either test loudly is the point.
 */
const CREDE_MUTATING_SCRIPTS = [
	'grant-294-joosep-owner-crede-2026-09-09.ts',
	'probes/remedy-369-crede-self-editor-grant-2026-09-15.ts',
	'seed-178-crede-members-2026-08-27.ts',
	'seed-182-crede-sections-2026-08-27.ts',
	'seed-184-crede-members-menu-2026-08-27.ts',
	'seed-186-crede-profile-emails-2026-08-27.ts',
	'seed-187-crede-content-menus-2026-08-27.ts',
	'seed-188-phase3b-crede-sections-2026-08-29.ts',
	'seed-233-s1-event-name-propdef-crede.ts',
	'seed-246-schedule-item-type-crede-2026-09-06.ts',
	'seed-256-link-type-crede-2026-09-10.ts',
	'seed-265-admin-member-record-type-crede-2026-09-06.ts',
	'seed-282-id-code-propdef-crede-2026-09-07.ts',
	'seed-293-crede-season-repertoire-2026-09-08.ts'
] as const;

const MUTATION_MARKERS = [
	/method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/,
	/await\s+(?:ensureEntityType|ensurePropDef|ensureAddFrom|ensureEntity)\(/
];

/** Index of the first mutating call in the source, or -1 when read-only. */
function firstMutationIndex(content: string): number {
	let min = -1;
	for (const re of MUTATION_MARKERS) {
		const m = re.exec(content);
		if (m && (min === -1 || m.index < min)) min = m.index;
	}
	return min;
}

function migrationsDir(): string {
	return join(import.meta.dirname, '..'); // scripts/migrations/lib → scripts/migrations
}

function readScript(rel: string): string {
	return readFileSync(join(migrationsDir(), ...rel.split('/')), 'utf-8');
}

/** Every non-spec, non-lib script that imports loadCredeCfg AND mutates. */
function discoveredCredeMutators(): string[] {
	const out: string[] = [];
	for (const full of findSourceFiles(migrationsDir(), ['.ts'])) {
		const rel = relative(migrationsDir(), full).split(sep).join('/');
		if (rel.endsWith('.spec.ts')) continue;
		if (rel.startsWith('lib/')) continue;
		const content = readFileSync(full, 'utf-8');
		if (!content.includes('loadCredeCfg')) continue;
		if (firstMutationIndex(content) === -1) continue;
		out.push(rel);
	}
	return out.sort();
}

describe('mvox-app#417 — every crede-mutating script gates its live run on a recorded authorizer', () => {
	it('the discovered loadCredeCfg-importing mutating set matches the enumerated 14 — a new crede-mutating script must be added here AND gated', () => {
		expect(
			discoveredCredeMutators(),
			'A script importing loadCredeCfg and issuing a mutating Entu call is not in CREDE_MUTATING_SCRIPTS. ' +
				'Add it to the list AND give it the assertLiveRunAuthorized preflight before its first mutating ' +
				'call — this list is a register, not an exemption mechanism.'
		).toEqual([...CREDE_MUTATING_SCRIPTS].sort());
	});

	it('every enumerated script calls assertLiveRunAuthorized before its first mutating call', () => {
		const violations: string[] = [];
		for (const rel of CREDE_MUTATING_SCRIPTS) {
			const content = readScript(rel);
			const mutationAt = firstMutationIndex(content);
			const callMatch = /assertLiveRunAuthorized\(/.exec(content);
			if (!callMatch) {
				violations.push(`${rel}: never calls assertLiveRunAuthorized(...)`);
			} else if (mutationAt !== -1 && callMatch.index > mutationAt) {
				violations.push(
					`${rel}: first assertLiveRunAuthorized( call at index ${callMatch.index} sits after the first mutating call at index ${mutationAt}`
				);
			}
		}
		expect(
			violations,
			'A live run must throw BEFORE its first mutating call when no authorizer is recorded — call ' +
				'assertLiveRunAuthorized(dryRun, authorizedBy) (lib/ledger-writer.ts) before the first mutating ' +
				'entuFetch; writeLedger runs after the POSTs, so its internal check cannot stop a mutation.'
		).toEqual([]);
	});

	it("every enumerated script with a committed twin names 'authorizedBy' in its allow array — the tracked ledger must carry the authorizer", () => {
		const violations: string[] = [];
		for (const rel of CREDE_MUTATING_SCRIPTS) {
			const content = readScript(rel);
			if (!content.includes('committed:')) continue;
			if (!content.includes("'authorizedBy'")) {
				violations.push(`${rel}: has a committed twin but 'authorizedBy' is missing from its allow array`);
			}
		}
		expect(
			violations,
			"Done-when box 3 (#417): the committed ledger carries the authorizer and it is in its allowlist — " +
				"add 'authorizedBy' to the committed.allow array."
		).toEqual([]);
	});
});

// (*MVOX:Tallis*)
