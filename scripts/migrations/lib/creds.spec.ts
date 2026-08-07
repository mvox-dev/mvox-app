import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeApiKeyForJwt, loadCfg, normalizeBase } from './creds';

// T4.10 (#30) — token-exchange spec. The migration runs standalone (not
// browser-direct), so the local ENTU_API_KEY (an api-key, not a JWT) must be
// exchanged at `{base}auth` for a JWT. Mocked fetch — zero network.

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('exchangeApiKeyForJwt — api-key → JWT at {base}auth', () => {
	it('GETs {base}auth with the api-key as Bearer and returns body.token', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 'the-jwt' }));
		const jwt = await exchangeApiKeyForJwt('https://api.entu.app/', 'api-key-123', fetchImpl);
		expect(jwt).toBe('the-jwt');
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.entu.app/auth');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer api-key-123');
		expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
	});

	it('appends a trailing slash when the base lacks one', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 't' }));
		await exchangeApiKeyForJwt('https://api.entu.app', 'k', fetchImpl);
		expect((fetchImpl.mock.calls[0] as [string])[0]).toBe('https://api.entu.app/auth');
	});

	it('throws loudly on a non-2xx auth response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 401));
		await expect(exchangeApiKeyForJwt('https://api.entu.app/', 'bad', fetchImpl)).rejects.toThrow(/401/);
	});

	it('throws loudly on a 2xx body carrying no token (apparent-success trap)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await expect(exchangeApiKeyForJwt('https://api.entu.app/', 'k', fetchImpl)).rejects.toThrow(/no token/i);
	});
});

describe('normalizeBase', () => {
	it('is idempotent and always ends in exactly one slash', () => {
		expect(normalizeBase('https://x/')).toBe('https://x/');
		expect(normalizeBase('https://x')).toBe('https://x/');
	});
});

describe('loadCfg — host must be frozen at process start (PUBLIC_ENTU_API_BASE) matching ENTU_API_URL', () => {
	// The Entu host is frozen at import time; loadCfg cannot set it, so it FAILS LOUD
	// unless the operator exported a matching PUBLIC_ENTU_API_BASE before node started —
	// otherwise the JWT mints against ENTU_API_URL while entity writes go to the frozen host.
	const saved: Record<string, string | undefined> = {};
	const KEYS = ['ENTU_API_URL', 'ENTU_API_KEY', 'ENTU_DATABASE', 'PUBLIC_ENTU_API_BASE'] as const;

	beforeEach(() => {
		for (const k of KEYS) saved[k] = process.env[k];
		process.env.ENTU_API_URL = 'https://api.entu.app';
		process.env.ENTU_API_KEY = 'api-key-123';
		process.env.ENTU_DATABASE = 'polyphony';
		delete process.env.PUBLIC_ENTU_API_BASE;
	});
	afterEach(() => {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it('throws when PUBLIC_ENTU_API_BASE was not exported before node started', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 't' }));
		await expect(loadCfg(fetchImpl)).rejects.toThrow(/PUBLIC_ENTU_API_BASE.*not exported|frozen/i);
		expect(fetchImpl).not.toHaveBeenCalled(); // fail loud BEFORE any network
	});

	it('throws when PUBLIC_ENTU_API_BASE (frozen host) mismatches ENTU_API_URL', async () => {
		process.env.PUBLIC_ENTU_API_BASE = 'https://other-host.example/';
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 't' }));
		await expect(loadCfg(fetchImpl)).rejects.toThrow(/mismatch/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('succeeds (exchanges the JWT) when the frozen host matches ENTU_API_URL', async () => {
		process.env.PUBLIC_ENTU_API_BASE = 'https://api.entu.app/';
		const fetchImpl = vi.fn().mockResolvedValue(json({ token: 'the-jwt' }));
		const cfg = await loadCfg(fetchImpl);
		expect(cfg).toEqual({ db: 'polyphony', token: 'the-jwt' });
	});
});
