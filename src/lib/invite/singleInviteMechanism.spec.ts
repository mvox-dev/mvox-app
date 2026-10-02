// One invite mechanism: the mint literal and the redemption literal each live in named modules.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSourceFiles, isSoleCreatePathViolation } from '$lib/testing/soleLiteralGuard';

const MINT_NEEDLE = 'entu_user';
const MINT_EXEMPT = [
	'lib/invite/inviteCreate.ts',
	'lib/invite/inviteSelfLink.ts',
	'lib/profile/linkedIdentities.ts'
];
const REDEEM_NEEDLE = 'auth?account=';
const REDEEM_EXEMPT = ['lib/invite/redeem.ts'];

describe('single-invite-mechanism guard predicate', () => {
	it('flags a non-exempt, non-spec file containing the mint literal', () => {
		expect(
			isSoleCreatePathViolation('lib/onboarding/sneakyInvite.ts', "{ type: 'entu_user', string: email }", MINT_NEEDLE, MINT_EXEMPT)
		).toBe(true);
	});

	it('flags a non-exempt, non-spec file containing the redemption literal', () => {
		expect(
			isSoleCreatePathViolation('lib/auth/secondRedeemer.ts', 'fetch(`${base}auth?account=${db}`)', REDEEM_NEEDLE, REDEEM_EXEMPT)
		).toBe(true);
	});

	it('does NOT flag the exempt sole modules themselves', () => {
		expect(
			isSoleCreatePathViolation('lib/invite/inviteCreate.ts', "{ type: 'entu_user' }", MINT_NEEDLE, MINT_EXEMPT)
		).toBe(false);
		expect(
			isSoleCreatePathViolation('lib/invite/inviteSelfLink.ts', "{ type: 'entu_user' }", MINT_NEEDLE, MINT_EXEMPT)
		).toBe(false);
		expect(
			isSoleCreatePathViolation('lib/invite/redeem.ts', 'auth?account=', REDEEM_NEEDLE, REDEEM_EXEMPT)
		).toBe(false);
	});

	it('does NOT flag spec files (tests may name the literals)', () => {
		expect(
			isSoleCreatePathViolation('lib/invite/inviteData.spec.ts', 'entu_user', MINT_NEEDLE, MINT_EXEMPT)
		).toBe(false);
	});

	it('does NOT flag a file that never mentions either literal', () => {
		expect(
			isSoleCreatePathViolation('lib/auth/exchange.ts', 'const url = `${ENTU_API_BASE}auth`;', REDEEM_NEEDLE, REDEEM_EXEMPT)
		).toBe(false);
	});
});

describe('T4.5 AC3 — exactly one invite mechanism (integration, real src/ tree incl. .svelte)', () => {
	function violations(needle: string, exempt: string[]): string[] {
		const libDir = join(import.meta.dirname, '..'); // src/lib
		const srcDir = join(libDir, '..'); // src
		const routesDir = join(srcDir, 'routes');

		const candidates = [
			...findSourceFiles(libDir, ['.ts', '.svelte']),
			...findSourceFiles(routesDir, ['.ts', '.svelte'])
		];
		return candidates
			.map((full) => ({ full, rel: relative(srcDir, full) }))
			.filter(({ rel, full }) =>
				isSoleCreatePathViolation(rel, readFileSync(full, 'utf-8'), needle, exempt)
			)
			.map(({ rel }) => rel);
	}

	it('only lib/invite/inviteCreate.ts and inviteSelfLink.ts contain the invite-mint literal', () => {
		expect(violations(MINT_NEEDLE, MINT_EXEMPT)).toEqual([]);
	});

	it('only lib/invite/redeem.ts contains the account-scoped redemption literal', () => {
		expect(violations(REDEEM_NEEDLE, REDEEM_EXEMPT)).toEqual([]);
	});
});
