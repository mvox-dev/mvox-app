// Builds the Entu OAuth-init URL and stashes the CSRF/return state in localStorage.
import { ENTU_API_BASE } from '$lib/entu-config';
import { getUser } from '$lib/auth/storage';
import { encodeState, OAUTH_STATE_KEY } from '$lib/auth/state';

interface OAuthInitArgs {
	provider: string;
	origin: string;
	returnTo: string;
	intent: 'login' | 'reauth' | 'invite' | 'link';
	nonce: string;
	invite?: { db: string; token: string };
	linkPersonId?: string;
	linkedSnapshot?: Array<{ _id: string; uid: string; provider: string }>;
}

export function buildOAuthInitUrl(args: OAuthInitArgs): string {
	const state = encodeState({
		nonce: args.nonce,
		return_to: args.returnTo,
		intent: args.intent,
		provider: args.provider,
		...(args.invite ? { invite: args.invite } : {}),
		...(args.linkPersonId ? { linkPersonId: args.linkPersonId } : {}),
		...(args.intent === 'link' && args.linkedSnapshot
			? { linkedSnapshot: args.linkedSnapshot }
			: {})
	});
	localStorage.setItem(OAUTH_STATE_KEY, state);

	const callbackUrl = `${args.origin}/auth/callback?key=`;
	const params = new URLSearchParams({ next: callbackUrl });

	if (args.intent !== 'link') {
		const user = getUser();
		if (user?.email) {
			params.set('login_hint', user.email);
		}
	}

	const path =
		args.intent === 'link' && args.provider === 'passkey' ? 'passkey/register' : args.provider;
	return `${ENTU_API_BASE}auth/${path}?${params.toString()}`;
}

