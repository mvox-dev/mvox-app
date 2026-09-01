// @vitest-environment happy-dom
//
// #107 review F3 — the recovery redirect used to be a bare
// `/auth/login?error=session_expired`, dropping the return path that every
// other redirect in the app carries (`resolveGuardRedirect` always emits
// `?redirect=<encoded target>`, and the login page reads exactly that to build
// each provider's `return_to`). A session dying deep in /event/<id> therefore
// dumped the user on the default route after re-auth — strictly worse than the
// ordinary expired-token guard path.
import { afterEach, describe, expect, it } from 'vitest';
import {
	SESSION_EXPIRED_ERROR,
	currentSessionExpiredSignInHref,
	sessionExpiredSignInHref
} from './session-expired';

afterEach(() => {
	history.replaceState({}, '', '/');
});

describe('sessionExpiredSignInHref', () => {
	it('carries the flag AND the return path, the same `redirect=` contract resolveGuardRedirect emits', () => {
		const url = new URL(sessionExpiredSignInHref('/event/ev1', '?tab=works'), 'http://localhost');
		expect(url.pathname).toBe('/auth/login');
		expect(url.searchParams.get('error')).toBe(SESSION_EXPIRED_ERROR);
		expect(url.searchParams.get('redirect')).toBe('/event/ev1?tab=works');
	});

	it('always carries the error flag — without it the login page cannot select its session_expired branch and the arrival is indistinguishable from an ordinary sign-in', () => {
		// #206 note: the login page's remembered-provider auto-redirect is retired
		// (the picker always renders now), but the error flag still matters — it
		// gates the session-expired copy so a signed-out user can read why before
		// re-authing, and the 401 recovery preserves the provider for that CTA.
		for (const href of [
			sessionExpiredSignInHref('/roster'),
			sessionExpiredSignInHref('https://evil.example/steal'),
			sessionExpiredSignInHref('/auth/callback')
		]) {
			expect(href).toContain(`error=${SESSION_EXPIRED_ERROR}`);
		}
	});

	it('drops a non-local target (open-redirect guard) rather than echoing it back', () => {
		expect(sessionExpiredSignInHref('https://evil.example/steal')).not.toContain('redirect=');
		expect(sessionExpiredSignInHref('//evil.example/steal')).not.toContain('redirect=');
	});

	it('drops an /auth/* target — returning into the sign-in flow you are already in is a loop, not a return', () => {
		expect(sessionExpiredSignInHref('/auth/login')).not.toContain('redirect=');
		expect(sessionExpiredSignInHref('/auth/callback', '?code=x')).not.toContain('redirect=');
	});
});

describe('currentSessionExpiredSignInHref', () => {
	it('uses the CURRENT location as the return target', () => {
		history.replaceState({}, '', '/library?q=byrd');
		const url = new URL(currentSessionExpiredSignInHref(), 'http://localhost');
		expect(url.searchParams.get('redirect')).toBe('/library?q=byrd');
		expect(url.searchParams.get('error')).toBe(SESSION_EXPIRED_ERROR);
	});
});

// (*MVOX:Josquin*)
