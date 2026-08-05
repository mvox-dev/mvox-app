// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearAll,
	getLastProvider,
	getToken,
	getUser,
	setLastProvider,
	setToken,
	setUser
} from './storage';

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

describe('auth storage', () => {
	it('round-trips the token and stamps the token version', () => {
		setToken('jwt-abc');
		expect(getToken()).toBe('jwt-abc');
		expect(localStorage.getItem('mvox.token_version')).toBe('1');
	});

	it('round-trips the user', () => {
		setUser({ _id: 'u1', email: 'a@b.c' });
		expect(getUser()).toEqual({ _id: 'u1', email: 'a@b.c' });
	});

	it('round-trips last provider independently of the token version', () => {
		setLastProvider('google');
		expect(getLastProvider()).toBe('google');
	});

	it('wipes auth state when the token version is stale', () => {
		setToken('jwt-abc');
		setUser({ _id: 'u1' });
		localStorage.setItem('mvox.token_version', '0'); // simulate an old version
		expect(getToken()).toBeNull();
		expect(getUser()).toBeNull();
	});

	it('clearAll drops token + user; preserveProvider controls the provider', () => {
		setToken('jwt-abc');
		setUser({ _id: 'u1' });
		setLastProvider('google');

		clearAll({ preserveProvider: true });
		expect(getToken()).toBeNull();
		expect(getUser()).toBeNull();
		expect(getLastProvider()).toBe('google');

		setToken('jwt-def');
		setLastProvider('apple');
		clearAll({ preserveProvider: false });
		expect(getLastProvider()).toBeNull();
	});
});
