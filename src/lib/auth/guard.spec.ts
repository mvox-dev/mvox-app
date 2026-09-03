import { describe, expect, it } from 'vitest';
import {
	decodeJwtExpMs,
	decodeJwtPayload,
	isProtectedPath,
	isTokenValid,
	resolveGuardRedirect
} from './guard';
import { sessionExpiredSignInHref } from './session-expired';

// Build an unsigned JWT (base64url, no padding) with a given payload — mirrors what
// Entu issues, so the browser-side atob/base64url decode is exercised for real.
function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('decodeJwtPayload', () => {
	it('decodes a base64url payload including the accounts map', () => {
		const payload = decodeJwtPayload(jwt({ accounts: { polyphony: 'p1' }, exp: 123 }));
		expect(payload).toEqual({ accounts: { polyphony: 'p1' }, exp: 123 });
	});

	it('returns null on garbage / empty / non-JWT input', () => {
		expect(decodeJwtPayload('not-a-jwt')).toBeNull();
		expect(decodeJwtPayload('')).toBeNull();
		expect(decodeJwtPayload(null)).toBeNull();
		expect(decodeJwtPayload(undefined)).toBeNull();
	});
});

describe('decodeJwtExpMs', () => {
	it('returns exp in milliseconds', () => {
		expect(decodeJwtExpMs(jwt({ exp: 1000 }))).toBe(1_000_000);
	});

	it('returns null when exp is absent or malformed', () => {
		expect(decodeJwtExpMs(jwt({ accounts: {} }))).toBeNull();
		expect(decodeJwtExpMs('garbage')).toBeNull();
	});
});

describe('isTokenValid', () => {
	const now = 2_000_000_000_000; // ms
	it('is true for a present, unexpired token', () => {
		expect(isTokenValid(jwt({ exp: 2_000_000_001 }), now)).toBe(true); // exp*1000 > now
	});
	it('is false for expired / absent / garbage', () => {
		expect(isTokenValid(jwt({ exp: 1_999_999_999 }), now)).toBe(false);
		expect(isTokenValid(undefined, now)).toBe(false);
		expect(isTokenValid('garbage', now)).toBe(false);
	});
});

describe('isProtectedPath', () => {
	it('lets public + auth + asset paths through', () => {
		for (const p of ['/about', '/auth/login', '/auth/callback', '/_app/immutable/x.js', '/favicon.png'])
			expect(isProtectedPath(p)).toBe(false);
	});
	it('protects app routes — including the root agenda (#221)', () => {
		for (const p of ['/', '/agenda', '/library', '/roster', '/settings', '/library/x'])
			expect(isProtectedPath(p)).toBe(true);
	});

	// T4.5/#31 — the unauthed invite landing rides the /invite/ prefix allowlist.
	it('allowlists the tokened invite landing (unauthed by design)', () => {
		expect(isProtectedPath('/invite/eyJhb.claims.sig')).toBe(false);
		expect(isProtectedPath('/invite/')).toBe(false);
	});

	it('the BARE /invite (no trailing slash, no token) stays protected — real links always carry a token', () => {
		expect(isProtectedPath('/invite')).toBe(true);
	});

	it('the admin invite surface is protected automatically (not on the allowlist)', () => {
		expect(isProtectedPath('/admin/invite')).toBe(true);
	});
});

describe('resolveGuardRedirect', () => {
	const now = 2_000_000_000_000;
	const validToken = jwt({ exp: 2_000_000_001 });

	it('returns null (allowed) for a public path regardless of token', () => {
		expect(resolveGuardRedirect({ pathname: '/about', token: null, nowMs: now })).toBeNull();
	});

	it('returns null (allowed) for a protected path with a valid token', () => {
		expect(resolveGuardRedirect({ pathname: '/agenda', token: validToken, nowMs: now })).toBeNull();
	});

	it('redirects to login (preserving the target) for a protected path without a token', () => {
		expect(
			resolveGuardRedirect({ pathname: '/agenda', search: '?org=x', token: null, nowMs: now })
		).toEqual('/auth/login?redirect=%2Fagenda%3Forg%3Dx');
	});

	// #221 — expired token found at boot gets the session-expired login variant, so the
	// login page explains WHY instead of rendering a bare picker. Derive the expected
	// URL from sessionExpiredSignInHref (single source of truth) AND pin the literal.
	it('redirects to the session-expired login variant when the token is expired', () => {
		const expired = jwt({ exp: 1 });
		expect(resolveGuardRedirect({ pathname: '/library', token: expired, nowMs: now })).toEqual(
			sessionExpiredSignInHref('/library', '')
		);
		expect(resolveGuardRedirect({ pathname: '/library', token: expired, nowMs: now })).toEqual(
			'/auth/login?error=session_expired&redirect=%2Flibrary'
		);
	});

	// ——— #221: the root agenda is protected — anonymous visit redirects to sign-in ———

	it('root path with NO token redirects to the plain sign-in URL (#221)', () => {
		expect(resolveGuardRedirect({ pathname: '/', token: null, nowMs: now })).toEqual(
			'/auth/login?redirect=%2F'
		);
	});

	it('root path with an EXPIRED token redirects to the session-expired sign-in URL (#221)', () => {
		const expired = jwt({ exp: 1 });
		const got = resolveGuardRedirect({ pathname: '/', token: expired, nowMs: now });
		expect(got).toEqual(sessionExpiredSignInHref('/', ''));
		expect(got).toEqual('/auth/login?error=session_expired&redirect=%2F');
	});

	it('no-token and expired-token redirects are DIFFERENT strings (#221)', () => {
		const expired = jwt({ exp: 1 });
		const noToken = resolveGuardRedirect({ pathname: '/', token: null, nowMs: now });
		const withExpired = resolveGuardRedirect({ pathname: '/', token: expired, nowMs: now });
		expect(noToken).toEqual('/auth/login?redirect=%2F');
		expect(withExpired).toEqual('/auth/login?error=session_expired&redirect=%2F');
		expect(withExpired).not.toEqual(noToken);
	});

	it('root path with a VALID token is allowed through (#221)', () => {
		expect(resolveGuardRedirect({ pathname: '/', token: validToken, nowMs: now })).toBeNull();
	});

	it('root-path redirect preserves the query string (#221)', () => {
		expect(
			resolveGuardRedirect({ pathname: '/', search: '?collective=polyphony', token: null, nowMs: now })
		).toEqual('/auth/login?redirect=%2F%3Fcollective%3Dpolyphony');
	});

	it('/about stays public — anonymous visit is allowed (#221)', () => {
		expect(resolveGuardRedirect({ pathname: '/about', token: null, nowMs: now })).toBeNull();
	});
});
