// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { encodeState, OAUTH_STATE_KEY } from '$lib/auth/state';
import { getToken } from '$lib/auth/storage';

// Mock the Entu exchange at its module boundary. This keeps the test a true unit
// (no network) AND severs the transitive `$env/dynamic/public` import that
// entu-config pulls in — that virtual module doesn't resolve under happy-dom.
// Mock the collective-discovery boundary too (severs the same $env chain via
// marker.ts → entu-config) and `$app/navigation` (the store imports `goto`), so
// the post-exchange `hydrateCollectives` runs against a fake discovery result.
const { exchangeMock, discoverMock, gotoMock, inviteCallbackMock, linkCallbackMock } = vi.hoisted(
	() => ({
		exchangeMock: vi.fn(),
		discoverMock: vi.fn(),
		gotoMock: vi.fn(),
		inviteCallbackMock: vi.fn(),
		linkCallbackMock: vi.fn()
	})
);
vi.mock('$lib/auth/exchange', () => ({ exchangeSession: exchangeMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// T4.5: the invite-intent branch — mocked at its module boundary so this spec
// stays a unit of the NON-invite path plus the delegation decision.
vi.mock('./run-invite-callback', () => ({ runInviteCallbackExchange: inviteCallbackMock }));
// #193: the link-intent branch — same rationale as the invite mock above (it
// transitively pulls in $lib/invite/redeem -> $lib/entu-config ->
// $env/dynamic/public, which doesn't resolve under happy-dom). The dedicated
// dispatch-wiring pin lives in run-callback-exchange.link-dispatch.spec.ts.
vi.mock('./run-link-callback', () => ({ runLinkCallbackExchange: linkCallbackMock }));

// Imported after the mock is registered (vi.mock is hoisted above imports anyway).
import { runCallbackExchange } from './run-callback-exchange';
import { collectiveState } from '$lib/collectives/store';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const VALID_JWT = jwt({ accounts: { polyphony: 'p1' }, exp: 9_999_999_999 });

function seedStateBlob(overrides: Partial<Parameters<typeof encodeState>[0]> = {}) {
	localStorage.setItem(
		OAUTH_STATE_KEY,
		encodeState({
			nonce: 'n1',
			return_to: '/agenda',
			intent: 'login',
			provider: 'google',
			...overrides
		})
	);
}

function exchangeOk(token = VALID_JWT) {
	exchangeMock.mockResolvedValue({ ok: true, token, accounts: [], user: { _id: 'u1' } });
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	exchangeMock.mockReset();
	discoverMock.mockReset();
	// Safe default: successful-exchange tests that don't care about discovery still
	// drive the (now-wired) post-auth hydrateCollectives, which destructures this
	// result. Individual tests override for the shape they assert on.
	discoverMock.mockResolvedValue({ collectives: [], erroredDbs: [] });
	gotoMock.mockReset();
	inviteCallbackMock.mockReset();
	linkCallbackMock.mockReset();
	// Pre-auth baseline: the store as it stands when the callback page loads and
	// the root layout's onMount already resolved it as anonymous → 'loading'.
	collectiveState.set({ status: 'loading' });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('runCallbackExchange — happy path', () => {
	it('exchanges, persists the token, and routes to the return target', async () => {
		seedStateBlob({ return_to: '/agenda' });
		exchangeOk();

		const outcome = await runCallbackExchange('session-key');

		expect(outcome).toEqual({ ok: true, redirectTo: '/agenda' });
		expect(exchangeMock).toHaveBeenCalledWith({ sessionToken: 'session-key' });
		expect(getToken()).toBe(VALID_JWT);
	});

	it('sanitises an unsafe return_to through the open-redirect guard', async () => {
		seedStateBlob({ return_to: '//evil.com' });
		exchangeOk();

		const outcome = await runCallbackExchange('session-key');
		expect(outcome).toEqual({ ok: true, redirectTo: '/' });
	});
});

describe('runCallbackExchange — CSRF single-use state blob', () => {
	it('consumes the blob on use (a replayed callback is rejected)', async () => {
		seedStateBlob();
		exchangeOk();

		const first = await runCallbackExchange('session-key');
		expect(first.ok).toBe(true);
		expect(localStorage.getItem(OAUTH_STATE_KEY)).toBeNull(); // consumed

		// Replay: same key, blob already gone → rejected, and no exchange attempted.
		exchangeMock.mockClear();
		const second = await runCallbackExchange('session-key');
		expect(second).toMatchObject({ ok: false, error: 'csrf_mismatch' });
		expect(exchangeMock).not.toHaveBeenCalled();
	});

	it('rejects when no state blob is present (never calls Entu)', async () => {
		const outcome = await runCallbackExchange('session-key');
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/auth/login?error=csrf_mismatch',
			error: 'csrf_mismatch'
		});
		expect(exchangeMock).not.toHaveBeenCalled();
	});

	it('rejects (and still consumes) a corrupt state blob', async () => {
		localStorage.setItem(OAUTH_STATE_KEY, '@@@not-valid@@@');
		const outcome = await runCallbackExchange('session-key');
		expect(outcome).toMatchObject({ ok: false, error: 'csrf_mismatch' });
		expect(localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
		expect(exchangeMock).not.toHaveBeenCalled();
	});
});

describe('runCallbackExchange — post-auth collective hydration (bug #7)', () => {
	it('resolves collectiveState after a successful exchange (not left at pre-auth loading)', async () => {
		seedStateBlob();
		exchangeOk(); // VALID_JWT carries accounts { polyphony: 'p1' }
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
			erroredDbs: []
		});

		// Baseline established in beforeEach: pre-auth 'loading'.
		expect(get(collectiveState).status).toBe('loading');

		const outcome = await runCallbackExchange('session-key');
		expect(outcome.ok).toBe(true);

		// The bug: the layout onMount ran as anonymous during this page's load and
		// does NOT re-run on the client-side goto, so without post-exchange discovery
		// the store stays 'loading' forever. It must be resolved before we redirect.
		expect(get(collectiveState).status).toBe('ready');
		expect(discoverMock).toHaveBeenCalledWith({ polyphony: 'p1' }, VALID_JWT, expect.anything());
	});
});

describe('runCallbackExchange — invite intent delegates to the invite path (T4.5/#31)', () => {
	it('routes an invite-intent state blob to runInviteCallbackExchange and NEVER calls the db-less exchange', async () => {
		seedStateBlob({
			intent: 'invite',
			return_to: '/invite/tok.a.b',
			invite: { db: 'polyphony', token: 'tok.a.b' }
		});
		exchangeOk(); // if the non-invite path ran by mistake, it would "succeed" — the assertions below catch it
		inviteCallbackMock.mockResolvedValue({ ok: true, redirectTo: '/' });

		const outcome = await runCallbackExchange('session-key');

		expect(inviteCallbackMock).toHaveBeenCalledWith(
			'session-key',
			expect.objectContaining({
				intent: 'invite',
				invite: { db: 'polyphony', token: 'tok.a.b' }
			})
		);
		expect(exchangeMock).not.toHaveBeenCalled();
		expect(outcome).toEqual({ ok: true, redirectTo: '/' });
	});

	it('a non-invite blob never touches the invite path (regression: the proven login flow stays as-is)', async () => {
		seedStateBlob({ intent: 'login' });
		exchangeOk();

		const outcome = await runCallbackExchange('session-key');
		expect(outcome.ok).toBe(true);
		expect(inviteCallbackMock).not.toHaveBeenCalled();
	});
});

describe('runCallbackExchange — exchange failure', () => {
	it('routes back to login with the exchange error (blob already consumed)', async () => {
		seedStateBlob();
		exchangeMock.mockResolvedValue({ ok: false, error: 'entu_auth_failed' });

		const outcome = await runCallbackExchange('session-key');
		expect(outcome).toEqual({
			ok: false,
			redirectTo: '/auth/login?error=entu_auth_failed',
			error: 'entu_auth_failed'
		});
		expect(getToken()).toBeNull();
		expect(localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
	});
});
