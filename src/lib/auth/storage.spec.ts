// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { endSession } from './session';
import { createByteStore } from '$lib/files/byteStore';
import { createFakeAdapter } from '$lib/testing/byteStoreFakes';

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

// #343 — RETAIN on logout (Gama ruling 2026-09-12, issue comment
// IC_kwDOTubdKM8AAAABUHDKvg): the byte store survives BOTH exit paths —
// explicit sign-out (preserveProvider: false) and token expiry
// (preserveProvider: true). The deciding case is expiry: the JWT dies on its
// own schedule, and delete-on-teardown would wipe the cache by a routine
// invisible event — the exact rehearsal-with-no-signal scenario the store
// exists for. Re-login as the same (db, personId) finds the bytes under the
// same partition key without redownloading.
describe('#343 — auth teardown RETAINS the byte store', () => {
	const A = { db: 'polyphony', personId: 'person-a' };
	const pdf = () => ({
		bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
		filetype: 'application/pdf',
		sha256: 'sha-1'
	});

	it('clearAll (logout AND expiry variants) leaves stored bytes retrievable under the same identity', async () => {
		const store = createByteStore(createFakeAdapter());
		await store.put(A, 'file-1', pdf());
		setToken('jwt-abc');

		clearAll({ preserveProvider: true }); // the expiry path's storage half
		expect(await store.get(A, 'file-1')).toBeDefined();

		setToken('jwt-def');
		clearAll({ preserveProvider: false }); // the explicit-logout path
		expect(await store.get(A, 'file-1')).toBeDefined();
	});

	it('endSession — the single teardown BOTH exit paths share — leaves stored bytes retrievable', async () => {
		const store = createByteStore(createFakeAdapter());
		await store.put(A, 'file-1', pdf());

		setToken('jwt-abc');
		endSession({ preserveProvider: true }); // 401-recovery (token expiry)
		expect(await store.get(A, 'file-1')).toBeDefined();

		setToken('jwt-def');
		endSession({ preserveProvider: false }); // explicit sign-out
		const rec = await store.get(A, 'file-1');
		expect(rec).toBeDefined();
		expect(new Uint8Array(rec!.bytes)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
	});

	it('STRUCTURAL: neither storage.ts nor session.ts references the byte store or clearPartition — retention holds by construction, and clearPartition is NOT wired to any auth path', () => {
		for (const file of ['./storage.ts', './session.ts']) {
			const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf-8');
			expect(source, file).not.toMatch(/byteStore|appByteStore/i);
			expect(source, file).not.toMatch(/clearPartition/);
			expect(source, file).not.toMatch(/indexedDB/i);
		}
	});
});
