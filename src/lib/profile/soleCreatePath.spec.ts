import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// T4.4/#25 AC4 — "exactly one code path can create a profile entity; no other
// path can produce one." The four intended create sites (T4.6 ×3 lazy, T4.10 ×1
// migration, T4.7 move) don't exist yet, so this can't be proven by calling them
// — instead this is a STANDING structural guard: `_inheritrights` is the literal
// that only a profile-create call ever needs to set (see profileData.ts), so if
// any file OTHER than profileData.ts ever writes that literal, it is by
// definition constructing a create payload outside the sole path. Currently 0
// violations exist — a genuine forward guard (T4.6/T4.7/T4.10 land later), not a
// vacuous one: the assertion fails for real the moment a second path appears.

/**
 * Pure predicate — kept separate from the fs walk so it's unit-testable against
 * synthetic content without touching real files (the fs walk itself is simple
 * enough that testing it directly would just be re-testing node:fs).
 */
export function isSoleCreatePathViolation(
	relPath: string,
	content: string,
	needle: string,
	exemptRelPaths: string[]
): boolean {
	if (relPath.endsWith('.spec.ts')) return false; // tests may reference the literal in assertions/comments
	if (exemptRelPaths.includes(relPath)) return false;
	return content.includes(needle);
}

function findTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...findTsFiles(full));
			continue;
		}
		if (full.endsWith('.ts')) out.push(full);
	}
	return out;
}

describe('isSoleCreatePathViolation (guard predicate)', () => {
	it('flags a non-exempt, non-spec file that contains the needle', () => {
		expect(isSoleCreatePathViolation('lib/onboarding/lazyCreate.ts', "type: '_inheritrights'", '_inheritrights', [
			'lib/profile/profileData.ts'
		])).toBe(true);
	});

	it('does NOT flag the exempt path (profileData.ts itself)', () => {
		expect(isSoleCreatePathViolation('lib/profile/profileData.ts', "type: '_inheritrights'", '_inheritrights', [
			'lib/profile/profileData.ts'
		])).toBe(false);
	});

	it('does NOT flag a .spec.ts file (tests may name the literal)', () => {
		expect(isSoleCreatePathViolation('lib/profile/profileData.spec.ts', "toContain('_inheritrights')", '_inheritrights', [
			'lib/profile/profileData.ts'
		])).toBe(false);
	});

	it('does NOT flag a file that never mentions the needle', () => {
		expect(isSoleCreatePathViolation('lib/agenda/agendaData.ts', 'export function listAgenda() {}', '_inheritrights', [
			'lib/profile/profileData.ts'
		])).toBe(false);
	});
});

describe('T4.4 sole-create-path guard (integration — real src/ tree)', () => {
	it('no file under src/lib or src/routes other than profileData.ts sets _inheritrights', () => {
		const libDir = join(import.meta.dirname, '..'); // src/lib
		const srcDir = join(libDir, '..'); // src
		const routesDir = join(srcDir, 'routes');

		const candidates = [...findTsFiles(libDir), ...findTsFiles(routesDir)];
		const violations = candidates
			.map((full) => ({ full, rel: relative(srcDir, full) }))
			.filter(({ rel, full }) =>
				isSoleCreatePathViolation(rel, readFileSync(full, 'utf-8'), '_inheritrights', ['lib/profile/profileData.ts'])
			)
			.map(({ rel }) => rel);

		expect(violations).toEqual([]);
	});
});

// (*MVOX:Tallis*)
