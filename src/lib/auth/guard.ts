// Client-side route guard — replaces the old SSR `hooks.server.ts` cookie gate.
//
// There is no server in this SPA (ssr = false), so "is the user logged in?" is
// answered in the browser from the localStorage JWT. These are PURE functions (no
// SvelteKit / browser-global imports beyond `atob`) so they unit-test without a
// request; `+layout.ts` wires the decision to `redirect()`.
//
// `decodeJwtExpMs` + `isProtectedPath` are the reusable halves harvested from the
// old `src/lib/server/auth/session-cookie.ts`; everything cookie-related is dropped.

/** Decode an unverified JWT payload (base64url) to a plain object, or null on any malformed input. */
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

/** Decode an unverified JWT and return its `exp` in milliseconds, or null on any malformed input. */
export function decodeJwtExpMs(token: string | null | undefined): number | null {
	const payload = decodeJwtPayload(token);
	return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : null;
}

/** True iff a token is present and its decoded `exp` is in the future relative to `nowMs`. */
export function isTokenValid(token: string | null | undefined, nowMs: number): boolean {
	if (!token) return false;
	const expMs = decodeJwtExpMs(token);
	return expMs !== null && expMs > nowMs;
}

const PUBLIC_EXACT = new Set(['/', '/about']);

/** True iff the path requires a session. Public allowlist + assets/internal paths pass through. */
export function isProtectedPath(pathname: string): boolean {
	if (PUBLIC_EXACT.has(pathname)) return false;
	if (pathname.startsWith('/auth/')) return false;
	if (pathname.startsWith('/invite/')) return false; // unauthed invite landing (later slice)
	if (pathname.startsWith('/_app/') || pathname.startsWith('/.well-known')) return false;
	if (/\.[a-zA-Z0-9]+$/.test(pathname)) return false; // has a file extension → asset
	return true;
}

/**
 * Decide where an unauthenticated visitor should be sent. Returns a
 * `/auth/login?redirect=<target>` path when the requested route is protected and
 * the token is missing/expired, or `null` when the visit is allowed to proceed.
 */
export function resolveGuardRedirect(args: {
	pathname: string;
	search?: string;
	token: string | null | undefined;
	nowMs: number;
}): string | null {
	if (!isProtectedPath(args.pathname)) return null;
	if (isTokenValid(args.token, args.nowMs)) return null;
	const target = args.pathname + (args.search ?? '');
	return `/auth/login?redirect=${encodeURIComponent(target)}`;
}

// (*MVOX:Josquin*)
