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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthState } from '$lib/auth/state';

// #219 — the same-identity duplicate check re-reads the linked set through the
// REAL listLinkedIdentities/entuFetch, so the `$env/dynamic/public` chain
// (entu-config) must be severed the same way the page specs do.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

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

// ── #219: same-identity re-link — `redeemed` is NOT always a new link ───────────
//
// entu-api's same-person branch (`existingEntry.user._id === inviteData.entityId`)
// still runs replaceInviteWithCredentials on the fresh placeholder and reports a
// clean `redeemed` with NO conflict flag — on the wire a re-link of an identity
// the person already has is indistinguishable from a legitimate new link. (The
// conflict-status test above — "a SAME-person conflict is classified as
// already_linked" — covers a DIFFERENT, defensive input shape that entu-api never
// actually produces for this case. Do not conflate the two.)
//
// The only detection is client-side: at mint time the profile page snapshots the
// CURRENT identities' {_id, uid, provider} into the OAuth-state blob
// (state.linkedSnapshot); after `redeemed` the callback re-reads the linked set
// via the REAL listLinkedIdentities — scoped to state.invite.db +
// state.linkPersonId with result.token (the just-redeemed JWT for that db),
// NEVER the selected-collective store — and the entry whose _id is NOT in the
// snapshot is the just-bound one. If its uid+provider matches a snapshot pair,
// the round trip changed nothing: DELETE the duplicate property VALUE
// (property/{id}, not entity/{id}) with result.token and report the neutral
// no-op. The sign-in itself NEVER fails on this path — the Path C persistence
// sequence (getToken → setUser → setLastProvider → conditional setToken →
// hydrateAuth) runs exactly as before.

describe('runLinkCallbackExchange — same-identity re-link (#219)', () => {
	// The blob type gains `linkedSnapshot` in GREEN; the intersection keeps this
	// spec compiling at RED and stays valid once the field lands on OAuthState.
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

	/**
	 * Route the REAL entuFetch's traffic: the identity re-read gets a canned
	 * entity body; a DELETE gets the configured status. Anything else is a wiring
	 * bug and throws loudly.
	 */
	function stubFetch(opts: {
		entries: Array<{ _id: string; uid?: string; provider?: string; email?: string }>;
		deleteStatus?: number;
	}) {
		const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'DELETE') {
				return new Response('{}', { status: opts.deleteStatus ?? 200 });
			}
			if (String(url) === 'https://api.entu-test.invalid/polyphony/entity/person-me?props=entu_user') {
				return new Response(JSON.stringify({ entity: { entu_user: opts.entries } }), {
					status: 200
				});
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
			'https://api.entu-test.invalid/polyphony/entity/person-me?props=entu_user',
			{ headers: { Authorization: 'Bearer new-narrowed-jwt', Accept: 'application/json' } }
		]);

		// The duplicate removal targets the property VALUE id on state.invite.db
		// with result.token — full request shape.
		expect(deleteCalls(fetchMock)).toEqual([
			[
				'https://api.entu-test.invalid/polyphony/property/eu-9',
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
		// The broader session token is still kept (#193 review F2 — unchanged).
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

// (*MVOX:Tallis* — #193 RED: link-callback redemption branch)
// (*MVOX:Tallis* — #219 RED: same-identity re-link no-op guard)
