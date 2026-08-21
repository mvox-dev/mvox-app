// @vitest-environment happy-dom
//
// #107 RED — auth token expiry recovery at the entuFetch layer.
//
// Bug: when Entu answers 401 (expired/revoked/IP-mismatched JWT — the local
// `exp` check in guard.ts cannot catch those), every page surfaces a misleading
// data-loading error ("Couldn't load …") while the stale token stays in
// localStorage, so a reload just fails the same way.
//
// NOTE ON THE TASK WORDING: the issue speaks of "the BFF's entuFetch layer" and
// "clear the auth cookie" / "server-side load function". This app is a pure
// client-side SPA (ssr = false, localStorage JWT — see +layout.ts and
// auth/storage.ts): there is no BFF, no cookie, and no server load. The
// architectural equivalents pinned here are:
//   - BFF entuFetch layer  → `$lib/entu/request.entuFetch` (the one data seam)
//   - clear the auth cookie → `clearAll({ preserveProvider: true })` on storage
//   - server redirect       → a single client `goto` to the sign-in page
//
// CONTRACT (for the GREEN implementer), all in `$lib/entu/request`:
//   - `entuFetch` receiving a 401 response must:
//       1. clear the localStorage auth session (provider preserved, so re-auth
//          pre-selects it — same choice hydrateAuth makes for locally-expired
//          tokens);
//       2. trigger exactly ONE `goto('/auth/login?…')` whose URL carries a
//          `session_expired` flag — single-flight across CONCURRENT 401s (an
//          agenda load fans out many requests; they must not stampede goto);
//       3. reject with an error whose `name === 'AuthExpiredError'`.
//   - `isAuthExpiredError(e: unknown): boolean` is exported and detects BY THE
//     `name` TAG, not instanceof — page specs (and any future module-boundary
//     duplication) construct duck-typed errors, and instanceof is brittle
//     across vitest module graphs.
//   - Non-401 responses keep resolving as plain Responses, and a network
//     rejection propagates unchanged — the data-loading error paths of every
//     caller stay exactly as they are (regression guard below).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Severs the $env/dynamic/public chain (unavailable outside a SvelteKit request
// context under happy-dom) — same one-liner every page spec uses.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

// The single-flight redirect guard is module state — every test gets a FRESH
// module instance so one test's fired redirect can't leak into the next.
// Typed as an intersection with the not-yet-existing surface so this RED spec
// still typechecks before GREEN lands (`isAuthExpiredError` is optional here;
// the tests assert it exists at runtime).
type AuthExpiredApi = { isAuthExpiredError?: (e: unknown) => boolean };
async function freshModules() {
	vi.resetModules();
	const req = (await import('./request')) as typeof import('./request') & AuthExpiredApi;
	const storage = await import('$lib/auth/storage');
	const session = await import('$lib/auth/session');
	// The teardown+redirect half lives behind a registration seam so node
	// migration scripts can still import this module (review R2/F1). The app
	// installs it from the root layout's module scope; the spec installs the
	// REAL one here, so every assertion below still exercises production code.
	const { install401Recovery } = await import('$lib/auth/install-401-recovery');
	install401Recovery();
	return { req, storage, session };
}

const resp = (status: number, body = '{}') => new Response(body, { status });

