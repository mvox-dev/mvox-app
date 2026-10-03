// @vitest-environment happy-dom
// The link branch of the OAuth callback redeems the self-minted invite and must never persist an
// identity other than the initiating person's: every non-happy outcome is a named error.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthState } from '$lib/auth/state';

// The duplicate check reads through the real entuFetch, so the $env chain is severed here.
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

const {
	setUserMock,
	setTokenMock,
	getTokenMock,
	setLastProviderMock
} = vi.hoisted(() => ({
	setUserMock: vi.fn(),
	setTokenMock: vi.fn(),
	getTokenMock: vi.fn(),
	setLastProviderMock: vi.fn(),
}));
vi.mock('$lib/invite/redeem', async () =>
	(await import('$lib/testing/mocks/session')).redeemModule()
);
vi.mock('$lib/auth/storage', () => ({
	setUser: setUserMock,
	setToken: setTokenMock,
	setLastProvider: setLastProviderMock,
	getToken: getTokenMock,
	getUser: vi.fn(),
	getLastProvider: vi.fn(),
	clearAll: vi.fn()
}));
vi.mock('$lib/auth/session', async () =>
	(await import('$lib/testing/mocks/session')).sessionModule()
);
vi.mock('$lib/collectives/store', async () =>
	(await import('$lib/testing/mocks/session')).collectivesStoreModule()
);

import { runLinkCallbackExchange } from './run-link-callback';
import {
	exchangeInviteMock,
	hydrateAuthMock,
	hydrateCollectivesMock
} from '$lib/testing/mocks/session';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

const TOKEN = jwt({ db: 'sampledb', entityId: 'person-me', iat: 1, exp: 4_102_444_800 });

