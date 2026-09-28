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
// string, bytes: UTF-8 size of the body's JSON text }. `personId` is the session's `personIdByDb[db]` (`$lib/auth/session`
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
// 2-4) turn the flag on for their own load, and nothing else is ever silently
// offline-backed.
//   AND THE FLAG IS AN ARGUMENT, NEVER A LINE INSIDE A SHARED READER (#434
// slice 2 review round, finding 2). Slice 2's first cut wrote `CACHED_READ`
// into `checkCollectiveMarker`, `resolveDatabaseEntityId` and
// `listSeasons`/`listEvents` — which is a blanket by another route, because a
// reader has callers the screen knows nothing about:
// `resolveDatabaseEntityId` alone has FIFTEEN, eight of them a GET that is a step
// inside a write (season/event/series create, sectionActions, linkActions,
// inviteData each resolve the id and then POST it as `_parent`), and
// `listSeasons` also serves /library, whose own age line is slice 3's. So a
// shared reader takes `opts: EntuFetchOptions = {}` and threads it down; the
// screen's own entry point (`agendaData.loadFullAgenda`) and the app's one
// identity read (`collectives/discover.ts`) are what pass `CACHED_READ`. The
// allowlist of files that may name it at all is pinned in
// readCache.optin-fence.spec.ts.
// Slice 1 turns it on NOWHERE (#434 review round 2,
// finding 2): a reader gets the flag in the same slice that ships its screen's
// "as of <time>" line, because the issue's Done-when pairs the two ("readable
// offline ... with 'as of <time>' on every such screen"). A flag on a reader
// whose screen has no age line yet is a stored copy painted as if it were
// live — so when a screen loads several readers in one Promise.all, they all
// stay uncached until that screen renders the age.
//
// BOUNDED (#434 review round 1, finding 3; review round 3, F1). This database
// shares the origin's storage quota with #343's part byte store, which caps
// itself at 200MB — an unbounded read cache could push the origin to quota and
// cost the downloaded parts this epic exists to protect. The quota is spent in
// BYTES, so the budget is bytes too, and it is the only global limit: the
// stored bodies total at most READ_CACHE_MAX_BYTES (a put that takes the total
// over evicts oldest-readAt first, i.e. least-recently-read-online), and a
// single body over READ_CACHE_MAX_ENTRY_BYTES is not stored at all.
// There is deliberately NO entry-count cap. The three offline screens fan out
// per ENTITY, not per screen — libraryData.ts's resolveCopyChains reads one
// GET per copy and one per edition, resolveBorrowerName one per member plus a
// profiles read, workRows.ts's loadWorksByEventId ~N+4 for N events, and
// agendaData.ts's listFullAgenda one listEvents per season. A library with 25
// lendings is ~90 paths before the agenda adds its own. Each screen awaits its
// reads in one Promise.all, so an evicted key fails the whole screen offline;
// a count cap sized for "a few dozen paths" (the first cut's 64) evicted a
// screen's own earliest reads while it was still loading.
// Age is NOT a limit: the issue's own answer to a stale copy is "as of
// <time>" on the screen, so an old entry is shown with its age, not dropped.
//
// STORING IS NOT SERVING (#434 slice 3 review round, findings 1 and 2). The
// opt-in has THREE modes, not two: `{ cache: 'store' }`
// (CACHED_READ_STORE_ONLY) stores exactly like `{ cache: true }` and skips the
// serve half — offline it rethrows, and it never touches `servedFromCache`.
// `servedFromCache` is ONE store, read by whichever screen is mounted, so any
// read that is NOT what that screen is rendering must use this mode: a
// background warm-up (the agenda's next-event detail prefetch) whose reads
// reject on a flapping connection would otherwise paint an older "as of" over
// agenda rows that all came back live, and a post-write re-read
// (`refreshEventDetail`) that opts out of the cache entirely leaves the stored
// copy behind the write that just landed.
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
// Version 3 (#434 slice 2/6, carried review): version 2 added `bytes`/`readAt`
// (slice 1); version 3 adds the META_STORE_NAME running-total record. Neither
// store is ever migrated forward — a version bump drops and recreates BOTH
// (see openDb's onupgradeneeded) — no version has shipped with real user data
// yet, so there is nothing to preserve.
const DB_VERSION = 3;
const STORE_NAME = 'reads';
// Ordered index over [readAt, bytes] — how the budget pass finds the oldest
// entries AND their sizes without reading a single body (`openKeyCursor`
// yields index keys only).
const READ_AT_BYTES_INDEX = 'readAtBytes';
// #434 slice 2/6 (Bentham, slice-1 review, carry i) — the running byte total,
// one record, updated in the SAME transaction as every put/evict so it can
// never drift from the entries it describes. A meta record is not a read
// entry: `readCacheEntryCount()` still means "how many READ entries" and never
// counts this store at all.
const META_STORE_NAME = 'meta';
const META_TOTAL_KEY = 'totalBytes';
// #434 slice 2/6 (Bentham, slice-1 review, carry ii) — another tab holding an
// OLDER version can leave our own `open()` permanently `blocked` (it never
// rejects on its own); a screen waiting on that would show nothing forever.
// At most 2000ms: a blocked open times out and falls through to "caching is
// unavailable for this read" (online: the live body still comes back; offline:
// the original network error is rethrown, exactly as with nothing cached).
export const READ_CACHE_OPEN_TIMEOUT_MS = 1500;

