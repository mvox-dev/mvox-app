// #434 slice 1/6 — the read cache core ("Offline, last seen data"). No UI here.
//
// ISSUE LAW: "It caches reads only, never a write."
//
// A read-through cache wrapping `entuFetch`'s GET path, over its OWN IndexedDB
// database `mvox-read-cache` — deliberately NOT #343's `mvox-byte-store` (a
// shared or bumped database there is a cache flush of every downloaded part,
// for a change that has nothing to do with parts).
//
// Key: [db, personId, pathAndQuery]. Value: { body: <parsed JSON>, readAt: ISO
// string }. `personId` is the session's `personIdByDb[db]` (`$lib/auth/session`
// `authStore`) — with no personId, nothing is cached and nothing is served
// (mirrors #343's null-identity rule for the byte store).
//
// Nothing is ever cleared on logout or token expiry (#343's law carries over
// unchanged): this module never calls `endSession`/`clearAll` and is never
// called BY them either.
//
// Reads only: only a GET (default method, or an explicit case-insensitive
// 'GET') is cached or served from cache. Any other method passes straight
// through to the live call, touching this module not at all.
//
// Offline = the underlying fetch call THROWS (a network rejection). A cached
// entry for the same key is then served, with the ORIGINAL error rethrown when
// there is none. A resolved response of any status (401, 500, ...) is not
// "offline" — it is returned exactly as received and never triggers a cache
// serve. (401 also never gets cached: it is filtered out by the plain
// `res.ok` check below, same as any other non-2xx status.)
//
// A cache failure (IndexedDB unavailable, `open()` throws, a transaction
// errors) must never break an online read — every IndexedDB touch in this
// module is wrapped so its own failure degrades to "caching did nothing" and
// nothing more.

import { get, writable, type Readable } from 'svelte/store';
import { authStore } from '$lib/auth/session';

export const READ_CACHE_DB_NAME = 'mvox-read-cache';
const DB_VERSION = 1;
const STORE_NAME = 'reads';

/** What one cache entry holds — nothing more. */
export interface ReadCacheEntry {
	body: unknown;
	readAt: string;
}

// JSON-encoded triple, not a delimited string — same reasoning as
// idbAdapter.ts's compositeKey: none of db/personId/pathAndQuery controls its
// own shape enough to rule out colliding with a chosen separator.
function compositeKey(db: string, personId: string, pathAndQuery: string): string {
	return JSON.stringify([db, personId, pathAndQuery]);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = factory.open(READ_CACHE_DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const database = req.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

// Factory state: `undefined` = resolve `globalThis.indexedDB` LAZILY at first
// use (so this module loads fine with no `indexedDB` global at all — e.g. the
// node migration-script context, where caching is simply off); `null` =
// explicitly disabled; an `IDBFactory` = the test seam. Every call to
// `setReadCacheFactory` drops any memoised open connection, matching
// idbAdapter.ts's per-test isolation.
let explicitFactory: IDBFactory | null | undefined;
let dbPromise: Promise<IDBDatabase> | null = null;

export function setReadCacheFactory(factory?: IDBFactory | null): void {
	explicitFactory = factory;
	dbPromise = null;
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
			// A factory whose `open()` throws SYNCHRONOUSLY (rather than handing
			// back a request that errors) — still just "caching is unavailable".
			dbPromise = null;
			return Promise.reject(err);
		}
	}
	return dbPromise;
}

/** Read one entry. `undefined` on a miss, an absent personId, or any failure. */
export async function readCacheGet(
	db: string,
	personId: string,
	pathAndQuery: string
): Promise<ReadCacheEntry | undefined> {
	if (!personId) return undefined;
	const openPromise = getDb();
	if (!openPromise) return undefined;
	try {
		const database = await openPromise;
		const tx = database.transaction(STORE_NAME, 'readonly');
		const req = tx.objectStore(STORE_NAME).get(compositeKey(db, personId, pathAndQuery));
		return (await reqToPromise(req)) as ReadCacheEntry | undefined;
	} catch {
		return undefined;
	}
}

async function readCachePut(
	db: string,
	personId: string,
	pathAndQuery: string,
	entry: ReadCacheEntry
): Promise<void> {
	const openPromise = getDb();
	if (!openPromise) return;
	const database = await openPromise;
	const tx = database.transaction(STORE_NAME, 'readwrite');
	const req = tx.objectStore(STORE_NAME).put(entry, compositeKey(db, personId, pathAndQuery));
	await reqToPromise(req);
}

