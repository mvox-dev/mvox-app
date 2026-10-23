// OAuth state rides a localStorage blob, never the URL: Entu appends the JWT right after `key=`.

const NONCE_KEY = 'mvox.oauth_nonce';

// Lives here so storage.clearAll can drop the blob without a lib→routes import.
export const OAUTH_STATE_KEY = 'mvox.oauth_state';

export interface OAuthState {
	nonce: string;
	return_to: string;
	intent: 'login' | 'reauth' | 'invite' | 'link';
	provider: string;
	// invite and link only (#31, #193): the bearer token rides this blob, never the round trip.
	invite?: { db: string; token: string };
	linkPersonId?: string;
	// link only (#219, #1030): `string` is the user's own account email; the callback compares
	// provider+string to spot a re-link of an account already held. Nothing beyond that.
	linkedSnapshot?: Array<{ _id: string; provider: string; string: string }>;
}

export function createNonce(): string {
	return crypto.randomUUID();
}

export function encodeState(payload: OAuthState): string {
	const json = JSON.stringify(payload);
	return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(encoded: string): OAuthState {
	const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
	const json = atob(base64);
	return JSON.parse(json) as OAuthState;
}

export function storeNonce(nonce: string): void {
	sessionStorage.setItem(NONCE_KEY, nonce);
}

export function consumeNonce(): string | null {
	const nonce = sessionStorage.getItem(NONCE_KEY);
	if (nonce) sessionStorage.removeItem(NONCE_KEY);
	return nonce;
}

export function verifyNonce(received: string): boolean {
	const stored = consumeNonce();
	return stored !== null && stored === received;
}

// (*MVOX:Josquin*) — lifted as-is from the polyphony harvest (*FR:Celes*)
