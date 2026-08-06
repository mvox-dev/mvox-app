// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthState } from '$lib/auth/state';

// Mock the module boundaries: the account-scoped exchange, the storage setters,
// and the two hydrate steps. parseInviteToken stays REAL (pure decode) — the
// tokens below are genuine base64url JWTs so the real parse works in GREEN.
const {
	exchangeInviteMock,
	setUserMock,
	setTokenMock,
	setLastProviderMock,
	hydrateAuthMock,
	hydrateCollectivesMock
} = vi.hoisted(() => ({
	exchangeInviteMock: vi.fn(),
	setUserMock: vi.fn(),
	setTokenMock: vi.fn(),
	setLastProviderMock: vi.fn(),
	hydrateAuthMock: vi.fn(),
	hydrateCollectivesMock: vi.fn()
}));
vi.mock('$lib/invite/redeem', () => ({ exchangeSessionWithInvite: exchangeInviteMock }));
vi.mock('$lib/auth/storage', () => ({
	setUser: setUserMock,
	setToken: setTokenMock,
	setLastProvider: setLastProviderMock,
	getToken: vi.fn(),
	getUser: vi.fn(),
	getLastProvider: vi.fn(),
	clearAll: vi.fn()
}));
vi.mock('$lib/auth/session', () => ({ hydrateAuth: hydrateAuthMock }));
vi.mock('$lib/collectives/store', () => ({ hydrateCollectives: hydrateCollectivesMock }));

import { runInviteCallbackExchange } from './run-invite-callback';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

const TOKEN = jwt({ db: 'polyphony', entityId: 'p1', iat: 1, exp: 4_102_444_800 }); // exp year 2100
const EXPIRED_TOKEN = jwt({ db: 'polyphony', entityId: 'p1', iat: 1, exp: 1_000 }); // exp 1970

function inviteState(overrides: Partial<OAuthState> = {}): OAuthState {
	return {
		nonce: 'n1',
		return_to: `/invite/${TOKEN}`,
		intent: 'invite',
		provider: 'google',
		invite: { db: 'polyphony', token: TOKEN },
		...overrides
	};
}

const REDEEMED = {
	status: 'redeemed' as const,
	token: 'new-12h-jwt',
	user: { email: 'mari@example.com', name: 'Mari' },
	personId: 'p1'
};

beforeEach(() => {
	exchangeInviteMock.mockReset();
	setUserMock.mockReset();
	setTokenMock.mockReset();
	setLastProviderMock.mockReset();
	hydrateAuthMock.mockReset();
	hydrateCollectivesMock.mockReset();
	hydrateCollectivesMock.mockResolvedValue({ status: 'ready' });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('runInviteCallbackExchange — redeemed', () => {
	it('calls the account-scoped exchange with db, token and the expected entity id from the token', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		await runInviteCallbackExchange('sess-key', inviteState());
		expect(exchangeInviteMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionToken: 'sess-key',
				db: 'polyphony',
				inviteToken: TOKEN,
				expectedEntityId: 'p1'
			})
		);
	});

	it('persists in the version-gate order (setUser BEFORE setToken), remembers the provider, hydrates auth AND collectives, and routes home', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		const outcome = await runInviteCallbackExchange('sess-key', inviteState());

		expect(outcome).toEqual({ ok: true, redirectTo: '/' });
		expect(setUserMock).toHaveBeenCalledWith(expect.objectContaining({ _id: 'p1' }));
		expect(setTokenMock).toHaveBeenCalledWith('new-12h-jwt');
		expect(setUserMock.mock.invocationCallOrder[0]).toBeLessThan(
			setTokenMock.mock.invocationCallOrder[0]
		);
		expect(setLastProviderMock).toHaveBeenCalledWith('google');
		expect(hydrateAuthMock).toHaveBeenCalled();
		expect(hydrateCollectivesMock).toHaveBeenCalled();
	});
});

