// @vitest-environment happy-dom
//
// #193 RED — dispatcher wiring: a state blob carrying `intent: 'link'` must take
// the LINK branch of the real callback orchestrator (runCallbackExchange), never
// the db-less normal-login exchange. Kept separate from run-link-callback.spec
// so this file imports only modules that exist on main — it fails FUNCTIONALLY
// (today 'link' falls through to the normal login path), pinning the integration
// rather than erroring at import time.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeState, OAUTH_STATE_KEY, type OAuthState } from '$lib/auth/state';

// #219 — run-link-callback.ts now imports listLinkedIdentities (for the
// same-identity duplicate check), which transitively pulls in $lib/entu-config
// -> `$env/dynamic/public`; that virtual module doesn't resolve under happy-dom
// (same rationale as run-link-callback.spec.ts). Neither test here sets
// `linkedSnapshot` on the stashed state, so the real listLinkedIdentities is
// never actually invoked — this mock only keeps the import graph resolvable.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const { exchangeSessionMock, exchangeInviteMock, setUserMock, setTokenMock } = vi.hoisted(() => ({
	exchangeSessionMock: vi.fn(),
	exchangeInviteMock: vi.fn(),
	setUserMock: vi.fn(),
	setTokenMock: vi.fn()
}));
vi.mock('$lib/auth/exchange', () => ({ exchangeSession: exchangeSessionMock }));
vi.mock('$lib/invite/redeem', () => ({ exchangeSessionWithInvite: exchangeInviteMock }));
vi.mock('$lib/auth/storage', () => ({
	setUser: setUserMock,
	setToken: setTokenMock,
	setLastProvider: vi.fn(),
	getToken: vi.fn(),
	getUser: vi.fn(),
	getLastProvider: vi.fn(),
	clearAll: vi.fn()
}));
vi.mock('$lib/auth/session', () => ({ hydrateAuth: vi.fn() }));
vi.mock('$lib/collectives/store', () => ({
	hydrateCollectives: vi.fn().mockResolvedValue({ status: 'ready' })
}));

import { runCallbackExchange } from './run-callback-exchange';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

const TOKEN = jwt({ db: 'polyphony', entityId: 'person-me', iat: 1, exp: 4_102_444_800 });

function stashLinkState(): void {
	const state: OAuthState = {
		nonce: 'n1',
		return_to: '/profile?linked=1',
		intent: 'link',
		provider: 'e-mail',
		invite: { db: 'polyphony', token: TOKEN },
		linkPersonId: 'person-me'
	};
	localStorage.setItem(OAUTH_STATE_KEY, encodeState(state));
}

beforeEach(() => {
	localStorage.clear();
	exchangeSessionMock.mockReset();
	exchangeInviteMock.mockReset();
	setUserMock.mockReset();
	setTokenMock.mockReset();
	// If the dispatcher wrongly falls through to the normal login path, this keeps
	// the failure signal clean (an ok:false result, not a crash).
	exchangeSessionMock.mockResolvedValue({ ok: false, error: 'wrong_path_taken' });
});

describe('runCallbackExchange — intent "link" dispatch (#193)', () => {
	it('a link-intent blob takes the link branch: account-scoped redeem with the initiating person, db-less exchange NEVER called', async () => {
		stashLinkState();
		exchangeInviteMock.mockResolvedValue({
			status: 'redeemed',
			token: 'new-narrowed-jwt',
			user: { email: 'me@example.com', name: 'Me' },
			personId: 'person-me'
		});

		const outcome = await runCallbackExchange('key1');

		expect(exchangeSessionMock).not.toHaveBeenCalled();
		expect(exchangeInviteMock).toHaveBeenCalledTimes(1);
		expect(exchangeInviteMock.mock.calls[0][0]).toEqual({
			sessionToken: 'key1',
			db: 'polyphony',
			inviteToken: TOKEN,
			expectedEntityId: 'person-me'
		});
		expect(outcome).toEqual({ ok: true, redirectTo: '/profile?linked=1' });
	});

	it('a link-intent conflict never persists the foreign identity, end to end through the dispatcher', async () => {
		stashLinkState();
		exchangeInviteMock.mockResolvedValue({
			status: 'conflict',
			token: 'real-but-foreign-jwt',
			user: { email: 'someone@else.example' },
			existingPersonId: 'person-OTHER'
		});

		const outcome = await runCallbackExchange('key1');

		expect(setUserMock).not.toHaveBeenCalled();
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/profile?link_error=conflict',
			error: 'link_conflict'
		});
	});
});

// (*MVOX:Tallis* — #193 RED: callback dispatcher takes the link branch)
