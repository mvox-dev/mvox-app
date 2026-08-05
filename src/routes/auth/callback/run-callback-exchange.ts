import { exchangeSession } from '$lib/auth/exchange';
import { setToken, setUser, setLastProvider } from '$lib/auth/storage';
import { decodeState, OAUTH_STATE_KEY } from '$lib/auth/state';
import { safeRedirectTarget } from '$lib/auth/redirect';
import { hydrateAuth } from '$lib/auth/session';

export type CallbackOutcome =
	| { ok: true; redirectTo: string }
	| { ok: false; redirectTo: string; error: string };

/**
 * Orchestrate the client-side OAuth callback: validate the initiation state,
 * exchange the session `key` for a full Entu JWT (db-less), persist it, and
 * report where to route next. Extracted from the `.svelte` page so the flow is
 * unit-testable without a component render.
 *
 * CSRF note: client-side login-CSRF is architecturally unpreventable here — Entu
 * appends the JWT directly after `key=` with no separator, so a nonce cannot
 * round-trip through the callback URL. The mitigation is SINGLE-USE of the
 * localStorage OAuth-state blob: we read AND remove it up front, so a replayed
 * callback (same URL reopened) finds no blob and is rejected. This shrinks the
 * acceptance window to a genuinely mid-flow browser.
 */
export async function runCallbackExchange(key: string): Promise<CallbackOutcome> {
	// Single-use consume: read then immediately remove, before anything can fail.
	const stateBlob = localStorage.getItem(OAUTH_STATE_KEY);
	localStorage.removeItem(OAUTH_STATE_KEY);

	if (!stateBlob) {
		return { ok: false, redirectTo: '/auth/login?error=csrf_mismatch', error: 'csrf_mismatch' };
	}

	let decoded;
	try {
		decoded = decodeState(stateBlob);
	} catch {
		return { ok: false, redirectTo: '/auth/login?error=csrf_mismatch', error: 'csrf_mismatch' };
	}

	const result = await exchangeSession({ sessionToken: key });
	if (!result.ok) {
		return { ok: false, redirectTo: `/auth/login?error=${result.error}`, error: result.error };
	}

	try {
		// Sequence: user BEFORE token (setToken is the version gate that publishes state).
		setUser(result.user);
		setLastProvider(decoded.provider);
		setToken(result.token);
		hydrateAuth();
	} catch {
		// A localStorage write failure (quota/blocked/private-mode) must not hang the
		// spinner — fail closed back to login rather than leaving the user stuck.
		return { ok: false, redirectTo: '/auth/login?error=persist_failed', error: 'persist_failed' };
	}

	return { ok: true, redirectTo: safeRedirectTarget(decoded.return_to) };
}

// (*MVOX:Josquin*)
