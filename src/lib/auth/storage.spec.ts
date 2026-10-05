// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createByteStore, type ByteStore } from '$lib/files/byteStore';
import { createFakeAdapter } from '$lib/testing/byteStoreFakes';

const appBytes = vi.hoisted(() => ({ store: null as ByteStore | null }));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => appBytes.store }));

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

// The byte store survives both exit paths; on expiry a wipe would empty the offline cache by a
// routine event, and re-login as the same (db, personId) must find the bytes again.
describe('#343 — auth teardown RETAINS the byte store', () => {
	const A = { db: 'sampledb', personId: 'person-a' };
	const pdf = () => ({
		bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
		filetype: 'application/pdf',
		sha256: 'sha-1'
	});

	it('clearAll (logout AND expiry variants) leaves stored bytes retrievable under the same identity', async () => {
		const store = (appBytes.store = createByteStore(createFakeAdapter()));
		await store.put(A, 'file-1', pdf());
		setToken('jwt-abc');

		clearAll({ preserveProvider: true }); // the expiry path's storage half
		expect(await store.get(A, 'file-1')).toBeDefined();

		setToken('jwt-def');
		clearAll({ preserveProvider: false }); // the explicit-logout path
		expect(await store.get(A, 'file-1')).toBeDefined();
	});

	it('endSession — the single teardown BOTH exit paths share — leaves stored bytes retrievable', async () => {
		const store = (appBytes.store = createByteStore(createFakeAdapter()));
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

	it('neither exit path clears a partition, wipes the device store or touches IndexedDB', () => {
		const store = (appBytes.store = createByteStore(createFakeAdapter()));
		const clearPartition = vi.spyOn(store, 'clearPartition');
		const clearAllPartitions = vi.spyOn(store, 'clearAllPartitions');
		const idb = { open: vi.fn(), deleteDatabase: vi.fn() };
		vi.stubGlobal('indexedDB', idb);
		try {
			setToken('jwt-abc');
			endSession({ preserveProvider: true });
			setToken('jwt-def');
			endSession({ preserveProvider: false });
			clearAll({ preserveProvider: false });
		} finally {
			vi.unstubAllGlobals();
		}

		expect(clearPartition).not.toHaveBeenCalled();
		expect(clearAllPartitions).not.toHaveBeenCalled();
		expect(idb.open).not.toHaveBeenCalled();
		expect(idb.deleteDatabase).not.toHaveBeenCalled();
	});
});

// canPersistLocally(): a write/read-back/remove probe under its own key, run by the login screen.
import { canPersistLocally } from './storage';

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
		// One-shot override: happy-dom's Storage proxy defeats restoreAllMocks, so a permanent spy leaks.
		vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
			throw new DOMException('quota exceeded', 'QuotaExceededError');
		});

		expect(canPersistLocally()).toBe(false);
	});

	it('returns false when getItem throws (access denied)', () => {
		vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => {
			throw new DOMException('access denied', 'SecurityError');
		});

		expect(canPersistLocally()).toBe(false);
	});

	it('returns false when the read-back does not match what was written', () => {
		vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => 'tampered-value');

		expect(canPersistLocally()).toBe(false);
	});

	it('never touches the token/user keys — the probe key is the ONLY key written or removed', () => {
		const setSpy = vi.spyOn(localStorage, 'setItem');
		const removeSpy = vi.spyOn(localStorage, 'removeItem');

		expect(canPersistLocally()).toBe(true);

		const setKeys = setSpy.mock.calls.map(([key]) => key);
		const removedKeys = removeSpy.mock.calls.map(([key]) => key);
		expect(setKeys.length).toBeGreaterThan(0);
		expect([...new Set(setKeys)]).toEqual([PROBE_KEY]);
		expect([...new Set(removedKeys)]).toEqual([PROBE_KEY]);
	});
});

// A browser that blocks site data: every read path degrades to "nothing stored", never a throw
// out of the root layout's load or the login page init.
import { withBlockedStorage } from '$lib/testing/blockedStorage';

describe('#442 review F1 — storage access itself throws (site data blocked)', () => {
	it('every reader degrades to null instead of throwing', () => {
		setToken('jwt-abc');
		setUser({ _id: 'u1' });
		setLastProvider('google');

		withBlockedStorage(() => {
			expect(getToken()).toBeNull();
			expect(getUser()).toBeNull();
			expect(getLastProvider()).toBeNull();
		});
	});

	it('canPersistLocally() reports false', () => {
		withBlockedStorage(() => {
			expect(canPersistLocally()).toBe(false);
		});
	});

	it('clearAll does not throw', () => {
		withBlockedStorage(() => {
			expect(() => clearAll({ preserveProvider: false })).not.toThrow();
			expect(() => clearAll({ preserveProvider: true })).not.toThrow();
		});
	});

	it('writers still throw — the OAuth callback fails closed on persist_failed', () => {
		withBlockedStorage(() => {
			expect(() => setToken('jwt-abc')).toThrow();
		});
	});
});

// #442 review F2 — "nothing survives either way" must hold on EVERY path, not
// just the happy one: a setItem that succeeded before a throwing getItem used to
// leave `mvox.storage_probe` behind.
describe('#442 review F2 — the probe key never survives', () => {
	it('cleans up when getItem throws after a successful write', () => {
		vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => {
			throw new DOMException('access denied', 'SecurityError');
		});

		expect(canPersistLocally()).toBe(false);
		expect(localStorage.getItem(PROBE_KEY), 'probe key must not survive').toBeNull();
	});

	it('cleans up when the read-back is tampered with', () => {
		vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => 'tampered-value');

		expect(canPersistLocally()).toBe(false);
		expect(localStorage.getItem(PROBE_KEY), 'probe key must not survive').toBeNull();
	});

	it('a throwing removeItem cannot escape the probe', () => {
		vi.spyOn(localStorage, 'removeItem').mockImplementationOnce(() => {
			throw new DOMException('access denied', 'SecurityError');
		});

		expect(() => canPersistLocally()).not.toThrow();
	});
});

// (*MVOX:Josquin* — #442 review fixes)
