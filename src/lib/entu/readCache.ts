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
// OPT IN, NEVER BLANKET (#434 review round 1, findings 1 and 2). A caller
// reaches this module only by asking for it: `entuFetch(db, path, token, init,
// fetchImpl, { cache: true })`. Every one of the ~290 other call sites keeps
// the exact pre-slice promise chain and no cache at all. The first cut wrapped
// EVERY GET, which is wrong in two ways — and an exclusion list of the paths
// that must not be cached is not the fix: swPolicy.ts's own fence is
// deliberately structural, "not as a per-endpoint blacklist, so it cannot erode
// one route at a time later", and the same reasoning holds here:
//   - Some GET bodies must never be reused. `GET property/{id}` answers a
//     signed S3 url that entu-www `src/api/files/index.md` calls "valid for 60
//     seconds. Do not cache or share it; generate a fresh one each time."
//     Served from cache, `signFileUrl` stops failing offline and
//     `openFileBytes` hands the tab a long-expired url — an open that RESOLVES
//     onto S3's AccessDenied XML instead of failing where the caller can say
//     so (#343 review round 3, finding 2).
//   - Some GETs are a STEP INSIDE a write. replaceProperty.ts,
//     linkActions.ts and eventSeriesActions.ts read a property's current
//     `_id`s and then POST/DELETE against them; a cache-served lookup on a
//     flapping connection feeds stale `_id`s into a live mutation. "Caches
//     reads only, never a write" is about the whole choreography, not just
//     which HTTP verb carries the body.
// So the three read SCREENS of #434 (agenda, event page, library — slices
// 2-4) turn the flag on in their own readers, and nothing else is ever
// silently offline-backed. Slice 1 turns it on NOWHERE (#434 review round 2,
// finding 2): a reader gets the flag in the same slice that ships its screen's
// "as of <time>" line, because the issue's Done-when pairs the two ("readable
// offline ... with 'as of <time>' on every such screen"). A flag on a reader
// whose screen has no age line yet is a stored copy painted as if it were
// live — so when a screen loads several readers in one Promise.all, they all
// stay uncached until that screen renders the age.
//
// BOUNDED (#434 review round 1, finding 3). This database shares the origin's
// storage quota with #343's part byte store, which caps itself at 200MB — an
// unbounded read cache could push the origin to quota and cost the downloaded
// parts this epic exists to protect. Two limits, both here and nowhere else:
// at most READ_CACHE_MAX_ENTRIES entries (a put over the cap evicts
// oldest-readAt first, i.e. least-recently-read-online), and a single body
// over READ_CACHE_MAX_ENTRY_BYTES is not stored at all. Worst case is the
// product of the two, and that number is the point — see the constants.
// Age is NOT a limit: the issue's own answer to a stale copy is "as of
// <time>" on the screen, so an old entry is shown with its age, not dropped.
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
// Ordered index over `readAt` — how the cap pass finds the oldest entries
// without reading a single body (`openKeyCursor` yields keys only).
const READ_AT_INDEX = 'readAt';

/**
 * #434 review round 1, finding 3 — the entry cap. Generous against what the
 * three offline screens read (an agenda load, an event page and the library
 * list are a few dozen distinct paths per person, per db), tight enough that
 * the worst case stays a fraction of the byte store's own 200MB: 64 entries x
 * 1MB = 64MB, and real bodies are kilobytes. A put that takes the store over
 * the cap evicts oldest-`readAt` first.
 */
export const READ_CACHE_MAX_ENTRIES = 64;

/**
 * #434 review round 1, finding 3 — the per-entry ceiling, in BYTES of the
 * UTF-8 encoded JSON text (#434 review round 2, finding 3: the name says bytes
 * and the worst case above is arithmetic in bytes, so the measurement is bytes
 * too — `text.length` counts UTF-16 code units, which for non-ASCII names
 * undercounts what the entry actually costs the origin quota).
 * A body this large is not one of the three read screens
 * (the library's 500-work list is ~100KB), and one of them must not be able to
 * spend the whole cache budget by itself. Over the ceiling the read is simply
 * not cached — the live response is returned untouched, and that path is then
 * not available offline.
 */
export const READ_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;

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

// One encoder for the module — `encode` allocates, `new TextEncoder()` per read
// need not.
const textEncoder = new TextEncoder();

