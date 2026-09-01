import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSourceFiles, isSoleCreatePathViolation } from '$lib/testing/soleLiteralGuard';

// T4.5/#31 AC3 — "exactly ONE invite mechanism exists in this repo", proven
// structurally (same pattern as the T4.4 sole-create-path guard):
//
// 1. `entu_user` is the create-payload literal every invite MINT needs (it is
//    what makes entu-api mint the invite JWT, utils/entity.js:462-468) — only
//    lib/invite/inviteData.ts may contain it.
// 2. `auth?account=` is the literal every invite REDEMPTION needs (the
//    account-scoped /auth exchange) — only lib/invite/redeem.ts may contain it.
//    The normal login exchange is db-less by design (builds a bare `auth` URL)
//    and never collides.
//
// The walk includes `.svelte` files — route pages could otherwise hide a second
// UI-side mechanism the `.ts`-only walk would miss.

const MINT_NEEDLE = 'entu_user';
// #193 — lib/profile/linkedIdentities.ts READS the entu_user property (the
// profile page's linked-accounts display) but is not a mint mechanism: the
// literal that actually mints (INVITE_MINT_TRIGGER) still lives only in
// inviteData.ts (see the narrower companion guard in
// lib/invite/selfLink.spec.ts, which pins that literal to exactly one file).
const MINT_EXEMPT = ['lib/invite/inviteData.ts', 'lib/profile/linkedIdentities.ts'];
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
			isSoleCreatePathViolation('lib/invite/inviteData.ts', "{ type: 'entu_user' }", MINT_NEEDLE, MINT_EXEMPT)
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

	it('only lib/invite/inviteData.ts contains the invite-mint literal', () => {
		expect(violations(MINT_NEEDLE, MINT_EXEMPT)).toEqual([]);
	});

	it('only lib/invite/redeem.ts contains the account-scoped redemption literal', () => {
		expect(violations(REDEEM_NEEDLE, REDEEM_EXEMPT)).toEqual([]);
	});
});
