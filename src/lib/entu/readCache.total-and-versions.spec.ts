// #434 slice 2/6 RED — two carries from Bentham's slice-1 review (2026-09-28),
// owned here because slice 2 is the first slice whose reader WRITES the cache.
//
// (i) A RUNNING TOTAL, not a re-sum. Slice 1's budget pass walks every
//     entry's [readAt, bytes] index key on EVERY put to total the bytes —
//     O(entries) per read, on every read the agenda fans out. The total is
//     kept instead in a small meta record updated in the SAME transaction as
//     the put (and as any eviction the put triggers), so it can never drift
//     from the entries it describes.
//       New export: readCacheTotalBytes(): Promise<number> — the stored
//       running total (0 with no database, or on any failure).
//     `readCacheEntryCount()` keeps meaning "how many READ entries" — a meta
//     record must not be counted as one (slice 1's budget specs pin exact
//     counts).
//     The oldest-first walk is still how eviction finds its victims — but only
//     when a put actually takes the total over READ_CACHE_MAX_BYTES. A put
//     under the budget opens no cursor at all.
//
// (ii) ANOTHER TAB ON AN OLDER VERSION. Two failure shapes of a real browser:
//     - This tab holds the connection and another tab (a newer deploy) opens a
//       higher version: our connection gets `versionchange` and must CLOSE, or
//       the other tab's upgrade blocks forever.
//     - Another tab (an older deploy) holds a LOWER version open and never
//       closes: our `open()` fires `blocked` and never settles. Offline serving
//       must not hang on it: the open is time-boxed by READ_CACHE_OPEN_TIMEOUT_MS
//       and a timed-out open falls through to the no-cache path — offline, the
//       ORIGINAL network error is rethrown, exactly as with nothing cached.
//       A timed-out open is not memoised: once the other tab lets go, the next
//       read opens normally.
//       New export: READ_CACHE_OPEN_TIMEOUT_MS: number (≤ 2000 — a screen
//       waiting on it is a screen showing nothing).
import { IDBFactory, IDBIndex, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { CACHED_READ, entuFetch } from './request';
import * as readCache from './readCache';
import {
	READ_CACHE_DB_NAME,
	READ_CACHE_MAX_BYTES,
	flushReadCache,
	readCacheEntryCount,
	readCacheGet,
	resetServedFromCache,
	setReadCacheFactory
} from './readCache';
import { authStore } from '$lib/auth/session';

// The two new exports, read off the module namespace so this file compiles
// (and fails on the assertion, not the import) before GREEN adds them.
const mod = readCache as unknown as {
	readCacheTotalBytes?: () => Promise<number>;
	READ_CACHE_OPEN_TIMEOUT_MS?: number;
};

async function totalBytes(): Promise<number> {
	expect(mod.readCacheTotalBytes, 'readCacheTotalBytes export').toBeTypeOf('function');
	return mod.readCacheTotalBytes!();
}

const DB = 'sampledb';
const PERSON = 'person-a';
const TOKEN = 'jwt-abc';

const utf8 = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

function online(body: unknown) {
	return vi.fn().mockImplementation(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		)
	);
}

function offline(err: Error = new TypeError('Failed to fetch')) {
	return vi.fn().mockRejectedValue(err);
}

async function storeOnline(path: string, body: unknown) {
	const res = await entuFetch(DB, path, TOKEN, {}, online(body), CACHED_READ);
	expect(res.ok).toBe(true);
	await flushReadCache();
}

/** Settles with 'timeout' if `p` has not settled within `ms` (real timers). */
function within<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
	return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

let factory: IDBFactory;

beforeEach(() => {
	factory = new IDBFactory();
	setReadCacheFactory(factory);
	resetServedFromCache();
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: Date.now() + 3_600_000
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	setReadCacheFactory(undefined);
	resetServedFromCache();
	authStore.set({ status: 'anonymous' });
});

