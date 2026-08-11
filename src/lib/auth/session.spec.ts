// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { authStore, endSession, hydrateAuth } from './session';
import { getLastProvider, getToken, getUser, setLastProvider, setToken, setUser } from './storage';

// Build an unsigned JWT (base64url) with a given payload — mirrors Entu's issued
// token so the decode path is exercised for real.
function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const NOW = 2_000_000_000_000; // ms
const futureExp = 9_999_999_999; // seconds, year ~2286

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	authStore.set({ status: 'loading' });
});

describe('hydrateAuth', () => {
	it('publishes anonymous when no token is present', () => {
		const state = hydrateAuth(NOW);
		expect(state).toEqual({ status: 'anonymous' });
		expect(get(authStore)).toEqual({ status: 'anonymous' });
	});

	it('decodes accounts → personIdByDb and publishes authenticated', () => {
		setToken(jwt({ accounts: { polyphony: 'p1', mvox: 'p2' }, exp: futureExp }));

		const state = hydrateAuth(NOW);

		expect(state).toEqual({
			status: 'authenticated',
			personIdByDb: { polyphony: 'p1', mvox: 'p2' },
			expMs: futureExp * 1000
		});
		expect(get(authStore)).toEqual(state);
	});

	it('tolerates a token with no accounts claim (empty map)', () => {
		setToken(jwt({ exp: futureExp }));
		const state = hydrateAuth(NOW);
		expect(state).toEqual({ status: 'authenticated', personIdByDb: {}, expMs: futureExp * 1000 });
	});

	it('fails closed on an EXPIRED token: clears storage, anonymous', () => {
		setToken(jwt({ accounts: { polyphony: 'p1' }, exp: 1 })); // long past
		const state = hydrateAuth(NOW);
		expect(state).toEqual({ status: 'anonymous' });
		expect(getToken()).toBeNull(); // storage wiped
	});

	it('fails closed on a MALFORMED token: clears storage, anonymous', () => {
		setToken('not-a-jwt');
		const state = hydrateAuth(NOW);
		expect(state).toEqual({ status: 'anonymous' });
		expect(getToken()).toBeNull();
	});
});

// #107 review F1 — the ONE teardown both exit paths share. Before it existed,
// the 401 recovery cleared localStorage but left `authStore` asserting
// 'authenticated' (the client-side `goto` never reloads the document, so
// nothing re-hydrates it): the signed-in nav kept rendering on the sign-in
// page, and the layout's auth-keyed effects kept firing Entu reads with an
// empty Bearer.
describe('endSession', () => {
	it('clears storage AND flips the in-memory store to anonymous', () => {
		setUser({ _id: 'u1', email: 'ada@example.com' });
		setToken(jwt({ accounts: { polyphony: 'p1' }, exp: futureExp }));
		setLastProvider('google');
		hydrateAuth(NOW);
		expect(get(authStore).status).toBe('authenticated');

		endSession({ preserveProvider: true });

		expect(getToken()).toBeNull();
		expect(getUser()).toBeNull();
		expect(get(authStore)).toEqual({ status: 'anonymous' });
		// preserveProvider: true is the 401-recovery choice — re-auth pre-selects it.
		expect(getLastProvider()).toBe('google');
	});

	it('drops the remembered provider when preserveProvider is false (explicit sign-out)', () => {
		setToken(jwt({ accounts: { polyphony: 'p1' }, exp: futureExp }));
		setLastProvider('google');

		endSession({ preserveProvider: false });

		expect(get(authStore)).toEqual({ status: 'anonymous' });
		expect(getLastProvider()).toBeNull();
	});
});
