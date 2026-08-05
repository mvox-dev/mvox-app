import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeSession } from './exchange';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('exchangeSession (db-less client exchange)', () => {
	it('returns missing_session_token when the session token is empty', async () => {
		const result = await exchangeSession({ sessionToken: '' });
		expect(result).toEqual({ ok: false, error: 'missing_session_token' });
	});

	it('calls Entu /auth WITHOUT a ?db= param and with the Bearer session token', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ token: 'jwt-xyz', accounts: [], user: { _id: 'u1' } }), {
					status: 200
				})
			);
		vi.stubGlobal('fetch', fetchMock);

		await exchangeSession({ sessionToken: 'session-abc' });

		const [url, init] = fetchMock.mock.calls[0];
		// db-less by design: the token's `accounts` map must span every collective.
		expect(String(url)).toBe('https://api.entu.app/auth');
		expect(String(url)).not.toContain('?db=');
		expect(init.headers.Authorization).toBe('Bearer session-abc');
	});

	it('returns ok with token/accounts/user on success', async () => {
		const payload = {
			token: 'jwt-xyz',
			accounts: [{ _id: 'a1', name: 'EFK' }],
			user: { _id: 'u1', email: 'alice@example.com' }
		};
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
		);

		const result = await exchangeSession({ sessionToken: 'session-abc' });
		expect(result).toEqual({ ok: true, ...payload });
	});

	it('returns entu_auth_failed on a non-2xx response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })));
		const result = await exchangeSession({ sessionToken: 'session-abc' });
		expect(result).toEqual({ ok: false, error: 'entu_auth_failed' });
	});

	it('returns entu_auth_failed when the response has no token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ accounts: [] }), { status: 200 }))
		);
		const result = await exchangeSession({ sessionToken: 'session-abc' });
		expect(result).toEqual({ ok: false, error: 'entu_auth_failed' });
	});

	it('returns entu_auth_failed on a network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
		const result = await exchangeSession({ sessionToken: 'session-abc' });
		expect(result).toEqual({ ok: false, error: 'entu_auth_failed' });
	});
});
