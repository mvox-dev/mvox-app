import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSourceFiles, isSoleCreatePathViolation } from '$lib/testing/soleLiteralGuard';

// T4.4/#25 AC4 — "exactly one code path can create a profile entity; no other
// path can produce one." The four intended create sites (T4.6 ×3 lazy, T4.10 ×1
// migration, T4.7 move) don't exist yet, so this can't be proven by calling them
// — instead this is a STANDING structural guard: `_inheritrights` is the literal
// that only an explicit entity-create payload ever needs to set, so the set of
// files carrying it must equal an ENUMERATED allowlist. As of T4.5 that
// allowlist is exactly two entries:
// - lib/profile/profileData.ts — the sole profile-create path (T4.4)
// - lib/invite/inviteData.ts   — the sole invite person+member create path
//   (T4.5/#31; its own sole-mechanism guard lives in
//   lib/invite/singleInviteMechanism.spec.ts)
// The predicate/walker now live in $lib/testing/soleLiteralGuard (shared with the
// T4.5 guard — never import one spec file from another).

const NEEDLE = '_inheritrights';
const EXEMPT = ['lib/profile/profileData.ts', 'lib/invite/inviteData.ts'];

describe('isSoleCreatePathViolation (guard predicate)', () => {
	it('flags a non-exempt, non-spec file that contains the needle', () => {
		expect(isSoleCreatePathViolation('lib/onboarding/lazyCreate.ts', "type: '_inheritrights'", NEEDLE, EXEMPT)).toBe(
			true
		);
	});

	it('does NOT flag the exempt paths (profileData.ts / inviteData.ts)', () => {
		expect(isSoleCreatePathViolation('lib/profile/profileData.ts', "type: '_inheritrights'", NEEDLE, EXEMPT)).toBe(
			false
		);
		expect(isSoleCreatePathViolation('lib/invite/inviteData.ts', "type: '_inheritrights'", NEEDLE, EXEMPT)).toBe(
			false
		);
	});

	it('does NOT flag a .spec.ts file (tests may name the literal)', () => {
		expect(
			isSoleCreatePathViolation('lib/profile/profileData.spec.ts', "toContain('_inheritrights')", NEEDLE, EXEMPT)
		).toBe(false);
	});

	it('does NOT flag a file that never mentions the needle', () => {
		expect(
			isSoleCreatePathViolation('lib/agenda/agendaData.ts', 'export function listAgenda() {}', NEEDLE, EXEMPT)
		).toBe(false);
	});
});

describe('T4.4 sole-create-path guard (integration — real src/ tree)', () => {
	it('no file under src/lib or src/routes outside the enumerated allowlist sets _inheritrights', () => {
		const libDir = join(import.meta.dirname, '..'); // src/lib
		const srcDir = join(libDir, '..'); // src
		const routesDir = join(srcDir, 'routes');

		const candidates = [...findSourceFiles(libDir, ['.ts']), ...findSourceFiles(routesDir, ['.ts'])];
		const violations = candidates
			.map((full) => ({ full, rel: relative(srcDir, full) }))
			.filter(({ rel, full }) => isSoleCreatePathViolation(rel, readFileSync(full, 'utf-8'), NEEDLE, EXEMPT))
			.map(({ rel }) => rel);

		expect(violations).toEqual([]);
	});
});

describe('YELLOW-T4.4.1 — the invite create path stays out of the profile domain', () => {
	it("lib/invite/inviteData.ts never contains the substring 'profile' — resolveTypeId(cfg, 'profile') stays sole to profileData.ts, and T4.5 creates NO profile entities", () => {
		const inviteDataPath = join(import.meta.dirname, '..', 'invite', 'inviteData.ts');
		const content = readFileSync(inviteDataPath, 'utf-8');
		expect(content.includes('profile')).toBe(false);
	});
});

// (*MVOX:Tallis*) — guard utilities extracted to $lib/testing/soleLiteralGuard
