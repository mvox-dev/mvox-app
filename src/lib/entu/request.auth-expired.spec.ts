// @vitest-environment happy-dom
// A 401 from Entu clears the session, fires one goto to the sign-in page carrying
// session_expired, and rejects with an AuthExpiredError; other responses pass unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// goto stays hoisted: vi.resetModules() would hand a routeMocks factory a new gotoMock.
const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Severs the $env/dynamic/public chain, unavailable outside SvelteKit.
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

// The single-flight redirect guard is module state, so every test gets a fresh module instance;
// one test's fired redirect can't leak into the next.
type AuthExpiredApi = { isAuthExpiredError?: (e: unknown) => boolean };
async function freshModules() {
	vi.resetModules();
	const req = (await import('./request')) as typeof import('./request') & AuthExpiredApi;
	const storage = await import('$lib/auth/storage');
	const session = await import('$lib/auth/session');
	// The teardown+redirect half sits behind a registration seam so node scripts can import
	// request; the spec installs the real one, so every assertion exercises production code.
	const { install401Recovery } = await import('$lib/auth/install-401-recovery');
	install401Recovery();
	return { req, storage, session };
}

const resp = (status: number, body = '{}') => new Response(body, { status });

beforeEach(() => {
	gotoMock.mockReset();
	// The recovery URL embeds the current location as its redirect target.
	history.replaceState({}, '', '/');
});

afterEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	history.replaceState({}, '', '/');
});

describe('entuFetch — 401 handling (#107)', () => {
	it('rejects with a specific auth-expired error (name AuthExpiredError), never resolves the 401 as data', async () => {
		const { req, storage } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401, 'unauthorized'));

		let resolved: Response | undefined;
		let caught: unknown;
		try {
			resolved = await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-stale', {}, fetchImpl);
		} catch (e) {
			caught = e;
		}

		expect(resolved, 'a 401 must NOT resolve as a plain Response').toBeUndefined();
		expect(caught).toBeInstanceOf(Error);
		expect((caught as Error).name).toBe('AuthExpiredError');
	});

	it('clears the stale localStorage session (token + user gone, provider PRESERVED for re-auth)', async () => {
		const { req, storage } = await freshModules();
		storage.setToken('jwt-stale');
		storage.setUser({ _id: 'u1', email: 'ada@example.com' });
		storage.setLastProvider('google');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

		expect(storage.getToken(), 'stale token must be cleared').toBeNull();
		expect(storage.getUser(), 'stale user must be cleared').toBeNull();
		expect(storage.getLastProvider(), 'provider survives for re-auth pre-select').toBe('google');
	});

	it('redirects to sign-in carrying a session-expired flag', async () => {
		const { req, storage } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

		expect(gotoMock).toHaveBeenCalledTimes(1);
		const target = String(gotoMock.mock.calls[0][0]);
		expect(target).toContain('/auth/login');
		expect(target).toContain('session_expired');
	});

	it('CONCURRENT 401s → every call rejects auth-expired, but exactly ONE redirect fires (no redirect storm)', async () => {
		const { req, storage } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockImplementation(async () => resp(401));

		const results = await Promise.allSettled([
			req.entuFetch('sampledb', 'entity?_type.string=event', 'jwt-stale', {}, fetchImpl),
			req.entuFetch('sampledb', 'entity?_type.string=member', 'jwt-stale', {}, fetchImpl),
			req.entuFetch('sampledb', 'entity?_type.string=season', 'jwt-stale', {}, fetchImpl)
		]);

		for (const r of results) {
			expect(r.status, 'every concurrent 401 caller must see the rejection').toBe('rejected');
		}
		expect(gotoMock).toHaveBeenCalledTimes(1);
	});

	it('exports isAuthExpiredError — detecting by the name tag (duck-typed, cross-module-boundary safe)', async () => {
		const { req } = await freshModules();
		expect(typeof req.isAuthExpiredError).toBe('function');

		const tagged = new Error('Entu returned 401');
		tagged.name = 'AuthExpiredError';
		expect(req.isAuthExpiredError?.(tagged)).toBe(true);
		expect(req.isAuthExpiredError?.(new Error('network down'))).toBe(false);
		expect(req.isAuthExpiredError?.(undefined)).toBe(false);
		expect(req.isAuthExpiredError?.('AuthExpiredError')).toBe(false);
	});
});

