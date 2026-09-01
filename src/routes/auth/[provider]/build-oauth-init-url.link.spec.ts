// @vitest-environment happy-dom
//
// #193 RED — `intent: 'link'` on the OAuth initiation (profile auth-provider
// linking). The existing localStorage state blob is the carrier for the whole
// round trip; linking adds:
//   - intent 'link' (new union member on OAuthState / OAuthInitArgs),
//   - linkPersonId — the INITIATING person, replayed by the callback as the
//     redemption's expectedEntityId tripwire,
//   - invite {db, token} — the freshly self-minted invite, riding the blob only.
//
// Hazard 3 (SPIKE, 2026-09-01): buildOAuthInitUrl unconditionally sets
// `login_hint` from getUser().email — for 'link' that pre-fills the account the
// user already HAS, steering them back into their existing identity (which
// entu-api then binds as a DUPLICATE entry — no dedupe). The link intent MUST
// suppress login_hint.
//
// Bearer hygiene (SPIKE finding): the self-link flow has no cross-page handoff —
// the token must never enter ANY URL (neither the Entu init URL nor an mvox one).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeState, OAUTH_STATE_KEY } from '$lib/auth/state';

// Sever the `$env/dynamic/public` chain (entu-config) — that virtual module
// doesn't resolve under happy-dom (same rationale as the sibling spec).
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { buildOAuthInitUrl } from './build-oauth-init-url';
import { setToken, setUser } from '$lib/auth/storage';

const LINK_TOKEN = 'tok.link.abc';

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

function storedState() {
	const blob = localStorage.getItem(OAUTH_STATE_KEY);
	expect(blob).not.toBeNull();
	return decodeState(blob!);
}

function buildLink() {
	return buildOAuthInitUrl({
		provider: 'e-mail',
		origin: 'https://mvox.app',
		returnTo: '/profile?linked=1',
		intent: 'link',
		nonce: 'n-link-1',
		invite: { db: 'polyphony', token: LINK_TOKEN },
		linkPersonId: 'person-me'
	});
}

describe('buildOAuthInitUrl — link intent (#193)', () => {
	it('stashes the FULL link state in the blob: intent, invite carrier and the initiating person', () => {
		buildLink();
		expect(storedState()).toEqual({
			nonce: 'n-link-1',
			return_to: '/profile?linked=1',
			intent: 'link',
			provider: 'e-mail',
			invite: { db: 'polyphony', token: LINK_TOKEN },
			linkPersonId: 'person-me'
		});
	});

	it('SUPPRESSES login_hint even when the signed-in user has an email — prefilling would steer the user back into the identity they already have', () => {
		setToken('jwt-me');
		setUser({ _id: 'person-me', email: 'me@example.com', name: 'Me' });

		const url = buildLink();

		expect(url).not.toContain('login_hint');
		expect(url).not.toContain('me%40example.com');
		expect(url).toContain('auth/e-mail');
	});

	it('the invite token appears in NO URL — not the Entu init URL, not window.location', () => {
		const url = buildLink();
		expect(url).not.toContain(LINK_TOKEN);
		expect(window.location.href).not.toContain(LINK_TOKEN);
	});

	it('regression pin: a plain login intent still sends login_hint (the suppression is link-only)', () => {
		setToken('jwt-me');
		setUser({ _id: 'person-me', email: 'me@example.com', name: 'Me' });

		const url = buildOAuthInitUrl({
			provider: 'google',
			origin: 'https://mvox.app',
			returnTo: '/agenda',
			intent: 'login',
			nonce: 'n1'
		});

		expect(url).toContain('login_hint=me%40example.com');
	});
});

// (*MVOX:Tallis* — #193 RED: link-intent OAuth initiation)
