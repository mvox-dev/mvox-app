import { exchangeSession } from '$lib/auth/exchange';
import { setToken, setUser, setLastProvider } from '$lib/auth/storage';
import { decodeState, OAUTH_STATE_KEY } from '$lib/auth/state';
import { safeRedirectTarget } from '$lib/auth/redirect';
import { hydrateAuth } from '$lib/auth/session';
import { hydrateCollectives } from '$lib/collectives/store';
import { runInviteCallbackExchange } from './run-invite-callback';

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

	// T4.5 (#31): an invite-intent blob takes the invite path (account-scoped
	// exchange with the invite token); the db-less exchangeSession is never called
	// in invite mode. The non-invite path below is unchanged.
	if (decoded.intent === 'invite') {
		return runInviteCallbackExchange(key, decoded);
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

	// Drive collective discovery HERE, before we redirect. The root layout's onMount
	// already ran (as anonymous) during THIS callback page's full load and does NOT
	// re-run on the client-side `goto` back to the app — so without this the landing
	// page is stranded at "Loading collectives…" until a manual full refresh. This
	// resolves collectiveState to ready/none/error; it catches internally and never
	// throws, so a discovery hiccup can't fail an otherwise-successful login.
	await hydrateCollectives();

	return { ok: true, redirectTo: safeRedirectTarget(decoded.return_to) };
}

// (*MVOX:Josquin*)
