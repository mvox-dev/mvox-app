// localStorage helpers — single source of truth for mvox auth key names.
//
// Client-side SPA (no BFF): the Entu JWT lives in localStorage, not an httpOnly
// cookie. We persist the token, the user (for OAuth login_hint), last provider,
// and a token-version sentinel for cache-busting on breaking token changes.
//
// NOTE (T3): the old repo also stored an `accounts` array here. Dropped — the JWT
// already carries the `accounts` map (person-id per db) in its claims, and T4
// (db-selection-from-token) decodes it straight off the token. A second copy in
// localStorage would just be a staleness hazard.

import { OAUTH_STATE_KEY } from './state';

const KEYS = {
	token: 'token',
	user: 'user',
	lastProvider: 'mvox.last_provider',
	tokenVersion: 'mvox.token_version',
	storageProbe: 'mvox.storage_probe',
} as const;

const STORAGE_PROBE_VALUE = 'ok';

const CURRENT_TOKEN_VERSION = '1';

// Token-version cache-busting invariant: only `setToken` writes
// `mvox.token_version`. Callers MUST sequence setUser BEFORE setToken; setToken is
// the gate that publishes new auth state with the current version. Writing user
// AFTER setToken across a version bump leaves it stale (subsequent get* calls see a
// fresh version sentinel and skip the wipe).

export interface EntuUser {
	_id: string;
	email?: string;
	name?: string;
	[key: string]: unknown;
}

// #442 review F1 — a browser told not to store site data (Chrome/Edge "Don't
// allow sites to save data", Safari "Block all cookies") makes `localStorage`
// itself a THROWING ACCESSOR: the property read throws SecurityError before any
// method is called, so `typeof localStorage !== 'undefined'` does not shield a
// caller (typeof only suppresses ReferenceError for unresolvable bindings).
// Every READ here goes through these helpers so that browser degrades to "no
// stored auth" — which is the truth — instead of throwing out of the root
// layout's `load` and the login page's init, i.e. out of the very screen that
// exists to tell the user about it.
//
// WRITES deliberately still throw: run-callback-exchange.ts and
// auth/[provider]/+page.svelte catch them to fail closed (`persist_failed`)
// rather than hand the user a session that was never persisted. Swallowing
// there would trade a clear error for a silent logged-out loop.
function readKey(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function removeKey(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Storage is refusing: nothing was ever written, so there is nothing to drop.
	}
}

function isStaleVersion(): boolean {
	const stored = readKey(KEYS.tokenVersion);
	return stored !== null && stored !== CURRENT_TOKEN_VERSION;
}

export function getToken(): string | null {
	if (isStaleVersion()) {
		clearAll({ preserveProvider: false });
		return null;
	}
	return readKey(KEYS.token);
}

export function setToken(token: string): void {
	localStorage.setItem(KEYS.token, token);
	localStorage.setItem(KEYS.tokenVersion, CURRENT_TOKEN_VERSION);
}

export function getUser(): EntuUser | null {
	if (isStaleVersion()) {
		clearAll({ preserveProvider: false });
		return null;
	}
	const raw = readKey(KEYS.user);
	return raw ? (JSON.parse(raw) as EntuUser) : null;
}

export function setUser(user: EntuUser): void {
	localStorage.setItem(KEYS.user, JSON.stringify(user));
}

export function getLastProvider(): string | null {
	return readKey(KEYS.lastProvider);
}

export function setLastProvider(provider: string): void {
	localStorage.setItem(KEYS.lastProvider, provider);
}

// #442 — proactive self-test the login screen runs on mount. Writes a fixed
// value under a throwaway probe key (never token/user), reads it back, and
// removes it. Any throw (quota refused, access denied) or read-back mismatch
// means the browser won't persist for us → false. Nothing survives either way:
// the removal sits in `finally`, so a write that succeeded is still dropped when
// the read-back or the removal itself throws (#442 review F2).
export function canPersistLocally(): boolean {
	try {
		localStorage.setItem(KEYS.storageProbe, STORAGE_PROBE_VALUE);
		return localStorage.getItem(KEYS.storageProbe) === STORAGE_PROBE_VALUE;
	} catch {
		return false;
	} finally {
		removeKey(KEYS.storageProbe);
	}
}

export function clearAll(opts: { preserveProvider: boolean }): void {
	removeKey(KEYS.token);
	removeKey(KEYS.user);
	removeKey(KEYS.tokenVersion);
	// Drop any in-flight OAuth-state blob too — otherwise a stale blob survives
	// logout and the callback's presence-check would key off it (single-use gate).
	removeKey(OAUTH_STATE_KEY);
	if (!opts.preserveProvider) {
		removeKey(KEYS.lastProvider);
	}
	try {
		sessionStorage.clear();
	} catch {
		// Same refusing-browser case as removeKey: nothing was stored to clear.
	}
}

// (*MVOX:Josquin*)
