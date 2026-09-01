// @vitest-environment happy-dom
//
// #193 RED — link-intent branch of the OAuth callback: the user came back from
// the SECOND provider carrying a real session key + the self-minted invite in
// the (already-consumed) state blob. Redemption reuses the sole account-scoped
// exchange (exchangeSessionWithInvite) — entu-api's replaceInviteWithCredentials
// then writes the second identity as a separate array entry, leaving the first
// identity untouched (APPEND, platform-verified live in the SPIKE).
//
// The decisive difference from the admin-invite branch (run-invite-callback.ts):
// there, a `conflict` persists the OTHER person as the current user (acceptable
// for a stranger arriving). For a self-link initiated from an authenticated
// profile page that would mean "clicked link, got silently logged in AS SOMEONE
// ELSE" — the link path must REFUSE to persist any identity other than the
// initiating person's, and surface every non-happy outcome as a loud, named
// error instead.
//
// Contract under test (GREEN implements exactly this, in a NEW module —
// src/routes/auth/callback/run-link-callback.ts):
//   runLinkCallbackExchange(key: string, state: OAuthState): Promise<CallbackOutcome>

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthState } from '$lib/auth/state';

const {
	exchangeInviteMock,
	setUserMock,
	setTokenMock,
	getTokenMock,
	setLastProviderMock,
	hydrateAuthMock,
	hydrateCollectivesMock
} = vi.hoisted(() => ({
	exchangeInviteMock: vi.fn(),
	setUserMock: vi.fn(),
	setTokenMock: vi.fn(),
	getTokenMock: vi.fn(),
	setLastProviderMock: vi.fn(),
	hydrateAuthMock: vi.fn(),
	hydrateCollectivesMock: vi.fn()
}));
vi.mock('$lib/invite/redeem', () => ({ exchangeSessionWithInvite: exchangeInviteMock }));
vi.mock('$lib/auth/storage', () => ({
	setUser: setUserMock,
	setToken: setTokenMock,
	setLastProvider: setLastProviderMock,
	getToken: getTokenMock,
	getUser: vi.fn(),
	getLastProvider: vi.fn(),
	clearAll: vi.fn()
}));
vi.mock('$lib/auth/session', () => ({ hydrateAuth: hydrateAuthMock }));
vi.mock('$lib/collectives/store', () => ({ hydrateCollectives: hydrateCollectivesMock }));

import { runLinkCallbackExchange } from './run-link-callback';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

const TOKEN = jwt({ db: 'polyphony', entityId: 'person-me', iat: 1, exp: 4_102_444_800 });

function linkState(overrides: Partial<OAuthState> = {}): OAuthState {
	return {
		nonce: 'n1',
		return_to: '/profile?linked=1',
		intent: 'link',
		provider: 'e-mail',
		invite: { db: 'polyphony', token: TOKEN },
		linkPersonId: 'person-me',
		...overrides
	};
}

const REDEEMED = {
	status: 'redeemed' as const,
	token: 'new-narrowed-jwt',
	user: { email: 'me@example.com', name: 'Me' },
	personId: 'person-me'
};

beforeEach(() => {
	exchangeInviteMock.mockReset();
	setUserMock.mockReset();
	setTokenMock.mockReset();
	setLastProviderMock.mockReset();
	hydrateAuthMock.mockReset();
	hydrateCollectivesMock.mockReset();
	hydrateCollectivesMock.mockResolvedValue({ status: 'ready' });
	// The link flow starts from an AUTHENTICATED profile page — a session token in
	// storage is the normal precondition, not the exception.
	getTokenMock.mockReset().mockReturnValue('existing-broad-jwt');
});