/**
 * #434 review round 3, F1 — the total budget, in UTF-8 BYTES of the stored
 * bodies' JSON text, across every person and db (it protects the origin quota,
 * which they all share). 32MB is a sixth of #343's 200MB byte store. Real
 * bodies are kilobytes, so the per-entity fan-out of the three offline screens
 * (resolveCopyChains, resolveBorrowerName, loadWorksByEventId, listEvents per
 * season — see BOUNDED above) is thousands of entries under it. A put that
 * takes the total over evicts oldest-`readAt` first until it fits.
 */
export const READ_CACHE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * #434 review round 1, finding 3 — the per-entry ceiling, in BYTES of the
 * UTF-8 encoded JSON text (#434 review round 2, finding 3: `text.length`
 * counts UTF-16 code units, which for non-ASCII names undercounts what the
 * entry actually costs the origin quota). Kept beside READ_CACHE_MAX_BYTES
 * (review round 3): a body this large is not one of the three read screens
 * (the library's 500-work list is ~100KB), and one of them must not be able to
 * evict a whole screen's worth of small reads by itself. Over the ceiling the read is simply
 * not cached — the live response is returned untouched, and that path is then
 * not available offline.
 */
export const READ_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;

/** What one cache entry holds — nothing more. `bytes` is the UTF-8 size of
 * the body's JSON text, what the entry spends of READ_CACHE_MAX_BYTES. */
export interface ReadCacheEntry {
	body: unknown;
	readAt: string;
	bytes: number;
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
		let settled = false;
		const req = factory.open(READ_CACHE_DB_NAME, DB_VERSION);
		// carry ii — the timer is the ONLY thing standing between a `blocked`
		// open and hanging forever: `blocked` alone never fires `onsuccess` or
		// `onerror`, so with no timer an older tab that never closes on
		// `versionchange` would keep this promise pending for the life of the tab.
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
				// The timeout already rejected this open — a later success (the
				// other tab finally let go) belongs to nobody now; close it rather
				// than leak a connection nothing will ever read from.
				database.close();
				return;
			}
			settled = true;
			clearTimeout(timer);
			// carry ii — a NEWER version opened elsewhere (another tab on a newer
			// deploy) fires `versionchange` on every OTHER open connection; an
			// IndexedDB upgrade cannot start while any connection stays open, so
			// closing ours here is what lets their upgrade proceed at all. Also
			// drops the memoised connection so the NEXT read opens fresh.
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
 * on any failure).
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

/** Every [readAt, bytes] index key, oldest first — keys only, no body read. */
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

/**
 * The budget pass (#434 review round 3, F1; slice 2 carry i — now given the
 * total rather than re-summing it), running in the SAME transaction as the put
 * that triggered it: while the total is over `READ_CACHE_MAX_BYTES`, delete the
 * oldest-`readAt` entries. A put that stays under the budget returns
 * immediately — NO cursor is opened at all; the oldest-first walk (index keys
 * only, no body ever read) runs solely to find eviction victims once a put
 * actually crosses the line.
 */
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

/**
 * How many bytes the cache currently holds — the running total (#434 slice
 * 2/6, carry i), read straight off its own meta record rather than re-summed.
 * 0 with no database, or on any failure.
 */
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
		return 0;
	}
}

/**
 * Store one entry and keep the running byte total exact — carry i. Both
 * stores are touched in ONE transaction: the old entry's bytes (if this key
 * already held one) are subtracted before the new bytes are added, so an
 * OVERWRITE never double-counts, and the eviction pass (when the put crosses
 * the budget) subtracts exactly what it deletes. A put that stays under the
 * budget never opens a cursor — the plain `get` calls here are direct key
 * lookups, not a walk over the store.
 */
async function readCachePut(
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
 *
 * STORE-ONLY (`storeOnly`, from `{ cache: 'store' }` / CACHED_READ_STORE_ONLY —
 * #434 slice 3 review round, findings 1 and 2). The store half above is
 * unchanged; the SERVE half is skipped entirely — offline the original
 * rejection propagates and `noteServedFromCache` is not called. Two reads need
 * exactly that, and neither can use `{ cache: true }` without misinforming the
 * viewer, because `servedFromCache` is ONE store shared by whatever screen is
 * mounted:
 *   - a background warm-up of a page she has not opened (the agenda's
 *     next-event detail prefetch). Cache-backed, its reads rejecting on a
 *     flapping connection would serve stored copies and stamp their age onto
 *     the AGENDA's own "as of" line — over rows that came back live.
 *   - a post-write re-read (the event page's `refreshEventDetail`). It must
 *     show the live answer, never a stored copy of the pre-write header; but
 *     declining the cache altogether leaves the stored copy behind the write
 *     that just landed, so the member who edits and then goes offline is shown
 *     her own superseded data.
 */
export function readThroughGet(
	db: string,
	pathAndQuery: string,
	init: RequestInit,
	attemptFetch: () => Promise<Response>,
	onResolved: (res: Response) => Response,
	storeOnly = false
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
							// number the ceiling is spent in is the response's own size, and
							// an over-ceiling body is then never even parsed. Encoded
							// BYTES, not `text.length`'s UTF-16 code units — the ceiling
							// is a promise about the origin's storage quota, and a
							// Cyrillic or Estonian body costs more bytes than it has
							// characters.
							const bytes = encodedByteLength(text);
							if (bytes > READ_CACHE_MAX_ENTRY_BYTES) return undefined;
							const body = JSON.parse(text) as unknown;
							return readCachePut(db, personId, pathAndQuery, { body, readAt, bytes });
						})
						.catch(() => undefined)
				);
			}
			return onResolved(res);
		},
		(err) => {
			// store-only: there is nothing to do offline. The rejection is the
			// answer, and `servedFromCache` stays exactly as the mounted screen's
			// own reads left it.
			if (storeOnly || !personId) throw err;
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