// ── teardown, return path, latch release, writes ─────────────────────────────
describe('entuFetch — 401 handling, review fixes (#107 R1)', () => {
	// The recovery is a client-side goto with no reload, so nothing re-hydrates the store:
	// the teardown must be the same one sign-out uses.
	it('resets the IN-MEMORY auth state to anonymous, not just localStorage', async () => {
		const { req, storage, session } = await freshModules();
		storage.setToken('jwt-stale');
		session.authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-p' },
			expMs: Date.now() + 100_000
		});
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

		expect(get(session.authStore)).toEqual({ status: 'anonymous' });
	});

	// Like every other redirect, it carries ?redirect=, which the login page turns into each
	// provider's return_to.
	it('carries BOTH the session-expired flag and the return path, so re-auth lands back where the session died', async () => {
		history.replaceState({}, '', '/event/ev123?tab=works');
		const { req, storage } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

		const target = new URL(String(gotoMock.mock.calls[0][0]), 'http://localhost');
		expect(target.pathname).toBe('/auth/login');
		expect(target.searchParams.get('error')).toBe('session_expired');
		expect(target.searchParams.get('redirect')).toBe('/event/ev123?tab=works');
	});

	// A latch that never resets makes every later 401 skip teardown and redirect. Deliberately
	// no vi.resetModules() between the two expiries: this test exercises a latched module.
	it('releases the single-flight latch once the navigation settles — a LATER 401 recovers again', async () => {
		const { req, storage, session } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});
		expect(gotoMock).toHaveBeenCalledTimes(1);

		// The user did not re-authenticate (they stayed in the SPA, or the
		// navigation was cancelled) — same module instance, same latch.
		await Promise.resolve();
		storage.setToken('jwt-still-stale');
		session.authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-p' },
			expMs: Date.now() + 100_000
		});

		await req
			.entuFetch('sampledb', 'entity?limit=1', 'jwt-still-stale', {}, fetchImpl)
			.catch(() => {});

		expect(gotoMock, 'a second expiry must redirect again, not silently no-op').toHaveBeenCalledTimes(2);
		expect(storage.getToken(), 'the second expiry must clear the session too').toBeNull();
		expect(get(session.authStore)).toEqual({ status: 'anonymous' });
	});

	// Write paths show their own "couldn't save" UI; the redirect only bounds the damage if a
	// 401 on a write fires the identical recovery.
	it('a 401 on a WRITE (POST) fires the same recovery as a read', async () => {
		const { req, storage, session } = await freshModules();
		storage.setToken('jwt-stale');
		session.authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-p' },
			expMs: Date.now() + 100_000
		});
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		let caught: unknown;
		try {
			await req.entuFetch(
				'sampledb',
				'entity/ev1',
				'jwt-stale',
				{ method: 'POST', body: '[]' },
				fetchImpl
			);
		} catch (e) {
			caught = e;
		}

		expect(req.isAuthExpiredError?.(caught)).toBe(true);
		expect(storage.getToken()).toBeNull();
		expect(get(session.authStore)).toEqual({ status: 'anonymous' });
		expect(gotoMock).toHaveBeenCalledTimes(1);
	});
});

describe('entuFetch — non-401 failures stay data-loading errors (regression guard)', () => {
	it('a 500 still resolves as a plain Response: no session clearing, no redirect', async () => {
		const { req, storage } = await freshModules();
		storage.setToken('jwt-live');
		const fetchImpl = vi.fn().mockResolvedValue(resp(500, 'boom'));

		const res = await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-live', {}, fetchImpl);

		expect(res.status).toBe(500);
		expect(storage.getToken(), 'a 500 must not clear the session').toBe('jwt-live');
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('a network rejection propagates UNCHANGED — and is NOT auth-expired', async () => {
		const { req, storage } = await freshModules();
		storage.setToken('jwt-live');
		const boom = new Error('network down');
		const fetchImpl = vi.fn().mockRejectedValue(boom);

		let caught: unknown;
		try {
			await req.entuFetch('sampledb', 'entity?limit=1', 'jwt-live', {}, fetchImpl);
		} catch (e) {
			caught = e;
		}

		expect(caught).toBe(boom);
		expect(req.isAuthExpiredError?.(caught)).toBe(false);
		expect(storage.getToken()).toBe('jwt-live');
		expect(gotoMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