// Every write `entuFetch` starts is fire-and-forget on its hot path (the live
// response returns to the caller without waiting on IndexedDB). Specs need a
// deterministic way to know a write has landed — `flushReadCache` awaits every
// write started so far, `pendingWrites` is drained (not just read) so a write
// this flush doesn't know about later still gets its own settle.
let pendingWrites: Promise<void>[] = [];

function trackWrite(p: Promise<void>): void {
	pendingWrites.push(p.catch(() => undefined));
}

/** Resolves once every cache write started up to this call has settled. */
export async function flushReadCache(): Promise<void> {
	const writes = pendingWrites;
	pendingWrites = [];
	await Promise.all(writes);
}

// `servedFromCache` — the OLDEST readAt among entries served since the last
// `resetServedFromCache()`; null once reset, until the next cache serve. ISO
// timestamps compare correctly as plain strings (fixed UTC 'Z' format), so a
// lexicographic min is a chronological min.
const servedFromCacheStore = writable<string | null>(null);
export const servedFromCache: Readable<string | null> = servedFromCacheStore;

export function resetServedFromCache(): void {
	servedFromCacheStore.set(null);
}

function noteServedFromCache(readAt: string): void {
	servedFromCacheStore.update((oldest) => (oldest === null || readAt < oldest ? readAt : oldest));
}

/**
 * The session's personId for `db`, or `undefined` when there is none to key a
 * cache entry by — no store, an anonymous session, or no account on this db.
 * Defensive: some specs mock `$lib/auth/session` WITHOUT an `authStore` export
 * at all (their GETs must still succeed; they just get no caching).
 */
function currentPersonId(db: string): string | undefined {
	try {
		const state = get(authStore);
		if (!state || state.status !== 'authenticated') return undefined;
		return state.personIdByDb[db];
	} catch {
		return undefined;
	}
}

function isGetMethod(init: RequestInit): boolean {
	return (init.method ?? 'GET').toUpperCase() === 'GET';
}

/**
 * The read-through wrapper `entuFetch` calls for every request. `attemptFetch`
 * is the live network call (already carrying auth headers); this function
 * decides nothing about the RESPONSE beyond store-or-not — 401 handling is
 * request.ts's own concern, folded in here as `onResolved` so the whole thing
 * composes into ONE `.then()`/`.catch()` stage over `attemptFetch()` — the
 * exact same promise-chain SHAPE `entuFetch` had before this slice. Two
 * stacked `.then()`s (a cache stage, then a separate 401-check stage) would
 * add a microtask tick `entuFetch`'s callers never asked for and do not
 * expect — a real, observed regression against a pre-existing, tick-counting
 * spec (`page.rsvp-rights-gate.spec.ts`) that this slice must not disturb.
 *
 * - Not a GET: passes `attemptFetch()`'s settlement straight to `onResolved`
 *   (rejections are NOT this function's to interpret for a write) — no read,
 *   no write.
 * - GET, live call resolves: an `ok` body is cloned and stored (fire-and-
 *   forget) keyed to the CURRENT personId for `db`; `onResolved` still runs on
 *   the ORIGINAL response. A non-`ok` response (401, 500, ...) is passed to
 *   `onResolved` as-is and never stored.
 * - GET, live call REJECTS (offline): the cached entry for this exact key is
 *   served (via `onResolved`, as a synthesized 200 JSON response) and
 *   `servedFromCache` notes its readAt. With no cached entry, the ORIGINAL
 *   rejection propagates — `onResolved` never sees it.
 */
export function readThroughGet(
	db: string,
	pathAndQuery: string,
	init: RequestInit,
	attemptFetch: () => Promise<Response>,
	onResolved: (res: Response) => Response
): Promise<Response> {
	if (!isGetMethod(init)) return attemptFetch().then(onResolved);

	const personId = currentPersonId(db);

	return attemptFetch().then(
		(res) => {
			if (res.ok && personId) {
				const readAt = new Date().toISOString();
				const clone = res.clone();
				trackWrite(
					clone
						.json()
						.then((body) => readCachePut(db, personId, pathAndQuery, { body, readAt }))
						.catch(() => undefined)
				);
			}
			return onResolved(res);
		},
		(err) => {
			if (!personId) throw err;
			return readCacheGet(db, personId, pathAndQuery).then((cached) => {
				if (!cached) throw err;
				noteServedFromCache(cached.readAt);
				return onResolved(
					new Response(JSON.stringify(cached.body), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
				);
			});
		}
	);
}

// (*MVOX:Josquin*)
