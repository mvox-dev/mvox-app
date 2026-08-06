import { ENTU_API_BASE } from '$lib/entu-config';
import { getUser } from '$lib/auth/storage';
import { encodeState, OAUTH_STATE_KEY } from '$lib/auth/state';

export interface OAuthInitArgs {
	provider: string;
	origin: string;
	returnTo: string;
	intent: 'login' | 'reauth' | 'invite';
	nonce: string;
	/**
	 * T4.5/#31: for `intent: 'invite'` the invite token + db must ride the
	 * localStorage state blob (never the Entu init URL — the token must not
	 * transit oauth.ee).
	 */
	invite?: { db: string; token: string };
}

/**
 * Build the Entu OAuth-init URL and stash the CSRF/return state in localStorage.
 *
 * DB-AGNOSTIC (T3): no `?db=` is passed. Entu's OAuth init does not need a db, and
 * the subsequent token exchange is deliberately db-less too (see exchange.ts) so
 * the issued token's `accounts` map spans every collective the user belongs to.
 */
export function buildOAuthInitUrl(args: OAuthInitArgs): string {
	// Persist state to localStorage BEFORE redirect — Entu's redirect appends the
	// JWT directly after the `key=` stub in `next`, with no separator and no new
	// query param. State must NOT live in the URL.
	const state = encodeState({
		nonce: args.nonce,
		return_to: args.returnTo,
		intent: args.intent,
		provider: args.provider,
		// Invite intent only: the blob is the ONLY carrier of the invite token across
		// the OAuth round-trip. It never enters the returned Entu init URL.
		...(args.invite ? { invite: args.invite } : {}),
	});
	localStorage.setItem(OAUTH_STATE_KEY, state);

	const callbackUrl = `${args.origin}/auth/callback?key=`;
	const params = new URLSearchParams({ next: callbackUrl });

	const user = getUser();
	if (user?.email) {
		params.set('login_hint', user.email);
	}

	return `${ENTU_API_BASE}auth/${args.provider}?${params.toString()}`;
}

// (*MVOX:Josquin*)
