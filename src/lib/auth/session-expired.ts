// #107 — the one place that builds the "your session expired, sign in again"
// URL. Both the automatic 401 recovery ($lib/entu/request.handleAuthExpired401)
// and every in-page session-expired notice (SessionExpiredNotice.svelte) use it,
// so the two can never carry different params.
//
// Two params, each load-bearing (#107 review F3):
//   • `error=session_expired` — the login page's onMount fast path short-circuits
//     on ANY error param (`if (error) return`). Without it, a user with a
//     remembered provider (which `preserveProvider: true` guarantees after a 401)
//     is bounced straight back to the OAuth provider and never learns why they
//     were signed out.
//   • `redirect=<target>` — the same contract `resolveGuardRedirect` (guard.ts)
//     emits and the login page reads to build each provider's `return_to`.
//     Without it, a session that dies deep in /event/<id> dumps the user on the
//     default route after re-auth — strictly worse than the ordinary expired-token
//     guard path, which preserves it.

export const SESSION_EXPIRED_ERROR = 'session_expired';

/**
 * Pure builder — `pathname`/`search` as the guard sees them. A non-local target
 * (open-redirect guard) or an `/auth/*` path (returning to the sign-in flow you
 * are already in is a loop, not a return) is dropped, leaving the flag alone.
 */
export function sessionExpiredSignInHref(pathname: string, search = ''): string {
	const base = `/auth/login?error=${SESSION_EXPIRED_ERROR}`;
	if (!pathname.startsWith('/') || pathname.startsWith('//')) return base;
	if (pathname.startsWith('/auth/')) return base;
	return `${base}&redirect=${encodeURIComponent(pathname + search)}`;
}

/** Browser convenience: the CURRENT location as the return target. Falls back to
 *  the bare flag wherever `location` does not exist (non-DOM test/SSR contexts). */
export function currentSessionExpiredSignInHref(): string {
	if (typeof location === 'undefined') return `/auth/login?error=${SESSION_EXPIRED_ERROR}`;
	return sessionExpiredSignInHref(location.pathname, location.search);
}

// (*MVOX:Josquin*)
