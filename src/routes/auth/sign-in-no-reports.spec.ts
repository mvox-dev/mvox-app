// @vitest-environment happy-dom
// A failed sign-in sends no problem report (Mihkel 2026-11-01, #1049), redeeming an invite
// included; a collective is selected throughout, so a stray report would be kept and seen.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeState, OAUTH_STATE_KEY, type OAuthState } from '$lib/auth/state';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';

const { SELECTED, exchangeSessionMock, setUserMock } = vi.hoisted(() => ({
	SELECTED: { db: 'sampledb', personId: 'person-me' },
	exchangeSessionMock: vi.fn(),
	setUserMock: vi.fn()
}));

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/auth/exchange', () => ({ exchangeSession: exchangeSessionMock }));
vi.mock('$lib/invite/redeem', async () =>
	(await import('$lib/testing/mocks/session')).redeemModule()
);
vi.mock('$lib/auth/storage', () => ({
	setUser: setUserMock,
	setToken: vi.fn(),
	setLastProvider: vi.fn(),
	getToken: vi.fn(() => null),
	getUser: vi.fn(),
	getLastProvider: vi.fn(() => null),
	canPersistLocally: vi.fn(() => true),
	clearAll: vi.fn()
}));
vi.mock('$lib/auth/session', async () => {
	const { readable } = await import('svelte/store');
	return { hydrateAuth: vi.fn(), authStore: readable({ status: 'anonymous' }) };
});
vi.mock('$lib/collectives/store', async () => {
	const { readable } = await import('svelte/store');
	return {
		hydrateCollectives: vi.fn(async () => ({ status: 'ready' })),
		selectedCollectiveIdentityStore: readable(SELECTED)
	};
});

import { runCallbackExchange } from './callback/run-callback-exchange';
import CallbackPage from './callback/+page.svelte';
import LoginPage from './login/+page.svelte';
import InvitePage from '../invite/[token]/+page.svelte';
import { exchangeInviteMock } from '$lib/testing/mocks/session';
import { gotoMock } from '$lib/testing/routeMocks';
import { jwt } from '$lib/testing/pages/admin';

useKeptProblems();

const TOKEN = jwt({ db: 'sampledb', entityId: 'person-me', iat: 1, exp: 4_102_444_800 });
const USER = { email: 'me@example.com', name: 'Me' };
const settle = () => new Promise((r) => setTimeout(r, 50));

function stash(state: Partial<OAuthState>): void {
	const base: OAuthState = { nonce: 'n1', return_to: '/', intent: 'login', provider: 'e-mail' };
	localStorage.setItem(OAUTH_STATE_KEY, encodeState({ ...base, ...state }));
}

const invite = { intent: 'invite' as const, invite: { db: 'sampledb', token: TOKEN } };

beforeEach(() => {
	localStorage.clear();
	exchangeSessionMock.mockReset();
	exchangeInviteMock.mockReset();
	setUserMock.mockReset();
	gotoMock.mockReset();
});

afterEach(() => cleanup());

describe('a failed sign-in callback keeps no report', () => {
	it.each<[string, () => void, string]>([
		['no state blob', () => {}, '/auth/login?error=csrf_mismatch'],
		[
			'an unreadable state blob',
			() => localStorage.setItem(OAUTH_STATE_KEY, 'not-a-blob'),
			'/auth/login?error=csrf_mismatch'
		],
		[
			'a refused exchange',
			() => {
				stash({});
				exchangeSessionMock.mockResolvedValue({ ok: false, error: 'entu_auth_failed' });
			},
			'/auth/login?error=entu_auth_failed'
		],
		[
			'an empty session key',
			() => {
				stash({});
				exchangeSessionMock.mockResolvedValue({ ok: false, error: 'missing_session_token' });
			},
			'/auth/login?error=missing_session_token'
		],
		[
			'a storage write that throws',
			() => {
				stash({});
				exchangeSessionMock.mockResolvedValue({ ok: true, token: 't', user: USER });
				setUserMock.mockImplementation(() => {
					throw new Error('storage is full');
				});
			},
			'/auth/login?error=persist_failed'
		],
		[
			'an invite blob with no invite',
			() => stash({ intent: 'invite' }),
			'/auth/login?error=invite_state_invalid'
		],
		[
			'a dead invite',
			() => {
				stash(invite);
				exchangeInviteMock.mockResolvedValue({ status: 'dead' });
			},
			`/invite/${TOKEN}?outcome=dead`
		],
		[
			'a failed invite exchange',
			() => {
				stash(invite);
				exchangeInviteMock.mockResolvedValue({ status: 'failed' });
			},
			`/invite/${TOKEN}?outcome=error`
		],
		[
			'an invite conflict',
			() => {
				stash(invite);
				exchangeInviteMock.mockResolvedValue({
					status: 'conflict',
					token: 't',
					user: USER,
					existingPersonId: 'person-else'
				});
			},
			`/invite/${TOKEN}?outcome=conflict`
		],
		[
			'an unexpected invite result',
			() => {
				stash(invite);
				exchangeInviteMock.mockResolvedValue({
					status: 'unexpected',
					token: 't',
					user: USER,
					detail: 'bound to entity p9'
				});
			},
			`/invite/${TOKEN}?outcome=unexpected`
		],
		[
			'an invite storage write that throws',
			() => {
				stash(invite);
				exchangeInviteMock.mockResolvedValue({
					status: 'redeemed',
					token: 't',
					user: USER,
					personId: 'person-me'
				});
				setUserMock.mockImplementation(() => {
					throw new Error('storage is full');
				});
			},
			`/invite/${TOKEN}?outcome=error`
		]
	])('%s', async (_name, arrange, redirectTo) => {
		arrange();

		expect((await runCallbackExchange('key1')).redirectTo).toBe(redirectTo);
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('the callback page shows its failure and keeps no report', async () => {
		const { container } = render(CallbackPage);

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/auth/login?error=csrf_mismatch'));
		expect(container.querySelector('a[href="/auth/login"]')).not.toBeNull();
		await settle();
		expect(await keptProblems()).toEqual([]);
	});
});

describe('the sign-in error banners keep no report', () => {
	it.each(['csrf_mismatch', 'missing_session_token', 'entu_auth_failed', 'oauth_init_failed'])(
		'/auth/login?error=%s',
		async (code) => {
			pageStub.url = new URL(`http://localhost/auth/login?error=${code}`);
			const { getByRole } = render(LoginPage);

			expect(getByRole('alert').textContent).not.toBe('');
			await settle();
			expect(await keptProblems()).toEqual([]);
		}
	);

	it.each(['dead', 'conflict', 'unexpected', 'error'])('/invite/<token>?outcome=%s', async (code) => {
		pageStub.params = { token: TOKEN };
		pageStub.url = new URL(`http://localhost/invite/${TOKEN}?outcome=${code}`);
		const { getByRole } = render(InvitePage);

		expect(getByRole('alert').textContent).not.toBe('');
		await settle();
		expect(await keptProblems()).toEqual([]);
	});
});

// (*MVOX:Josquin*)