describe('(i) the byte total is a running total, exact across put and evict', () => {
	it('after puts of different sizes, the total is exactly the sum of the stored entries', async () => {
		const bodies = [
			{ _id: 'a', name: [{ string: 'Bogoróditse Djévo' }] },
			{ _id: 'b', pad: 'x'.repeat(5_000) },
			{ _id: 'c', name: [{ string: 'Ніч яка місячна' }] }
		];
		for (const [i, body] of bodies.entries()) await storeOnline(`entity/${i}`, body);

		expect(await totalBytes()).toBe(bodies.reduce((sum, b) => sum + utf8(b), 0));
	});

	it('overwriting a key replaces its bytes in the total — the old size is subtracted, not kept', async () => {
		await storeOnline('entity/x', { _id: 'x', pad: 'x'.repeat(10_000) });
		await storeOnline('entity/y', { _id: 'y' });
		const smaller = { _id: 'x', pad: 'x'.repeat(100) };
		await storeOnline('entity/x', smaller);

		expect(await totalBytes()).toBe(utf8(smaller) + utf8({ _id: 'y' }));
		expect(await readCacheEntryCount()).toBe(2);
	});

	it('over the budget, eviction takes the evicted bytes out of the total: total === sum of the survivors', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		const big = (i: number) => ({ _id: `e${String(i).padStart(3, '0')}`, pad: 'x'.repeat(900_000) });
		const fits = Math.floor(READ_CACHE_MAX_BYTES / utf8(big(0)));
		const puts = fits + 3;
		for (let i = 0; i < puts; i += 1) {
			vi.setSystemTime(new Date(base + i * 60_000));
			await storeOnline(`entity/e${i}`, big(i));
		}

		let survivors = 0;
		for (let i = 0; i < puts; i += 1) {
			const entry = await readCacheGet(DB, PERSON, `entity/e${i}`);
			if (entry) survivors += entry.bytes;
		}
		const total = await totalBytes();
		expect(total).toBe(survivors);
		expect(total).toBeLessThanOrEqual(READ_CACHE_MAX_BYTES);
		expect(await readCacheEntryCount()).toBe(fits);
	});

	it('the total survives a re-open of the database (a new app load)', async () => {
		await storeOnline('entity/1', { _id: '1', pad: 'x'.repeat(2_000) });
		await storeOnline('entity/2', { _id: '2' });
		const before = await totalBytes();

		setReadCacheFactory(factory); // drops the memoised connection, same database
		expect(await totalBytes()).toBe(before);
		await storeOnline('entity/3', { _id: '3' });
		expect(await totalBytes()).toBe(before + utf8({ _id: '3' }));
	});

	it('a put under the budget opens NO cursor — no per-put walk over every entry', async () => {
		await storeOnline('entity/warm', { _id: 'warm' }); // database open + first put done
		const walks = [
			vi.spyOn(IDBIndex.prototype, 'openKeyCursor'),
			vi.spyOn(IDBIndex.prototype, 'openCursor'),
			vi.spyOn(IDBIndex.prototype, 'getAll'),
			vi.spyOn(IDBIndex.prototype, 'getAllKeys'),
			vi.spyOn(IDBObjectStore.prototype, 'openKeyCursor'),
			vi.spyOn(IDBObjectStore.prototype, 'openCursor'),
			vi.spyOn(IDBObjectStore.prototype, 'getAll'),
			vi.spyOn(IDBObjectStore.prototype, 'getAllKeys')
		];

		await storeOnline('entity/next', { _id: 'next' });

		for (const spy of walks) expect(spy).not.toHaveBeenCalled();
		expect(await readCacheGet(DB, PERSON, 'entity/next')).toBeDefined();
	});
});

describe('(ii) another tab on another database version', () => {
	it('a NEWER version opened elsewhere: our connection closes on versionchange, so their upgrade proceeds', async () => {
		await storeOnline('entity/1', { _id: '1' }); // our connection is open

		const theirOpen = new Promise<IDBDatabase>((resolve, reject) => {
			const req = factory.open(READ_CACHE_DB_NAME, 1000);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const outcome = await within(theirOpen, 2000);
		expect(outcome, 'the other tab\'s upgrade is blocked by our open connection').not.toBe('timeout');
		if (outcome !== 'timeout') outcome.close();
	});

	it('READ_CACHE_OPEN_TIMEOUT_MS is exported and at most 2000ms', () => {
		expect(mod.READ_CACHE_OPEN_TIMEOUT_MS).toBeTypeOf('number');
		expect(mod.READ_CACHE_OPEN_TIMEOUT_MS!).toBeGreaterThan(0);
		expect(mod.READ_CACHE_OPEN_TIMEOUT_MS!).toBeLessThanOrEqual(2000);
	});

	/** Another tab holding version 1 open, never closing on versionchange. */
	function holdOlderVersion(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = factory.open(READ_CACHE_DB_NAME, 1);
			req.onsuccess = () => {
				const db = req.result;
				db.onversionchange = () => {
					/* an older deploy: ignores the request, keeps the connection */
				};
				resolve(db);
			};
			req.onerror = () => reject(req.error);
		});
	}

	it('a BLOCKED open never hangs an offline read: the original error is rethrown within the time box', async () => {
		const holder = await holdOlderVersion();
		const err = new TypeError('Failed to fetch');

		const read = entuFetch(DB, 'entity/1', TOKEN, {}, offline(err), CACHED_READ).then(
			() => 'resolved' as const,
			(e: unknown) => e
		);
		const outcome = await within(read, 3000);
		expect(outcome, 'offline read hung on a blocked open').not.toBe('timeout');
		expect(outcome).toBe(err);
		holder.close();
	});

	it('a BLOCKED open never hangs an online read either — the live body comes back', async () => {
		const holder = await holdOlderVersion();
		const body = { _id: 'live' };

		const read = entuFetch(DB, 'entity/1', TOKEN, {}, online(body), CACHED_READ).then((r) => r.json());
		expect(await within(read, 3000)).toEqual(body);
		holder.close();
	});

	it('a timed-out open is not memoised: once the other tab lets go, reads cache and serve again', async () => {
		const holder = await holdOlderVersion();
		await within(
			entuFetch(DB, 'entity/1', TOKEN, {}, offline(), CACHED_READ).catch(() => undefined),
			3000
		);
		holder.close();

		const body = { _id: 'after' };
		await storeOnline('entity/after', body);
		const res = await within(
			entuFetch(DB, 'entity/after', TOKEN, {}, offline(), CACHED_READ).then((r) => r.json()),
			3000
		);
		expect(res).toEqual(body);
	});
});

// (*MVOX:Tallis*)
