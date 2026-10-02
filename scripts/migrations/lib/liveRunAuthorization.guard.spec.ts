// #417: every crede-mutating script calls assertLiveRunAuthorized before its first mutating call.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
import { firstMutationIndex } from './mutation-markers';

// The ledger is written after the POSTs, so only a per-script preflight can stop a mutation.
// Text order cannot prove run order; the fence closes the script that never calls the preflight.

/** A new script importing loadCredeCfg that mutates must be listed here and call the preflight. */
const CREDE_MUTATING_SCRIPTS = [
	'grant-294-joosep-owner-crede-2026-09-09.ts',
	'probes/remedy-369-crede-self-editor-grant-2026-09-15.ts',
	'probes/remedy-445-duplicate-rights-values-crede-2026-09-22.ts',
	'seed-178-crede-members-2026-08-27.ts',
	'seed-182-crede-sections-2026-08-27.ts',
	'seed-184-crede-members-menu-2026-08-27.ts',
	'seed-186-crede-profile-emails-2026-08-27.ts',
	'seed-187-crede-content-menus-2026-08-27.ts',
	'seed-188-phase3b-crede-sections-2026-08-29.ts',
	'seed-233-s1-event-name-propdef-crede.ts',
	'seed-233-s2-event-name-backfill-crede.ts',
	'seed-233-s4-event-name-formula-crede.ts',
	'seed-246-schedule-item-type-crede-2026-09-06.ts',
	'seed-256-link-type-crede-2026-09-10.ts',
	'seed-265-admin-member-record-type-crede-2026-09-06.ts',
	'seed-282-id-code-propdef-crede-2026-09-07.ts',
	'seed-293-crede-season-repertoire-2026-09-08.ts',
	'seed-395-feedback-type-crede-2026-09-28.ts',
	'seed-445-person-rsvp-domain-inherit-crede.ts'
] as const;

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
	it('the discovered loadCredeCfg-importing mutating set matches the enumerated 16 — a new crede-mutating script must be added here AND gated', () => {
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

	// Inline allow arrays only: `allow: SOME_CONST` passes here; its own spec pins that array.
	const COMMITTED_ALLOW_RE = /committed:\s*\{[^}]*?allow:\s*\[[^\]]*\]/g;
	const ALLOWS_AUTHORIZED_BY = /(['"`])authorizedBy\1/;

	it("no enumerated script allowlists 'authorizedBy' — the committed envelope carries it, the allow entry only admits a payload impostor", () => {
		const violations: string[] = [];
		for (const rel of CREDE_MUTATING_SCRIPTS) {
			const content = readScript(rel);
			const allowBlocks = content.match(COMMITTED_ALLOW_RE) ?? [];
			for (const block of allowBlocks) {
				if (ALLOWS_AUTHORIZED_BY.test(block)) {
					violations.push(`${rel}: names 'authorizedBy' in its committed.allow array`);
				}
			}
		}
		expect(
			violations,
			"writeLedger writes the envelope's authorizedBy into the committed twin itself — drop 'authorizedBy' " +
				'from committed.allow; allowlisting it only opens a path for a same-named payload key.'
		).toEqual([]);
	});
});

// (*MVOX:Tallis*)
