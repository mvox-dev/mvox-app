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
} as const;

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

function isStaleVersion(): boolean {
	const stored = localStorage.getItem(KEYS.tokenVersion);
	return stored !== null && stored !== CURRENT_TOKEN_VERSION;
}

export function getToken(): string | null {
	if (isStaleVersion()) {
		clearAll({ preserveProvider: false });
		return null;
	}
	return localStorage.getItem(KEYS.token);
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
	const raw = localStorage.getItem(KEYS.user);
	return raw ? (JSON.parse(raw) as EntuUser) : null;
}

export function setUser(user: EntuUser): void {
	localStorage.setItem(KEYS.user, JSON.stringify(user));
}

export function getLastProvider(): string | null {
	return localStorage.getItem(KEYS.lastProvider);
}

export function setLastProvider(provider: string): void {
	localStorage.setItem(KEYS.lastProvider, provider);
}

export function clearAll(opts: { preserveProvider: boolean }): void {
	localStorage.removeItem(KEYS.token);
	localStorage.removeItem(KEYS.user);
	localStorage.removeItem(KEYS.tokenVersion);
	// Drop any in-flight OAuth-state blob too — otherwise a stale blob survives
	// logout and the callback's presence-check would key off it (single-use gate).
	localStorage.removeItem(OAUTH_STATE_KEY);
	if (!opts.preserveProvider) {
		localStorage.removeItem(KEYS.lastProvider);
	}
	sessionStorage.clear();
}

// (*MVOX:Josquin*)
