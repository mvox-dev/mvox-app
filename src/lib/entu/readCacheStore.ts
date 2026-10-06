// The read cache's IndexedDB store: connection, entries, and the byte budget.

import { compositeKey, reqToPromise } from '$lib/files/idb';

export const READ_CACHE_DB_NAME = 'mvox-read-cache';
// A version bump drops and recreates both stores; no version has shipped real data.
const DB_VERSION = 3;
const STORE_NAME = 'reads';
// [readAt, bytes]: the budget pass finds the oldest entries and their sizes from keys alone.
const READ_AT_BYTES_INDEX = 'readAtBytes';
// The running byte total, updated in the same transaction as every put and evict.
const META_STORE_NAME = 'meta';
const META_TOTAL_KEY = 'totalBytes';
// An older tab can leave our open() blocked forever; a timeout makes it "cache unavailable".
export const READ_CACHE_OPEN_TIMEOUT_MS = 1500;

// UTF-8 bytes of stored JSON across every person and db: it protects the shared origin quota.
export const READ_CACHE_MAX_BYTES = 32 * 1024 * 1024;

// One body over this many bytes is not stored, so it cannot evict a whole screen's reads.
export const READ_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;

export interface ReadCacheEntry {
	body: unknown;
	readAt: string;
	bytes: number;
}

const textEncoder = new TextEncoder();

export function encodedByteLength(text: string): number {
	return textEncoder.encode(text).length;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const req = factory.open(READ_CACHE_DB_NAME, DB_VERSION);
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(new Error('readCache: open() blocked by another connection (timed out)'));
		}, READ_CACHE_OPEN_TIMEOUT_MS);
		req.onupgradeneeded = () => {
			const database = req.result;
			if (database.objectStoreNames.contains(STORE_NAME)) database.deleteObjectStore(STORE_NAME);
			const store = database.createObjectStore(STORE_NAME);
			store.createIndex(READ_AT_BYTES_INDEX, ['readAt', 'bytes']);
			if (database.objectStoreNames.contains(META_STORE_NAME)) {
				database.deleteObjectStore(META_STORE_NAME);
			}
			database.createObjectStore(META_STORE_NAME);
		};
		req.onsuccess = () => {
			const database = req.result;
			if (settled) {
				// The timeout already rejected this open; nothing will read from it.
				database.close();
				return;
			}
			settled = true;
			clearTimeout(timer);
			// An upgrade in another tab cannot start while our connection stays open.
			database.onversionchange = () => {
				database.close();
				dbPromise = null;
			};
			resolve(database);
		};
		req.onerror = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(req.error);
		};
	});
}

// undefined = resolve globalThis.indexedDB lazily (node scripts have none); null = disabled.
let explicitFactory: IDBFactory | null | undefined;
let dbPromise: Promise<IDBDatabase> | null = null;

// Bumped on every factory swap: a read that started against the old database serves nothing.
let factoryGeneration = 0;

export function currentFactoryGeneration(): number {
	return factoryGeneration;
}

export function setReadCacheFactory(factory?: IDBFactory | null): void {
	explicitFactory = factory;
	dbPromise = null;
	factoryGeneration += 1;
}

function resolveFactory(): IDBFactory | null {
	if (explicitFactory === null) return null;
	if (explicitFactory) return explicitFactory;
	const globalIdb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
	return globalIdb ?? null;
}

function getDb(): Promise<IDBDatabase> | null {
	const factory = resolveFactory();
	if (!factory) return null;
	if (!dbPromise) {
		try {
			dbPromise = openDb(factory).catch((err) => {
				dbPromise = null;
				throw err;
			});
		} catch (err) {
			dbPromise = null;
			return Promise.reject(err);
		}
	}
	return dbPromise;
}

export async function readCacheGet(
	db: string,
	personId: string,
	pathAndQuery: string
): Promise<ReadCacheEntry | undefined> {
	if (!personId) return undefined;
	const generation = factoryGeneration;
	const openPromise = getDb();
	if (!openPromise) return undefined;
	try {
		const database = await openPromise;
		const tx = database.transaction(STORE_NAME, 'readonly');
		const req = tx.objectStore(STORE_NAME).get(compositeKey(db, personId, pathAndQuery));
		const entry = (await reqToPromise(req)) as ReadCacheEntry | undefined;
		return generation === factoryGeneration ? entry : undefined;
	} catch {
		// The cache is never a gate: a failed store read is a miss, and the network answers.
		return undefined;
	}
}

export async function readCacheEntryCount(): Promise<number> {
	const openPromise = getDb();
	if (!openPromise) return 0;
	try {
		const database = await openPromise;
		const tx = database.transaction(STORE_NAME, 'readonly');
		return await reqToPromise(tx.objectStore(STORE_NAME).count());
	} catch {
		// A count the store cannot give is zero entries held, as far as this device can tell.
		return 0;
	}
}

function sizesOldestFirst(store: IDBObjectStore): Promise<{ key: IDBValidKey; bytes: number }[]> {
	return new Promise((resolve, reject) => {
		const out: { key: IDBValidKey; bytes: number }[] = [];
		const cursorReq = store.index(READ_AT_BYTES_INDEX).openKeyCursor();
		cursorReq.onsuccess = () => {
			const cursor = cursorReq.result;
			if (!cursor) {
				resolve(out);
				return;
			}
			const [, bytes] = cursor.key as [string, number];
			out.push({ key: cursor.primaryKey, bytes });
			cursor.continue();
		};
		cursorReq.onerror = () => reject(cursorReq.error);
	});
}

// A put under the budget opens no cursor at all; only one that crosses it walks for victims.
async function evictOverBudget(store: IDBObjectStore, total: number): Promise<number> {
	if (total <= READ_CACHE_MAX_BYTES) return total;
	const sizes = await sizesOldestFirst(store);
	let remaining = total;
	for (const { key, bytes } of sizes) {
		if (remaining <= READ_CACHE_MAX_BYTES) break;
		store.delete(key);
		remaining -= bytes;
	}
	return remaining;
}

export async function readCacheTotalBytes(): Promise<number> {
	const openPromise = getDb();
	if (!openPromise) return 0;
	try {
		const database = await openPromise;
		const tx = database.transaction(META_STORE_NAME, 'readonly');
		const total = (await reqToPromise(tx.objectStore(META_STORE_NAME).get(META_TOTAL_KEY))) as
			| number
			| undefined;
		return total ?? 0;
	} catch {
		// Same as the count: an unreadable total is nothing held.
		return 0;
	}
}

// One transaction over both stores, so an overwrite never double-counts the running total.
export async function readCachePut(
	db: string,
	personId: string,
	pathAndQuery: string,
	entry: ReadCacheEntry
): Promise<void> {
	const openPromise = getDb();
	if (!openPromise) return;
	const database = await openPromise;
	const tx = database.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
	const store = tx.objectStore(STORE_NAME);
	const meta = tx.objectStore(META_STORE_NAME);
	const key = compositeKey(db, personId, pathAndQuery);

	const existing = (await reqToPromise(store.get(key))) as ReadCacheEntry | undefined;
	const storedTotal = (await reqToPromise(meta.get(META_TOTAL_KEY))) as number | undefined;

	await reqToPromise(store.put(entry, key));

	const total = (storedTotal ?? 0) - (existing?.bytes ?? 0) + entry.bytes;
	const finalTotal = await evictOverBudget(store, total);

	await reqToPromise(meta.put(finalTotal, META_TOTAL_KEY));
}

// (*MVOX:Josquin*)
