// Only the allowlisted create paths may carry the _inheritrights literal; one creates profiles.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSourceFiles, isSoleCreatePathViolation } from '$lib/testing/soleLiteralGuard';

const NEEDLE = '_inheritrights';
const EXEMPT = [
	'lib/profile/profileData.ts',
	'lib/invite/inviteCreate.ts',
	'lib/sections/sectionActions.ts',
	'lib/links/linkActions.ts',
	'lib/testing/rightsWrites.ts'
];

describe('isSoleCreatePathViolation (guard predicate)', () => {
	it('flags a non-exempt, non-spec file that contains the needle', () => {
		expect(isSoleCreatePathViolation('lib/onboarding/lazyCreate.ts', "type: '_inheritrights'", NEEDLE, EXEMPT)).toBe(
			true
		);
	});

	it('does NOT flag the exempt paths (profileData.ts / inviteCreate.ts)', () => {
		expect(isSoleCreatePathViolation('lib/profile/profileData.ts', "type: '_inheritrights'", NEEDLE, EXEMPT)).toBe(
			false
		);
		expect(isSoleCreatePathViolation('lib/invite/inviteCreate.ts', "type: '_inheritrights'", NEEDLE, EXEMPT)).toBe(
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
	it.each(['inviteData.ts', 'inviteConstants.ts', 'inviteCreate.ts', 'inviteSelfLink.ts'])(
		"lib/invite/%s never contains the substring 'profile' — resolveTypeId(cfg, 'profile') stays sole to profileData.ts, and T4.5 creates NO profile entities",
		(file) => {
			const content = readFileSync(join(import.meta.dirname, '..', 'invite', file), 'utf-8');
			expect(content.includes('profile')).toBe(false);
		}
	);
});

describe('T4.7/#27 — the visibility-move modules compose on the sole create path, never re-implement it', () => {
	const here = import.meta.dirname; // src/lib/profile
	for (const file of ['fieldMove.ts', 'fieldMoveQueue.ts']) {
		it(`${file} contains NO _inheritrights literal and NO resolveTypeId(cfg,'profile') — it funnels every create through createOwnProfile, so the allowlist stays unchanged`, () => {
			const content = readFileSync(join(here, file), 'utf-8');
			// The two markers the sole-create-path guard keys on must stay sole to profileData.ts.
			expect(content.includes('_inheritrights')).toBe(false);
			expect(content).not.toMatch(/resolveTypeId\([^)]*['"]profile['"]/);
		});
	}

	it("the allowlist is still exactly the T4.4/T4.5/#264-item-6/#256 entries — T4.7 added NO new create site", () => {
		expect(EXEMPT).toEqual([
			'lib/profile/profileData.ts',
			'lib/invite/inviteCreate.ts',
			'lib/sections/sectionActions.ts',
			'lib/links/linkActions.ts',
			'lib/testing/rightsWrites.ts'
		]);
	});
});

// (*MVOX:Tallis*) — guard utilities extracted to $lib/testing/soleLiteralGuard
