// @vitest-environment happy-dom
// An account-linking error reports once, under the person who started the link (#1049): they
// are signed in. The /profile banner reports nothing itself, so a reload or back sends no second.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeState, OAUTH_STATE_KEY, type OAuthState } from '$lib/auth/state';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';

const { SELECTED, LINKER } = vi.hoisted(() => ({
	SELECTED: { db: 'otherdb', personId: 'person-other-db' },
	LINKER: { db: 'sampledb', personId: 'person-me' }
}));

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
const { setUserMock } = vi.hoisted(() => ({ setUserMock: vi.fn() }));
vi.mock('$lib/auth/exchange', () => ({ exchangeSession: vi.fn() }));
vi.mock('$lib/invite/redeem', async () =>
	(await import('$lib/testing/mocks/session')).redeemModule()
);
vi.mock('$lib/auth/storage', () => ({
	setUser: setUserMock,
	setToken: vi.fn(),
	setLastProvider: vi.fn(),
	getToken: vi.fn(() => 'existing-broad-jwt'),
	getUser: vi.fn(),
	getLastProvider: vi.fn(),
	clearAll: vi.fn()
}));
vi.mock('$lib/auth/session', async () => {
	const { readable } = await import('svelte/store');
	return { hydrateAuth: vi.fn(), authStore: readable({ status: 'anonymous' }) };
});
// The callback's fresh page load selects nothing until collective discovery has run.
const { selected } = vi.hoisted(() => ({ selected: { set: (_: unknown) => {} } }));
vi.mock('$lib/collectives/store', async () => {
	const { writable } = await import('svelte/store');
	const store = writable<typeof SELECTED | null>(null);
	selected.set = (v) => store.set(v as typeof SELECTED | null);
	return {
		hydrateCollectives: vi.fn(async () => {
			store.set(SELECTED);
			return { status: 'ready' };
		}),
		selectedCollectiveIdentityStore: store
	};
});

import { runCallbackExchange } from './run-callback-exchange';
import LinkedAccountsSection from '$lib/profile/LinkedAccountsSection.svelte';
import { exchangeInviteMock } from '$lib/testing/mocks/session';
import { jwt } from '$lib/testing/pages/admin';

useKeptProblems();

const TOKEN = jwt({ db: 'sampledb', entityId: 'person-me', iat: 1, exp: 4_102_444_800 });
const USER = { email: 'me@example.com', name: 'Me' };
const settle = () => new Promise((r) => setTimeout(r, 50));

function stashLinkState(overrides: Partial<OAuthState> = {}): void {
	const state: OAuthState = {
		nonce: 'n1',
		return_to: '/profile?linked=1',
		intent: 'link',
		provider: 'e-mail',
		invite: { db: 'sampledb', token: TOKEN },
		linkPersonId: 'person-me',
		...overrides
	};
	localStorage.setItem(OAUTH_STATE_KEY, encodeState(state));
}

beforeEach(() => {
	selected.set(null);
	localStorage.clear();
	exchangeInviteMock.mockReset();
	setUserMock.mockReset();
});

afterEach(() => cleanup());

describe('an account-linking error reports once, under the person who started it', () => {
	it.each([
		['dead', { status: 'dead' }, 'dead'],
		['failed', { status: 'failed' }, 'failed'],
		[
			'already_linked',
			{ status: 'conflict', token: 't', user: USER, existingPersonId: 'person-me' },
			'already_linked'
		],
		[
			'conflict',
			{ status: 'conflict', token: 't', user: USER, existingPersonId: 'person-else' },
			'conflict'
		],
		[
			'unexpected',
			{ status: 'unexpected', token: 't', user: USER, detail: 'bound to entity p9' },
			'unexpected: bound to entity p9'
		]
	])('?link_error=%s', async (code, result, detail) => {
		stashLinkState();
		exchangeInviteMock.mockResolvedValue(result);

		const outcome = await runCallbackExchange('key1');

		expect(outcome.redirectTo).toBe(`/profile?link_error=${code}`);
		const one = [{ area: 'link callback', action: 'linking another account', detail }];
		await waitFor(async () => expect(await keptProblems(LINKER)).toEqual(one));
		// A replayed callback URL finds no state blob: a sign-in failure, never a second report.
		expect((await runCallbackExchange('key1')).redirectTo).toBe('/auth/login?error=csrf_mismatch');
		await settle();
		expect(await keptProblems(LINKER)).toEqual(one);
		expect(await keptProblems(SELECTED)).toEqual([]);
	});

	it('?link_error=invalid, with no linking person named, reports under the selected collective', async () => {
		stashLinkState({ linkPersonId: undefined });

		const outcome = await runCallbackExchange('key1');

		expect(outcome.redirectTo).toBe('/profile?link_error=invalid');
		await waitFor(async () =>
			expect(await keptProblems(SELECTED)).toEqual([
				{ area: 'link callback', action: 'linking another account', detail: 'invalid' }
			])
		);
	});

	it('?link_error=persist_failed reports the storage error', async () => {
		stashLinkState();
		exchangeInviteMock.mockResolvedValue({
			status: 'redeemed',
			token: 't',
			user: USER,
			personId: 'person-me'
		});
		setUserMock.mockImplementation(() => {
			throw new Error('storage is full');
		});

		const outcome = await runCallbackExchange('key1');

		expect(outcome.redirectTo).toBe('/profile?link_error=persist_failed');
		await waitFor(async () =>
			expect(await keptProblems(LINKER)).toEqual([
				{
					area: 'link callback',
					action: 'saving the linked sign-in',
					detail: 'Error: storage is full'
				}
			])
		);
	});
});

describe('the /profile link banner sends no report of its own', () => {
	it.each(['conflict', 'dead', 'failed', 'already_linked', 'unexpected', 'invalid', 'persist_failed'])(
		'?link_error=%s shows its alert and keeps nothing',
		async (code) => {
			selected.set(SELECTED);
			pageStub.url = new URL(`http://localhost/profile?link_error=${code}`);
			const { getByTestId } = render(LinkedAccountsSection, {
				ready: true,
				isOffline: false,
				scopeName: 'Sampledb',
				generation: () => 0,
				activeContext: () => null,
				onSessionExpired: () => {},
				mintSelfLinkInvite: vi.fn(),
				mintErrorMessage: () => ''
			});

			expect(getByTestId('profile-link-error').getAttribute('role')).toBe('alert');
			await settle();
			expect(await keptProblems(SELECTED)).toEqual([]);
			expect(await keptProblems(LINKER)).toEqual([]);
		}
	);
});

// (*MVOX:Josquin*)