describe('runLinkCallbackExchange — redeemed (the append happy path)', () => {
	it('redeems with the INITIATING person as expectedEntityId — the free tripwire against binding anyone else', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);

		await runLinkCallbackExchange('key1', linkState());

		expect(exchangeInviteMock).toHaveBeenCalledTimes(1);
		expect(exchangeInviteMock.mock.calls[0][0]).toEqual({
			sessionToken: 'key1',
			db: 'polyphony',
			inviteToken: TOKEN,
			expectedEntityId: 'person-me'
		});
	});

	it('persists the session for the SAME person and honours return_to (lands back on the profile)', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(outcome).toEqual({ ok: true, redirectTo: '/profile?linked=1' });
		expect(setUserMock).toHaveBeenCalledTimes(1);
		expect(setUserMock.mock.calls[0][0]).toEqual({
			_id: 'person-me',
			email: 'me@example.com',
			name: 'Me'
		});
		expect(setLastProviderMock).toHaveBeenCalledWith('e-mail');
		expect(hydrateAuthMock).toHaveBeenCalledTimes(1);
		expect(hydrateCollectivesMock).toHaveBeenCalledTimes(1);
	});

	// Review F2: the redemption JWT is account-scoped — entu-api filters the db scan
	// to the invite's db (index.get.js:124-129, :143), so its `accounts` claim names
	// ONLY the collective the link was started from. hydrateAuth reads personIdByDb
	// straight off that claim and hydrateCollectives wholesale-replaces the list, so
	// swapping it in drops every OTHER collective from the switcher until next login.
	it('does NOT replace the existing, broader session token (that would silently drop the user’s other collectives)', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		getTokenMock.mockReturnValue('existing-broad-jwt');

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(outcome.ok).toBe(true);
		expect(setTokenMock).not.toHaveBeenCalled();
		// The link still succeeded — the person is re-published and the collectives
		// are re-read, just off the token that was already there.
		expect(setUserMock).toHaveBeenCalledTimes(1);
		expect(hydrateCollectivesMock).toHaveBeenCalledTimes(1);
	});

	it('falls back to the narrowed token only when storage holds NO session token', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		getTokenMock.mockReturnValue(null);

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(outcome.ok).toBe(true);
		expect(setTokenMock).toHaveBeenCalledWith('new-narrowed-jwt');
	});

	it('a hostile return_to falls back to a safe target', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);

		const outcome = await runLinkCallbackExchange('key1', linkState({ return_to: '//evil.example' }));

		expect(outcome.ok).toBe(true);
		expect(outcome.redirectTo).toBe('/');
	});
});

describe('runLinkCallbackExchange — conflict NEVER swaps the session identity', () => {
	it('refuses to persist the OTHER person and surfaces a named link_conflict error', async () => {
		exchangeInviteMock.mockResolvedValue({
			status: 'conflict',
			token: 'real-but-foreign-jwt',
			user: { email: 'someone@else.example', name: 'Someone Else' },
			existingPersonId: 'person-OTHER'
		});

		const outcome = await runLinkCallbackExchange('key1', linkState());

		// The admin-invite branch persists person-OTHER here. The link branch must
		// not persist ANYTHING — the user stays who they were.
		expect(setUserMock).not.toHaveBeenCalled();
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/profile?link_error=conflict',
			error: 'link_conflict'
		});
	});

	// Review F3: a conflict whose existing owner IS the initiating person is not
	// "in use by another member here" — it means the user re-linked a sign-in they
	// already have. Distinct outcome so the message stays truthful.
	it('a SAME-person conflict is classified as already_linked, not as someone else’s account', async () => {
		exchangeInviteMock.mockResolvedValue({
			status: 'conflict',
			token: 'real-jwt',
			user: { email: 'me@example.com', name: 'Me' },
			existingPersonId: 'person-me'
		});

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(setUserMock).not.toHaveBeenCalled();
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/profile?link_error=already_linked',
			error: 'link_already_linked'
		});
	});

	it('an unexpected exchange result likewise persists nothing and stays loud', async () => {
		exchangeInviteMock.mockResolvedValue({
			status: 'unexpected',
			token: 'real-jwt',
			user: { email: 'me@example.com' },
			detail: 'account entry is bound to entity person-STRANGER, expected person-me, with no conflict flag'
		});

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(setUserMock).not.toHaveBeenCalled();
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/profile?link_error=unexpected',
			error: 'link_unexpected'
		});
	});
});

describe('runLinkCallbackExchange — dead / failed are loud, named, and persist nothing', () => {
	it('dead → link_dead', async () => {
		exchangeInviteMock.mockResolvedValue({ status: 'dead' });

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(setUserMock).not.toHaveBeenCalled();
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/profile?link_error=dead',
			error: 'link_dead'
		});
	});

	it('failed → link_failed (retryable — a fresh mint + CTA click is the retry)', async () => {
		exchangeInviteMock.mockResolvedValue({ status: 'failed' });

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(setUserMock).not.toHaveBeenCalled();
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/profile?link_error=failed',
			error: 'link_failed'
		});
	});
});

describe('runLinkCallbackExchange — inconsistent state fails loudly, never degrades to login', () => {
	it('a link blob without the invite carrier never calls the exchange', async () => {
		const outcome = await runLinkCallbackExchange('key1', linkState({ invite: undefined }));

		expect(exchangeInviteMock).not.toHaveBeenCalled();
		expect(outcome.ok).toBe(false);
		expect((outcome as { error: string }).error).toBe('link_state_invalid');
	});

	it('a link blob without linkPersonId never calls the exchange — there is no tripwire without it', async () => {
		const outcome = await runLinkCallbackExchange('key1', linkState({ linkPersonId: undefined }));

		expect(exchangeInviteMock).not.toHaveBeenCalled();
		expect(outcome.ok).toBe(false);
		expect((outcome as { error: string }).error).toBe('link_state_invalid');
	});
});

// (*MVOX:Tallis* — #193 RED: link-callback redemption branch)