function linkState(overrides: Partial<OAuthState> = {}): OAuthState {
	return {
		nonce: 'n1',
		return_to: '/profile?linked=1',
		intent: 'link',
		provider: 'e-mail',
		invite: { db: 'sampledb', token: TOKEN },
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
			db: 'sampledb',
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

	// The redemption JWT names only the invite's collective; swapping it in would drop every
	// other collective from the switcher until the next login.
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

	// A conflict owned by the initiating person means a re-link of a sign-in they already have.
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

// ── same-identity re-link: `redeemed` is not always a new link ──────────────────
// The callback compares the re-read set with the snapshot taken at mint time and deletes a
// new entry that repeats a known identity, with the redeemed token; sign-in never fails.

describe('runLinkCallbackExchange — same-identity re-link (#219)', () => {
	type LinkStateWithSnapshot = OAuthState & {
		linkedSnapshot?: Array<{ _id: string; uid: string; provider: string }>;
	};

	const SNAPSHOT = [{ _id: 'eu-1', uid: 'uid-g-1', provider: 'google' }];

	function snapshotState(overrides: Partial<LinkStateWithSnapshot> = {}): OAuthState {
		return {
			...linkState({ provider: 'google' }),
			linkedSnapshot: SNAPSHOT,
			...overrides
		} as OAuthState;
	}

	const PRE_EXISTING_ENTRY = {
		_id: 'eu-1',
		uid: 'uid-g-1',
		provider: 'google',
		email: 'me@example.com'
	};

	// The re-read asks for _viewer as the tell that the private bucket came back; the caller
	// reads their own person and holds self-_editor, so the fixture carries it.
	const READ_URL = 'https://api.entu-test.invalid/sampledb/entity/person-me?props=entu_user,_viewer';
	const SELF_EDITOR_GRANT = [
		{ _id: 'gr-self', reference: 'person-me', property_type: '_editor' }
	];

	// The real entuFetch's traffic: a canned re-read, a DELETE status; anything else throws.
	function stubFetch(opts: {
		entries: Array<{ _id: string; uid?: string; provider?: string; email?: string }>;
		deleteStatus?: number;
	}) {
		const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'DELETE') {
				return new Response('{}', { status: opts.deleteStatus ?? 200 });
			}
			if (String(url) === READ_URL) {
				return new Response(
					JSON.stringify({ entity: { _viewer: SELF_EDITOR_GRANT, entu_user: opts.entries } }),
					{ status: 200 }
				);
			}
			throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${String(url)}`);
		});
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	function deleteCalls(fetchMock: ReturnType<typeof stubFetch>) {
		return fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('a redeemed re-link whose uid+provider is in the snapshot DELETEs the duplicate and reports the neutral no-op', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		const fetchMock = stubFetch({
			entries: [
				PRE_EXISTING_ENTRY,
				// The just-bound entry: NEW _id, same uid+provider — the duplicate.
				{ _id: 'eu-9', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' }
			]
		});

		const outcome = await runLinkCallbackExchange('key1', snapshotState());

		// The neutral no-op outcome — ok:true, the sign-in never fails on this path.
		expect(outcome).toEqual({ ok: true, redirectTo: '/profile?link_noop=same_identity' });

		// The re-read is scoped to state.invite.db + state.linkPersonId and carries
		// result.token — the just-redeemed JWT for THAT db, never the broad one.
		const readCall = fetchMock.mock.calls.find(
			([, init]) => (init as RequestInit | undefined)?.method !== 'DELETE'
		);
		expect(readCall).toEqual([
			READ_URL,
			{ headers: { Authorization: 'Bearer new-narrowed-jwt', Accept: 'application/json' } }
		]);

		// The duplicate removal targets the property VALUE id on state.invite.db
		// with result.token — full request shape.
		expect(deleteCalls(fetchMock)).toEqual([
			[
				'https://api.entu-test.invalid/sampledb/property/eu-9',
				{
					method: 'DELETE',
					headers: { Authorization: 'Bearer new-narrowed-jwt', Accept: 'application/json' }
				}
			]
		]);
	});

	it('the Path C persistence sequence still runs on the no-op path exactly as on success', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		getTokenMock.mockReturnValue('existing-broad-jwt');
		stubFetch({
			entries: [
				PRE_EXISTING_ENTRY,
				{ _id: 'eu-9', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' }
			]
		});

		const outcome = await runLinkCallbackExchange('key1', snapshotState());

		expect(outcome.ok).toBe(true);
		expect(setUserMock).toHaveBeenCalledTimes(1);
		expect(setUserMock.mock.calls[0][0]).toEqual({
			_id: 'person-me',
			email: 'me@example.com',
			name: 'Me'
		});
		expect(setLastProviderMock).toHaveBeenCalledWith('google');
		// The broader session token is still kept.
		expect(setTokenMock).not.toHaveBeenCalled();
		expect(hydrateAuthMock).toHaveBeenCalledTimes(1);
		expect(hydrateCollectivesMock).toHaveBeenCalledTimes(1);
	});

	it('a rights-refused DELETE (any non-2xx) logs a console.warn with the status and still reports the no-op — never fails the sign-in', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			exchangeInviteMock.mockResolvedValue(REDEEMED);
			const fetchMock = stubFetch({
				entries: [
					PRE_EXISTING_ENTRY,
					{ _id: 'eu-9', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' }
				],
				deleteStatus: 403
			});

			const outcome = await runLinkCallbackExchange('key1', snapshotState());

			expect(outcome).toEqual({ ok: true, redirectTo: '/profile?link_noop=same_identity' });
			expect(deleteCalls(fetchMock)).toHaveLength(1);
			expect(warnSpy).toHaveBeenCalled();
			const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join(' ');
			expect(warned).toContain('403');
		} finally {
			warnSpy.mockRestore();
		}
	});

	it('a redeemed link whose new entry carries a NOVEL uid+provider takes the existing success path — no DELETE', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		const fetchMock = stubFetch({
			entries: [
				PRE_EXISTING_ENTRY,
				// New _id AND new identity — a legitimate second sign-in.
				{ _id: 'eu-9', uid: 'uid-a-1', provider: 'apple', email: 'me@icloud.example' }
			]
		});

		const outcome = await runLinkCallbackExchange('key1', snapshotState());

		expect(outcome).toEqual({ ok: true, redirectTo: '/profile?linked=1' });
		expect(deleteCalls(fetchMock)).toHaveLength(0);
	});

	it('an intent-link blob WITHOUT linkedSnapshot (older blob) takes the success path — no crash, no delete', async () => {
		exchangeInviteMock.mockResolvedValue(REDEEMED);
		// Even a wire-visible duplicate must not be touched: with no snapshot there
		// is no way to tell which entry is new, and inventing one risks deleting a
		// real identity.
		const fetchMock = stubFetch({
			entries: [
				PRE_EXISTING_ENTRY,
				{ _id: 'eu-9', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' }
			]
		});

		const outcome = await runLinkCallbackExchange('key1', linkState());

		expect(outcome).toEqual({ ok: true, redirectTo: '/profile?linked=1' });
		expect(deleteCalls(fetchMock)).toHaveLength(0);
	});
});

// (*MVOX:Tallis*)
