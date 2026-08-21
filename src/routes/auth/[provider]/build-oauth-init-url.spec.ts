// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeState, OAUTH_STATE_KEY } from '$lib/auth/state';

// Sever the `$env/dynamic/public` chain (entu-config) — that virtual module
// doesn't resolve under happy-dom (same rationale as run-callback-exchange.spec).
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { buildOAuthInitUrl } from './build-oauth-init-url';

const INVITE_TOKEN = 'tok.abc.def';

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

function storedState() {
	const blob = localStorage.getItem(OAUTH_STATE_KEY);
	expect(blob).not.toBeNull();
	return decodeState(blob!);
}

describe('buildOAuthInitUrl — invite intent (T4.5/#31)', () => {
	function buildInvite() {
		return buildOAuthInitUrl({
			provider: 'google',
			origin: 'https://mvox.app',
			returnTo: `/invite/${INVITE_TOKEN}`,
			intent: 'invite',
			nonce: 'n1',
			invite: { db: 'polyphony', token: INVITE_TOKEN }
		});
	}

	it('stashes the invite db + bearer token INSIDE the state blob (the only carrier across the OAuth round-trip)', () => {
		buildInvite();
		const state = storedState();
		expect(state.intent).toBe('invite');
		expect(state.invite).toEqual({ db: 'polyphony', token: INVITE_TOKEN });
	});

	it('the Entu init URL NEVER contains the invite token — the bearer secret must not transit oauth.ee', () => {
		const url = buildInvite();
		expect(url).not.toContain(INVITE_TOKEN);
		expect(url).toContain('auth/google');
	});
});

describe('buildOAuthInitUrl — non-invite blobs stay invite-free', () => {
	it('a login-intent blob carries no invite field', () => {
		buildOAuthInitUrl({
			provider: 'google',
			origin: 'https://mvox.app',
			returnTo: '/agenda',
			intent: 'login',
			nonce: 'n1'
		});
		expect(storedState().invite).toBeUndefined();
	});
});
