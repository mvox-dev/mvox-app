// @vitest-environment happy-dom
// intent 'link' carries linkPersonId and the self-minted invite in the state blob, suppresses
// login_hint (it would steer back to the existing identity), and puts the token in no URL.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeState, OAUTH_STATE_KEY } from '$lib/auth/state';

// Severs the entu-config → $env/dynamic/public chain.
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

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
		invite: { db: 'sampledb', token: LINK_TOKEN },
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
			invite: { db: 'sampledb', token: LINK_TOKEN },
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

// (*MVOX:Tallis*)
