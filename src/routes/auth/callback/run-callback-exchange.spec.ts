// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeState, OAUTH_STATE_KEY } from '$lib/auth/state';
import { getToken } from '$lib/auth/storage';

// Mock the Entu exchange at its module boundary. This keeps the test a true unit
// (no network) AND severs the transitive `$env/dynamic/public` import that
// entu-config pulls in — that virtual module doesn't resolve under happy-dom.
const { exchangeMock } = vi.hoisted(() => ({ exchangeMock: vi.fn() }));
vi.mock('$lib/auth/exchange', () => ({ exchangeSession: exchangeMock }));

// Imported after the mock is registered (vi.mock is hoisted above imports anyway).
import { runCallbackExchange } from './run-callback-exchange';

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
