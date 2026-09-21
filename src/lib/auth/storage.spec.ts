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
	const A = { db: 'sampledb', personId: 'person-a' };
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

// #442 RED — canPersistLocally(): a proactive write/read-back/remove probe the
// login screen runs on mount. CONTRACT (for the GREEN implementer):
//   - one exported function `canPersistLocally(): boolean` in THIS file (the
//     single source of truth for auth storage; Path C gate);
//   - one KEYS entry `storageProbe: 'mvox.storage_probe'` — the ONLY key the
//     probe may touch; token/user keys stay untouched;
//   - write a fixed value under the probe key, read it back, compare, remove
//     the key; ANY throw or read-back mismatch → false; nothing survives.
import { canPersistLocally } from './storage';
import { afterEach, vi } from 'vitest';

const PROBE_KEY = 'mvox.storage_probe';

describe('#442 — canPersistLocally() storage self-test', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns true on working storage and leaves no key behind', () => {
		localStorage.setItem('unrelated', 'stays');
		const lengthBefore = localStorage.length;

		expect(canPersistLocally()).toBe(true);

		expect(localStorage.length, 'probe must clean up after itself').toBe(lengthBefore);
		expect(localStorage.getItem(PROBE_KEY), 'probe key must not survive').toBeNull();
		expect(localStorage.getItem('unrelated')).toBe('stays');
	});

	it('returns false when setItem throws (quota exceeded / storage refused)', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('quota exceeded', 'QuotaExceededError');
		});

		expect(canPersistLocally()).toBe(false);
	});

	it('returns false when getItem throws (access denied)', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('access denied', 'SecurityError');
		});

		expect(canPersistLocally()).toBe(false);
	});

	it('returns false when the read-back does not match what was written', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => 'tampered-value');

		expect(canPersistLocally()).toBe(false);
	});

	it('never touches the token/user keys — the probe key is the ONLY key written or removed', () => {
		const setSpy = vi.spyOn(Storage.prototype, 'setItem');
		const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');

		expect(canPersistLocally()).toBe(true);

		const setKeys = setSpy.mock.calls.map(([key]) => key);
		const removedKeys = removeSpy.mock.calls.map(([key]) => key);
		expect(setKeys.length).toBeGreaterThan(0);
		expect([...new Set(setKeys)]).toEqual([PROBE_KEY]);
		expect([...new Set(removedKeys)]).toEqual([PROBE_KEY]);
	});
});