describe('runInviteCallbackExchange — conflict / unexpected (session is real → persisted)', () => {
	it('conflict: persists the existing-account session and routes to the landing with outcome=conflict', async () => {
		exchangeInviteMock.mockResolvedValue({
			status: 'conflict',
			token: 'new-12h-jwt',
			user: { email: 'mari@example.com' },
			existingPersonId: 'existing-9'
		});
		const outcome = await runInviteCallbackExchange('sess-key', inviteState());
		expect(setTokenMock).toHaveBeenCalledWith('new-12h-jwt');
		expect(outcome.ok).toBe(true);
		expect(outcome.redirectTo).toBe(`/invite/${TOKEN}?outcome=conflict`);
	});

	it('unexpected (AC1 tripwire): persists the session (retry is impossible — the key is single-use) and routes with outcome=unexpected', async () => {
		exchangeInviteMock.mockResolvedValue({
			status: 'unexpected',
			token: 'new-12h-jwt',
			user: {},
			detail: 'entity mismatch'
		});
		const outcome = await runInviteCallbackExchange('sess-key', inviteState());
		expect(setTokenMock).toHaveBeenCalledWith('new-12h-jwt');
		expect(outcome.ok).toBe(true);
		expect(outcome.redirectTo).toBe(`/invite/${TOKEN}?outcome=unexpected`);
	});
});

describe('runInviteCallbackExchange — dead / failed (nothing persisted)', () => {
	it('dead: persists NOTHING (the JWT carries no accounts claim — persisting would be half-authenticated) and routes with outcome=dead', async () => {
		exchangeInviteMock.mockResolvedValue({ status: 'dead' });
		const outcome = await runInviteCallbackExchange('sess-key', inviteState());
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(setUserMock).not.toHaveBeenCalled();
		expect(outcome.ok).toBe(false);
		expect(outcome.redirectTo).toBe(`/invite/${TOKEN}?outcome=dead`);
	});

	it('failed: persists nothing and routes with outcome=error (retry is real — a fresh CTA click mints a fresh session key)', async () => {
		exchangeInviteMock.mockResolvedValue({ status: 'failed' });
		const outcome = await runInviteCallbackExchange('sess-key', inviteState());
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(outcome.ok).toBe(false);
		expect(outcome.redirectTo).toBe(`/invite/${TOKEN}?outcome=error`);
	});
});

describe('runInviteCallbackExchange — inconsistent state blobs fail loudly, never degrade to a normal login', () => {
	it('an invite-intent blob WITHOUT the invite field is an inconsistency: invite_state_invalid, no exchange call', async () => {
		const stateWithoutInvite: OAuthState = {
			nonce: 'n1',
			return_to: `/invite/${TOKEN}`,
			intent: 'invite',
			provider: 'google'
		};
		const outcome = await runInviteCallbackExchange('sess-key', stateWithoutInvite);
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/auth/login?error=invite_state_invalid',
			error: 'invite_state_invalid'
		});
		expect(exchangeInviteMock).not.toHaveBeenCalled();
	});

	it('an unparseable invite token in the blob: invite_state_invalid, no exchange call', async () => {
		const outcome = await runInviteCallbackExchange(
			'sess-key',
			inviteState({ invite: { db: 'polyphony', token: 'garbage-not-a-jwt' } })
		);
		expect(outcome).toMatchObject({ ok: false, error: 'invite_state_invalid' });
		expect(exchangeInviteMock).not.toHaveBeenCalled();
	});

	it('a CLIENT-clock-expired token does NOT short-circuit — the server is the authority, so the exchange still runs', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		const outcome = await runInviteCallbackExchange(
			'sess-key',
			inviteState({
				return_to: `/invite/${EXPIRED_TOKEN}`,
				invite: { db: 'polyphony', token: EXPIRED_TOKEN }
			})
		);
		expect(exchangeInviteMock).toHaveBeenCalledWith(
			expect.objectContaining({ inviteToken: EXPIRED_TOKEN })
		);
		expect(outcome).toEqual({ ok: true, redirectTo: '/' });
	});
});

describe('runInviteCallbackExchange — persistence failure', () => {
	it('a localStorage write failure after a successful redemption fails closed to the landing with outcome=error', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		setTokenMock.mockImplementation(() => {
			throw new Error('quota exceeded');
		});
		const outcome = await runInviteCallbackExchange('sess-key', inviteState());
		expect(outcome.ok).toBe(false);
		expect(outcome.redirectTo).toBe(`/invite/${TOKEN}?outcome=error`);
	});
});
