// Client-side route guard: no server (ssr = false), so "is the user signed in?" is answered
// from the localStorage JWT. Pure functions; `+layout.ts` wires the decision to `redirect()`.

import { sessionExpiredSignInHref } from './session-expired';

export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
	const parts = token?.split('.');
	if (!parts || parts.length < 2 || !parts[1]) return null;
	try {
		let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		b64 += '='.repeat((4 - (b64.length % 4)) % 4); // restore base64 padding for atob
		return JSON.parse(atob(b64)) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function decodeJwtExpMs(token: string | null | undefined): number | null {
	const payload = decodeJwtPayload(token);
	return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : null;
}

export function isTokenValid(token: string | null | undefined, nowMs: number): boolean {
	if (!token) return false;
	const expMs = decodeJwtExpMs(token);
	return expMs !== null && expMs > nowMs;
}

const PUBLIC_EXACT = new Set(['/about']);

/** True iff the path requires a session. Public allowlist + assets/internal paths pass through. */
export function isProtectedPath(pathname: string): boolean {
	if (PUBLIC_EXACT.has(pathname)) return false;
	if (pathname.startsWith('/auth/')) return false;
	if (pathname.startsWith('/invite/')) return false; // unauthed invite landing (later slice)
	if (pathname.startsWith('/_app/') || pathname.startsWith('/.well-known')) return false;
	if (/\.[a-zA-Z0-9]+$/.test(pathname)) return false; // has a file extension → asset
	return true;
}

// Where a visitor without a valid session goes: login, the session-expired sign-in when the
// token's exp has passed, or null when the path is public or the token is valid.
export function resolveGuardRedirect(args: {
	pathname: string;
	search?: string;
	token: string | null | undefined;
	nowMs: number;
}): string | null {
	if (!isProtectedPath(args.pathname)) return null;
	if (isTokenValid(args.token, args.nowMs)) return null;
	const search = args.search ?? '';
	if (args.token && decodeJwtExpMs(args.token) !== null) {
		return sessionExpiredSignInHref(args.pathname, search);
	}
	const target = args.pathname + search;
	return `/auth/login?redirect=${encodeURIComponent(target)}`;
}

// (*MVOX:Josquin*)
