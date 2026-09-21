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

// A browser told not to store site data makes `localStorage` access itself
// throw — mechanism in $lib/testing/blockedStorage. Every READ goes through
// these helpers so it degrades to "no stored auth", which is the truth, rather
// than throwing out of the root layout's `load` and the login page's init (#442).
//
// WRITES deliberately still throw: run-callback-exchange.ts and
// auth/[provider]/+page.svelte catch them to fail closed (`persist_failed`)
// rather than hand the user a session that was never persisted.
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

// Proactive self-test the login screen runs on mount: write a fixed value under
// a throwaway probe key (never token/user), read it back, remove it. Any throw
// or read-back mismatch → false. The removal sits in `finally`, so nothing
// survives even when the read-back or the removal itself throws.
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