/** UTF-8 byte length of a string — what `READ_CACHE_MAX_ENTRY_BYTES` is spent in. */
function encodedByteLength(text: string): number {
	return textEncoder.encode(text).length;
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
			const store = database.objectStoreNames.contains(STORE_NAME)
				? req.transaction?.objectStore(STORE_NAME)
				: database.createObjectStore(STORE_NAME);
			if (store && !store.indexNames.contains(READ_AT_INDEX)) {
				store.createIndex(READ_AT_INDEX, 'readAt');
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

/**
 * How many entries the cache currently holds (0 when there is no database, or
 * on any failure). The cap's own observable — `READ_CACHE_MAX_ENTRIES` is a
 * promise about this number.
 */
export async function readCacheEntryCount(): Promise<number> {
	const openPromise = getDb();
	if (!openPromise) return 0;
	try {
		const database = await openPromise;
		const tx = database.transaction(STORE_NAME, 'readonly');
		return await reqToPromise(tx.objectStore(STORE_NAME).count());
	} catch {
		return 0;
	}
}

/**
 * The cap pass (#434 review round 1, finding 3), running in the SAME
 * transaction as the put that triggered it: count what the store now holds and,
 * while that is over `READ_CACHE_MAX_ENTRIES`, delete the oldest-`readAt`
 * entries. Keys only — an eviction never reads a body, and never touches a
 * `readAt` either (a cap pass that restamped what it walked past would invent
 * recency it did not observe).
 */
function evictOverflow(store: IDBObjectStore): Promise<void> {
	return reqToPromise(store.count()).then((count) => {
		let over = count - READ_CACHE_MAX_ENTRIES;
		if (over <= 0) return undefined;
		return new Promise<void>((resolve, reject) => {
			const cursorReq = store.index(READ_AT_INDEX).openKeyCursor();
			cursorReq.onsuccess = () => {
				const cursor = cursorReq.result;
				if (!cursor || over <= 0) {
					resolve();
					return;
				}
				store.delete(cursor.primaryKey);
				over -= 1;
				cursor.continue();
			};
			cursorReq.onerror = () => reject(cursorReq.error);
		});
	});
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
	const store = tx.objectStore(STORE_NAME);
	const req = store.put(entry, compositeKey(db, personId, pathAndQuery));
	await reqToPromise(req);
	await evictOverflow(store);
}

// Every write `entuFetch` starts is fire-and-forget on its hot path (the live
// response returns to the caller without waiting on IndexedDB). Specs need a
// deterministic way to know a write has landed — `flushReadCache` awaits every
// write started so far, `pendingWrites` is drained (not just read) so a write
// this flush doesn't know about later still gets its own settle.
//
// SELF-DRAINING (#434 review round 2, finding 1). `flushReadCache` is a spec
// affordance — nothing in `src/` outside the specs calls it — so in production
// this list is never drained from the outside. Append-only it would grow by one
// settled promise per cached read for the whole life of a tab, and slices 2-4
// multiply the call sites. So a tracked write removes ITSELF once it settles:
// the list only ever holds writes still in flight, and a flush still awaits
// everything started before it.
let pendingWrites: Promise<void>[] = [];

function trackWrite(p: Promise<void>): void {
	const tracked: Promise<void> = p
		.catch(() => undefined)
		.finally(() => {
			// Runs a microtask after the `push` below, so `tracked` is already in
			// whichever array it was pushed to. After a `flushReadCache` swap that
			// array is no longer `pendingWrites`, and this filter simply finds
			// nothing to drop — the swapped-out copy is the flush's own to await.
			pendingWrites = pendingWrites.filter((q) => q !== tracked);
		});
	pendingWrites.push(tracked);
}

/**
 * How many cache writes are still in flight — the self-draining rule's own
 * observable (#434 review round 2, finding 1): with no flush at all this
 * returns to 0 on its own once the writes settle.
 */
export function pendingCacheWriteCount(): number {
	return pendingWrites.length;
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
 * The read-through wrapper `entuFetch` calls ONLY for a request whose caller
 * opted in (`{ cache: true }` — see OPT IN, NEVER BLANKET above; an uncached
 * call never reaches this module at all). `attemptFetch`
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
 *   forget) keyed to the CURRENT personId for `db`, unless its JSON text is
 *   over `READ_CACHE_MAX_ENTRY_BYTES`; `onResolved` still runs on
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
						.text()
						.then((text) => {
							// The size check reads the TEXT, not the parsed body: the
							// number the cap is spent in is the response's own size, and
							// an over-ceiling body is then never even parsed. Encoded
							// BYTES, not `text.length`'s UTF-16 code units — the ceiling
							// is a promise about the origin's storage quota, and a
							// Cyrillic or Estonian body costs more bytes than it has
							// characters.
							if (encodedByteLength(text) > READ_CACHE_MAX_ENTRY_BYTES) return undefined;
							const body = JSON.parse(text) as unknown;
							return readCachePut(db, personId, pathAndQuery, { body, readAt });
						})
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
