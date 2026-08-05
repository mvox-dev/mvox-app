// OAuth state payload encoding for CSRF protection + return URL preservation.
// The payload is persisted to localStorage at OAuth initiation and read back at
// the callback — it does NOT ride in the URL, because Entu appends the issued JWT
// directly after the `key=` stub in `next` with no separator (see
// build-oauth-init-url.ts). The nonce inside guards against a stray callback with
// no matching initiation.

const NONCE_KEY = 'mvox.oauth_nonce';

export interface OAuthState {
	nonce: string;
	return_to: string;
	intent: 'login' | 'reauth';
	provider: string;
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