beforeEach(() => {
	gotoMock.mockReset();
	// The recovery URL now embeds the CURRENT location as its `redirect` target,
	// so each test starts from a known path.
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
			resolved = await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-stale', {}, fetchImpl);
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

		await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

		expect(storage.getToken(), 'stale token must be cleared').toBeNull();
		expect(storage.getUser(), 'stale user must be cleared').toBeNull();
		expect(storage.getLastProvider(), 'provider survives for re-auth pre-select').toBe('google');
	});

	it('redirects to sign-in carrying a session-expired flag', async () => {
		const { req, storage } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

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
			req.entuFetch('polyphony', 'entity?_type.string=event', 'jwt-stale', {}, fetchImpl),
			req.entuFetch('polyphony', 'entity?_type.string=member', 'jwt-stale', {}, fetchImpl),
			req.entuFetch('polyphony', 'entity?_type.string=season', 'jwt-stale', {}, fetchImpl)
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

// ── #107 review round 1 — the gaps the first GREEN pass left.
describe('entuFetch — 401 handling, review fixes (#107 R1)', () => {
	// F1: clearing localStorage alone left `authStore` asserting 'authenticated'.
	// The recovery is a client-side `goto` (no document reload), so nothing
	// re-hydrates the store: NavShell keeps rendering the full signed-in nav on
	// the sign-in page, and the layout's auth-keyed effects keep firing Entu
	// reads with an empty Bearer. The teardown must be the SAME one sign-out uses.
	it('resets the IN-MEMORY auth state to anonymous, not just localStorage', async () => {
		const { req, storage, session } = await freshModules();
		storage.setToken('jwt-stale');
		session.authStore.set({
			status: 'authenticated',
			personIdByDb: { polyphony: 'person-p' },
			expMs: Date.now() + 100_000
		});
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

		expect(get(session.authStore)).toEqual({ status: 'anonymous' });
	});

	// F3: every other redirect in the app carries the return path
	// (resolveGuardRedirect emits `?redirect=<encoded target>`, and the login page
	// reads exactly that to build each provider's `return_to`). Dropping it made
	// the 401 path strictly worse than the ordinary expired-token guard path.
	it('carries BOTH the session-expired flag and the return path, so re-auth lands back where the session died', async () => {
		history.replaceState({}, '', '/event/ev123?tab=works');
		const { req, storage } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});

		const target = new URL(String(gotoMock.mock.calls[0][0]), 'http://localhost');
		expect(target.pathname).toBe('/auth/login');
		expect(target.searchParams.get('error')).toBe('session_expired');
		expect(target.searchParams.get('redirect')).toBe('/event/ev123?tab=works');
	});

	// F5: the single-flight latch was set and NEVER reset — no reset export, no
	// assignment back to false anywhere. Once latched, every later 401 in that
	// page's lifetime skipped BOTH the teardown and the redirect and only threw.
	// Deliberately NO vi.resetModules() between the two expiries: this is the one
	// test that exercises an ALREADY-LATCHED module.
	it('releases the single-flight latch once the navigation settles — a LATER 401 recovers again', async () => {
		const { req, storage, session } = await freshModules();
		storage.setToken('jwt-stale');
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-stale', {}, fetchImpl).catch(() => {});
		expect(gotoMock).toHaveBeenCalledTimes(1);

		// The user did not re-authenticate (they stayed in the SPA, or the
		// navigation was cancelled) — same module instance, same latch.
		await Promise.resolve();
		storage.setToken('jwt-still-stale');
		session.authStore.set({
			status: 'authenticated',
			personIdByDb: { polyphony: 'person-p' },
			expMs: Date.now() + 100_000
		});

		await req
			.entuFetch('polyphony', 'entity?limit=1', 'jwt-still-stale', {}, fetchImpl)
			.catch(() => {});

		expect(gotoMock, 'a second expiry must redirect again, not silently no-op').toHaveBeenCalledTimes(2);
		expect(storage.getToken(), 'the second expiry must clear the session too').toBeNull();
		expect(get(session.authStore)).toEqual({ status: 'anonymous' });
	});

	// F6: the write paths (rsvp/attendance/repertoire/profile queues) surface a
	// rejection through their own "couldn't save" UI. That stays as-is — the
	// redirect is the handling — but it only bounds the damage if a 401 on a
	// WRITE fires the identical recovery. Pinned here.
	it('a 401 on a WRITE (POST) fires the same recovery as a read', async () => {
		const { req, storage, session } = await freshModules();
		storage.setToken('jwt-stale');
		session.authStore.set({
			status: 'authenticated',
			personIdByDb: { polyphony: 'person-p' },
			expMs: Date.now() + 100_000
		});
		const fetchImpl = vi.fn().mockResolvedValue(resp(401));

		let caught: unknown;
		try {
			await req.entuFetch(
				'polyphony',
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

		const res = await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-live', {}, fetchImpl);

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
			await req.entuFetch('polyphony', 'entity?limit=1', 'jwt-live', {}, fetchImpl);
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
