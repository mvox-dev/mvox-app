// OAuth state rides a localStorage blob, never the URL: Entu appends the JWT right after `key=`.

const NONCE_KEY = 'mvox.oauth_nonce';

export const OAUTH_STATE_KEY = 'mvox.oauth_state';

export interface OAuthState {
	nonce: string;
	return_to: string;
	intent: 'login' | 'reauth' | 'invite' | 'link';
	provider: string;
	// invite and link only (#31, #193): the bearer token rides this blob, never the round trip.
	invite?: { db: string; token: string };
	// link only: replayed as expectedEntityId, so the account binds to no one else.
	linkPersonId?: string;
	// link only (#219, #1030): own accounts; the callback compares provider+string, nothing more.
	linkedSnapshot?: Array<{ _id: string; provider: string; string: string }>;
}

export function createNonce(): string {
	return crypto.randomUUID();
}

export function encodeState(payload: OAuthState): string {
	// UTF-8 first: btoa throws on non-Latin1, e.g. a Cyrillic email or passkey name.
	const bytes = new TextEncoder().encode(JSON.stringify(payload));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(encoded: string): OAuthState {
	const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	return JSON.parse(new TextDecoder().decode(bytes)) as OAuthState;
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
