// The read-through cache behind entuFetch's opted-in GETs: it caches reads only, never a write.

// OPT IN, NEVER BLANKET: a caller passes the flag as an argument; the files that may are pinned
// in readCache.optin-fence.spec.ts. Offline means the fetch THREW; any resolved status is live.

import { get, writable, type Readable } from 'svelte/store';
import { authStore } from '$lib/auth/session';
import { clearReadFellBackToCache, noteReadFellBackToCache } from '$lib/net/cacheFallback';
import {
	READ_CACHE_MAX_ENTRY_BYTES,
	currentFactoryGeneration,
	encodedByteLength,
	readCacheGet,
	readCachePut
} from './readCacheStore';

export {
	READ_CACHE_DB_NAME,
	READ_CACHE_MAX_BYTES,
	READ_CACHE_MAX_ENTRY_BYTES,
	READ_CACHE_OPEN_TIMEOUT_MS,
	readCacheEntryCount,
	readCacheGet,
	readCacheTotalBytes,
	setReadCacheFactory,
	type ReadCacheEntry
} from './readCacheStore';

// Writes are fire-and-forget; a tracked write drops itself once settled, so the list stays small.
let pendingWrites: Promise<void>[] = [];

function trackWrite(p: Promise<void>): void {
	const tracked: Promise<void> = p
		.catch(() => undefined)
		.finally(() => {
			pendingWrites = pendingWrites.filter((q) => q !== tracked);
		});
	pendingWrites.push(tracked);
}

export function pendingCacheWriteCount(): number {
	return pendingWrites.length;
}

export async function flushReadCache(): Promise<void> {
	const writes = pendingWrites;
	pendingWrites = [];
	await Promise.all(writes);
}

// The oldest readAt served since the last reset; ISO strings compare chronologically.
const servedFromCacheStore = writable<string | null>(null);
export const servedFromCache: Readable<string | null> = servedFromCacheStore;

// Each reset starts a load; a read that finishes after a later reset stamps nothing.
let loadEpoch = 0;

export function resetServedFromCache(): void {
	loadEpoch += 1;
	servedFromCacheStore.set(null);
	clearReadFellBackToCache();
}

function noteServedFromCache(readAt: string): void {
	servedFromCacheStore.update((oldest) => (oldest === null || readAt < oldest ? readAt : oldest));
}

// Some specs mock $lib/auth/session without an authStore; their GETs just go uncached.
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

// One .then() stage over attemptFetch, the promise shape entuFetch had before the cache.
// storeOnly stores like a cached read but never serves offline or stamps servedFromCache.
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
	const generation = currentFactoryGeneration();
	const epoch = loadEpoch;

	return attemptFetch().then(
		(res) => {
			if (res.ok && epoch === loadEpoch) clearReadFellBackToCache();
			if (res.ok && personId) {
				const readAt = new Date().toISOString();
				const clone = res.clone();
				trackWrite(
					clone
						.text()
						.then((text) => {
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
			if (storeOnly || !personId) throw err;
			if (generation !== currentFactoryGeneration()) throw err;
			return readCacheGet(db, personId, pathAndQuery).then((cached) => {
				if (!cached) throw err;
				if (epoch === loadEpoch) {
					noteServedFromCache(cached.readAt);
					noteReadFellBackToCache();
				}
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
