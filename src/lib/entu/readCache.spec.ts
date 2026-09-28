// @vitest-environment happy-dom
//
// #434 slice 1/6 RED — the read cache core ("Offline, last seen data"). No UI.
//
// ISSUE LAW: "It caches reads only, never a write."
//
// SHARED DESIGN (team-lead, fixed for all six slices):
//   - The service worker stays out ($lib/sw/swPolicy.ts fences "Entu never
//     cached"). The copy lives in the app: `$lib/entu/readCache` over a NEW
//     IndexedDB database 'mvox-read-cache' — NOT #343's 'mvox-byte-store'
//     (bumping or sharing that one is a cache flush of every downloaded part).
//   - Key [db, personId, pathAndQuery]; value { body: <parsed JSON>, readAt:
//     ISO string, bytes: UTF-8 size of the JSON text } (bytes: review round 3).
//   - personId = the session's `personIdByDb[db]` (authStore, $lib/auth/session).
//     No personId → nothing is cached and nothing is served.
//   - Nothing is ever cleared on logout or token expiry (#343's law).
//   - Reads only: only GET calls through `entuFetch` are cached. A non-GET
//     never reads and never writes the cache.
//   - OPT IN (#434 review round 1, findings 1 and 2): a GET is cached only when
//     its caller asks for it — `entuFetch(db, path, token, init, fetchImpl,
//     CACHED_READ)`. Every other call keeps the pre-slice promise chain and no
//     cache at all. Two kinds of GET must never be cache-served, and an
//     exclusion list is not the shape that keeps them out: a 60-second signed
//     file url (`property/{id}`, entu-www `src/api/files/index.md`) and the
//     lookup step INSIDE a write choreography (replaceProperty, linkActions,
//     eventSeriesActions read the property `_id`s their POST/DELETE targets).
//     Slice 1 turns the flag on for NO reader at all (#434 review round 2,
//     finding 2): a reader opts in in the same slice that ships its screen's
//     "as of <time>" line, which the issue's Done-when pairs it with.
//   - BOUNDED (#434 review round 1, finding 3; review round 3, F1): the stored
//     bodies total at most READ_CACHE_MAX_BYTES, oldest-`readAt` evicted first
//     on a put that takes the total over — no entry-count cap, because the
//     offline screens fan out per entity — and a body
//     over READ_CACHE_MAX_ENTRY_BYTES — measured in UTF-8 BYTES, not UTF-16
//     code units (#434 review round 2, finding 3) — is not stored at all. This
//     database shares the origin's quota with #343's self-capping (200MB) part
//     byte store.
//   - Offline = the network call THROWS (fetch rejects). Then the cached entry
//     for the same key is served; with none, the ORIGINAL error is rethrown.
//     A resolved response of any status (401, 500) is not "offline".
//   - `servedFromCache` (readable store) = the OLDEST readAt among entries
//     served since the last `resetServedFromCache()`; null when everything
//     came from the network.
//
// CONTRACT for the GREEN implementer — `src/lib/entu/readCache.ts` exports:
//   READ_CACHE_DB_NAME = 'mvox-read-cache'
//   setReadCacheFactory(factory?: IDBFactory | null): void
//       Test seam, same idea as idbAdapter's injectable factory. `undefined`
//       restores the default (globalThis.indexedDB, resolved LAZILY at first
//       use — absent under node migration scripts → caching is off, silently).
//       `null` disables. Every call drops any memoised open connection.
//   readCacheGet(db, personId, pathAndQuery): Promise<{ body, readAt, bytes } | undefined>
//   flushReadCache(): Promise<void>  — settles once every pending cache write
//       started by entuFetch has settled (so specs can assert deterministically
//       without entuFetch having to await the write on the hot path).
//   pendingCacheWriteCount(): number — writes still in flight; returns to 0 on
//       its own, with no flush (#434 review round 2, finding 1: the app never
//       calls flushReadCache, so the list must not be append-only).
//   servedFromCache: Readable<string | null>
//   resetServedFromCache(): void
// and `entuFetch` ($lib/entu/request) routes its GET path through it.
// A cache failure (IDB unavailable, open throws) must never break an online
// read. NOTE for GREEN (found by a throwaway sketch against the full suite):
// several specs `vi.mock('$lib/auth/session', ...)` WITHOUT an `authStore`
// export (e.g. src/routes/auth/callback/run-link-callback.spec.ts). The
// personId lookup must treat a missing/throwing store as "no personId", or
// those suites' GETs start failing. The suite must stay green as a whole.
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Severs the $env/dynamic/public chain, same as request.auth-expired.spec.ts.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { CACHED_READ, CACHED_READ_STORE_ONLY, entuFetch } from './request';
import {
	READ_CACHE_DB_NAME,
	READ_CACHE_MAX_BYTES,
	READ_CACHE_MAX_ENTRY_BYTES,
	flushReadCache,
	pendingCacheWriteCount,
	readCacheEntryCount,
	readCacheGet,
	resetServedFromCache,
	servedFromCache,
	setReadCacheFactory
} from './readCache';
import { replaceEntityProperty } from './replaceProperty';
import { authStore, endSession } from '$lib/auth/session';
import { listWorks } from '$lib/library/libraryData';
import { signFileUrl } from '$lib/repertoire/fileUrls';

const DB = 'sampledb';
const OTHER_DB = 'crede';
const PERSON_A = 'person-a';
const PERSON_B = 'person-b';
const PATH = 'entity?_type.string=work&props=name,composer&limit=500';
const TOKEN = 'jwt-abc';

const BODY = { count: 1, entities: [{ _id: 'w1', name: [{ string: 'Bogoróditse Djévo' }] }] };
// What the entry spends of the byte budget: its JSON text in UTF-8 bytes
// (the 'ó'/'é' are two bytes each, so this is not `.length`).
const BODY_BYTES = new TextEncoder().encode(JSON.stringify(BODY)).length;

function signIn(personIdByDb: Record<string, string>): void {
	authStore.set({ status: 'authenticated', personIdByDb, expMs: Date.now() + 3_600_000 });
}

function online(body: unknown = BODY, status = 200) {
	return vi.fn().mockImplementation(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { 'Content-Type': 'application/json' }
			})
		)
	);
}

function offline(err: Error = new TypeError('Failed to fetch')) {
	return vi.fn().mockRejectedValue(err);
}

async function storeOnline(db: string, path: string, body: unknown = BODY) {
	const res = await entuFetch(db, path, TOKEN, {}, online(body), CACHED_READ);
	expect(res.ok).toBe(true);
	await flushReadCache();
}

let factory: IDBFactory;

beforeEach(() => {
	factory = new IDBFactory();
	setReadCacheFactory(factory);
	resetServedFromCache();
	signIn({ [DB]: PERSON_A });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	setReadCacheFactory(undefined);
	resetServedFromCache();
	authStore.set({ status: 'anonymous' });
});

describe('readCache — the database', () => {
	it("is its own IndexedDB database 'mvox-read-cache', never #343's 'mvox-byte-store'", async () => {
		expect(READ_CACHE_DB_NAME).toBe('mvox-read-cache');
		await storeOnline(DB, PATH);
		const names = (await factory.databases()).map((d) => d.name);
		expect(names).toContain('mvox-read-cache');
		expect(names).not.toContain('mvox-byte-store');
	});

	it('with no explicit factory, the browser indexedDB is used (the app needs no wiring call)', async () => {
		const browserIdb = new IDBFactory();
		vi.stubGlobal('indexedDB', browserIdb);
		setReadCacheFactory(undefined);

		await storeOnline(DB, PATH);

		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: expect.any(String),
			bytes: BODY_BYTES
		});
		const names = (await browserIdb.databases()).map((d) => d.name);
		expect(names).toContain('mvox-read-cache');
	});
});

describe('entuFetch GET — online stores the read', () => {
	it('an online GET stores exactly { body: <parsed JSON>, readAt: ISO now, bytes: UTF-8 size }', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T10:15:00.000Z'));

		await storeOnline(DB, PATH);

		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: '2026-09-28T10:15:00.000Z',
			bytes: BODY_BYTES
		});
	});

	it('the caller still gets the live response body, untouched (the cache reads a copy)', async () => {
		const res = await entuFetch(DB, PATH, TOKEN, {}, online(), CACHED_READ);
		expect(await res.json()).toEqual(BODY);
		await flushReadCache();
	});

	it('an online GET leaves servedFromCache null — nothing came from the cache', async () => {
		await storeOnline(DB, PATH);
		expect(get(servedFromCache)).toBeNull();
	});

	it('a later online GET replaces the entry (body and readAt)', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
		await storeOnline(DB, PATH, { entities: [] });
		vi.setSystemTime(new Date('2026-09-28T11:00:00.000Z'));
		await storeOnline(DB, PATH);

		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: '2026-09-28T11:00:00.000Z',
			bytes: BODY_BYTES
		});
	});

	it('a non-ok response (500) is returned as-is and NOT stored', async () => {
		const res = await entuFetch(DB, PATH, TOKEN, {}, online({ error: 'boom' }, 500), CACHED_READ);
		expect(res.status).toBe(500);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
	});
});

// #434 slice 3 review round, findings 1 and 2 — the THIRD mode: store, never
// serve, never touch `servedFromCache`. What a read that is not what the
// mounted screen renders gets: a background warm-up, or a post-write re-read.
describe('entuFetch GET — CACHED_READ_STORE_ONLY stores without serving', () => {
	it('stores the body online, exactly as CACHED_READ does', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T10:15:00.000Z'));

		const res = await entuFetch(DB, PATH, TOKEN, {}, online(), CACHED_READ_STORE_ONLY);
		expect(await res.json()).toEqual(BODY);
		await flushReadCache();

		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: '2026-09-28T10:15:00.000Z',
			bytes: BODY_BYTES
		});
	});

	it('offline it REJECTS with the original error even though a stored copy exists', async () => {
		await storeOnline(DB, PATH);
		const err = new TypeError('Failed to fetch');
		await expect(
			entuFetch(DB, PATH, TOKEN, {}, offline(err), CACHED_READ_STORE_ONLY)
		).rejects.toBe(err);
	});

	it('offline it leaves servedFromCache alone — a background read cannot age-stamp a live screen', async () => {
		// The mounted screen's own read came back live, so the age line is absent.
		await storeOnline(DB, 'entity/screens-own-read');
		await storeOnline(DB, PATH);
		resetServedFromCache();
		expect(get(servedFromCache)).toBeNull();

		await expect(
			entuFetch(DB, PATH, TOKEN, {}, offline(), CACHED_READ_STORE_ONLY)
		).rejects.toThrow('Failed to fetch');

		expect(get(servedFromCache)).toBeNull();
	});

	it('the same key stays SERVABLE to a CACHED_READ reader — only this call declines the copy', async () => {
		await entuFetch(DB, PATH, TOKEN, {}, online(), CACHED_READ_STORE_ONLY);
		await flushReadCache();
		const served = await entuFetch(DB, PATH, TOKEN, {}, offline(), CACHED_READ);
		expect(await served.json()).toEqual(BODY);
		expect(get(servedFromCache)).not.toBeNull();
	});

	it('a store-only re-read moves the stored copy forward (a landed write stops drifting out of the cache)', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
		await storeOnline(DB, PATH, { entities: [{ _id: 'ev-1', name: 'before the write' }] });

		vi.setSystemTime(new Date('2026-09-28T10:05:00.000Z'));
		const after = { entities: [{ _id: 'ev-1', name: 'after the write' }] };
		await entuFetch(DB, PATH, TOKEN, {}, online(after), CACHED_READ_STORE_ONLY);
		await flushReadCache();

		// Offline, a SERVING reader of the same key now sees the post-write body.
		const served = await entuFetch(DB, PATH, TOKEN, {}, offline(), CACHED_READ);
		expect(await served.json()).toEqual(after);
	});
});

// #434 slice 3 review round, finding 2 — the factory GENERATION. Dropping
// `dbPromise` does not reach a read that already holds a resolved
// `IDBDatabase`, so before this guard a read started against one factory could
// finish against it after a swap: serve a foreign body, and age-stamp the ONE
// global `servedFromCache` for whatever screen (or test) was live by then. That
// is what made `page.agenda-offline.spec.ts` order-dependent.
//
// BOTH tests below RE-REGISTER THE SAME FACTORY, on purpose. Swapping in a fresh
// `IDBFactory` proves nothing: the lookup would then open an EMPTY database and
// miss anyway, so such a test passes with the guard removed. Handing back the
// same factory keeps the stored entry findable, so the only thing that can stop
// the serve is the generation check itself.
describe('readCache — a read that outlives its factory serves nothing', () => {
	/** A fetch that stays pending until the test rejects it by hand. */
	function heldOffline(): { impl: typeof fetch; reject: (reason: unknown) => void } {
		let reject: (reason: unknown) => void = () => undefined;
		const impl = vi.fn(
			() =>
				new Promise<Response>((_resolve, rejectLive) => {
					reject = rejectLive;
				})
		);
		return { impl: impl as unknown as typeof fetch, reject: (r) => reject(r) };
	}

	it('a swap while the live call is in flight rethrows, and stamps no age', async () => {
		await storeOnline(DB, PATH);
		const held = heldOffline();
		const pending = entuFetch(DB, PATH, TOKEN, {}, held.impl, CACHED_READ);

		// What a spec's `beforeEach` does between tests, while this read is still
		// in flight — the caller it belonged to is gone.
		setReadCacheFactory(factory);
		resetServedFromCache();

		held.reject(new TypeError('Failed to fetch'));
		await expect(pending).rejects.toThrow('Failed to fetch');
		expect(get(servedFromCache)).toBeNull();
	});

	it('a swap DURING the cache lookup cannot serve from the dropped database either', async () => {
		await storeOnline(DB, PATH);
		const held = heldOffline();
		const pending = entuFetch(DB, PATH, TOKEN, {}, held.impl, CACHED_READ);

		held.reject(new TypeError('Failed to fetch'));
		// Two microtask turns: the rejection handler has run (so `readThroughGet`'s
		// own check already passed) and its lookup is awaiting the ALREADY-OPEN
		// database. The IDB request completes on a later task, so the swap lands
		// inside exactly the window `dbPromise = null` does not reach — the one the
		// agenda spec's leak came through.
		await Promise.resolve();
		await Promise.resolve();
		setReadCacheFactory(factory);
		resetServedFromCache();

		await expect(pending).rejects.toThrow('Failed to fetch');
		expect(get(servedFromCache)).toBeNull();
	});

	it('the identical read with NO swap is still served — the guard is not a blanket', async () => {
		await storeOnline(DB, PATH);
		const served = await entuFetch(DB, PATH, TOKEN, {}, offline(), CACHED_READ);
		expect(await served.json()).toEqual(BODY);
		expect(get(servedFromCache)).not.toBeNull();
	});
});

describe('entuFetch GET — offline serves the last seen copy', () => {
	it('a rejected fetch serves the cached body and sets servedFromCache to its readAt', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T10:15:00.000Z'));
		await storeOnline(DB, PATH);
		vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));

		const res = await entuFetch(DB, PATH, TOKEN, {}, offline(), CACHED_READ);

		expect(res.ok).toBe(true);
		expect(await res.json()).toEqual(BODY);
		expect(get(servedFromCache)).toBe('2026-09-28T10:15:00.000Z');
	});

	it('a rejected fetch with nothing cached rethrows the ORIGINAL error', async () => {
		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err), CACHED_READ)).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
	});

	it('servedFromCache is the OLDEST readAt among entries served since the last reset', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T09:00:00.000Z'));
		await storeOnline(DB, 'entity/old');
		vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
		await storeOnline(DB, 'entity/new');

		await entuFetch(DB, 'entity/new', TOKEN, {}, offline(), CACHED_READ);
		expect(get(servedFromCache)).toBe('2026-09-28T10:00:00.000Z');
		await entuFetch(DB, 'entity/old', TOKEN, {}, offline(), CACHED_READ);
		expect(get(servedFromCache)).toBe('2026-09-28T09:00:00.000Z');
		await entuFetch(DB, 'entity/new', TOKEN, {}, offline(), CACHED_READ);
		expect(get(servedFromCache)).toBe('2026-09-28T09:00:00.000Z');

		resetServedFromCache();
		expect(get(servedFromCache)).toBeNull();
		await entuFetch(DB, 'entity/new', TOKEN, {}, offline(), CACHED_READ);
		expect(get(servedFromCache)).toBe('2026-09-28T10:00:00.000Z');
	});

	it('a resolved 401 is NOT offline: AuthExpiredError, never the cached copy', async () => {
		await storeOnline(DB, PATH);
		const res401 = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
		await expect(entuFetch(DB, PATH, TOKEN, {}, res401, CACHED_READ)).rejects.toMatchObject({
			name: 'AuthExpiredError'
		});
		expect(get(servedFromCache)).toBeNull();
	});

	it('a resolved 500 is NOT offline: the 500 is returned, not the cached copy', async () => {
		await storeOnline(DB, PATH);
		const res = await entuFetch(DB, PATH, TOKEN, {}, online({ error: 'boom' }, 500), CACHED_READ);
		expect(res.status).toBe(500);
		expect(get(servedFromCache)).toBeNull();
	});
});

describe('reads only — a write never touches the cache', () => {
	for (const method of ['POST', 'DELETE']) {
		it(`an online ${method} writes nothing to the cache`, async () => {
			await entuFetch(DB, PATH, TOKEN, { method, body: '[]' }, online({ ok: true }), CACHED_READ);
			await flushReadCache();
			expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
		});

		it(`an online ${method} does not overwrite a cached GET for the same path`, async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-09-28T10:15:00.000Z'));
			await storeOnline(DB, PATH);
			vi.setSystemTime(new Date('2026-09-28T11:00:00.000Z'));
			await entuFetch(DB, PATH, TOKEN, { method, body: '[]' }, online({ written: true }), CACHED_READ);
			await flushReadCache();
			expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
				body: BODY,
				readAt: '2026-09-28T10:15:00.000Z',
				bytes: BODY_BYTES
			});
		});

		it(`an offline ${method} never reads the cache — the original error is rethrown`, async () => {
			await storeOnline(DB, PATH);
			const err = new TypeError('Failed to fetch');
			await expect(
				entuFetch(DB, PATH, TOKEN, { method, body: '[]' }, offline(err), CACHED_READ)
			).rejects.toBe(err);
			expect(get(servedFromCache)).toBeNull();
		});
	}

	it("method matching is case-insensitive: 'post' is a write too", async () => {
		await entuFetch(DB, PATH, TOKEN, { method: 'post', body: '[]' }, online({ ok: true }), CACHED_READ);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
	});

	it("an explicit method 'GET' is a read", async () => {
		await entuFetch(DB, PATH, TOKEN, { method: 'GET' }, online(), CACHED_READ);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: expect.any(String),
			bytes: BODY_BYTES
		});
	});
});

describe('partition — person and db', () => {
	it("person A's entry is NEVER served to person B on the same db", async () => {
		await storeOnline(DB, PATH);
		signIn({ [DB]: PERSON_B });

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err), CACHED_READ)).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
		expect(await readCacheGet(DB, PERSON_B, PATH)).toBeUndefined();
	});

	it("db X's entry is never served for db Y (same person id, same path)", async () => {
		signIn({ [DB]: PERSON_A, [OTHER_DB]: PERSON_A });
		await storeOnline(DB, PATH);

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(OTHER_DB, PATH, TOKEN, {}, offline(err), CACHED_READ)).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
		expect(await readCacheGet(OTHER_DB, PERSON_A, PATH)).toBeUndefined();
	});

	it('the entry is written under the personId for THAT db', async () => {
		signIn({ [DB]: PERSON_A, [OTHER_DB]: PERSON_B });
		await storeOnline(OTHER_DB, PATH);
		expect(await readCacheGet(OTHER_DB, PERSON_B, PATH)).toEqual({
			body: BODY,
			readAt: expect.any(String),
			bytes: BODY_BYTES
		});
		expect(await readCacheGet(OTHER_DB, PERSON_A, PATH)).toBeUndefined();
	});
});

describe('no personId — no cache', () => {
	it('anonymous: an online GET stores nothing, and an offline GET rethrows', async () => {
		authStore.set({ status: 'anonymous' });
		await storeOnline(DB, PATH);

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err), CACHED_READ)).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();

		// Nothing landed under any plausible stand-in key either.
		expect(await readCacheGet(DB, '', PATH)).toBeUndefined();
		expect(await readCacheGet(DB, 'undefined', PATH)).toBeUndefined();
	});

	it('signed in, but no account on THIS db: nothing stored, nothing served', async () => {
		signIn({ [OTHER_DB]: PERSON_A });
		await storeOnline(DB, PATH);
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err), CACHED_READ)).rejects.toBe(err);
	});

	it("an entry stored while signed in is not served once there's no personId", async () => {
		await storeOnline(DB, PATH);
		authStore.set({ status: 'anonymous' });

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err), CACHED_READ)).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
	});
});

describe("nothing is cleared on logout or token expiry (#343's law)", () => {
	it('endSession (sign-out) leaves the entry intact; the same person back finds it', async () => {
		await storeOnline(DB, PATH);

		endSession({ preserveProvider: false });
		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: expect.any(String),
			bytes: BODY_BYTES
		});

		signIn({ [DB]: PERSON_A });
		const res = await entuFetch(DB, PATH, TOKEN, {}, offline(), CACHED_READ);
		expect(await res.json()).toEqual(BODY);
	});

	it('the 401 teardown (endSession, provider kept) leaves the entry intact', async () => {
		await storeOnline(DB, PATH);
		endSession({ preserveProvider: true });
		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: expect.any(String),
			bytes: BODY_BYTES
		});
	});

	it('entries persist across a re-open of the database (a new app load)', async () => {
		await storeOnline(DB, PATH);
		setReadCacheFactory(factory); // drops the memoised connection
		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: expect.any(String),
			bytes: BODY_BYTES
		});
	});
});

describe('a cache failure never breaks an online read', () => {
	it('an IndexedDB whose open() throws: the online GET still resolves with the live body', async () => {
		const broken = {
			open: () => {
				throw new Error('IDB unavailable');
			}
		} as unknown as IDBFactory;
		setReadCacheFactory(broken);

		const res = await entuFetch(DB, PATH, TOKEN, {}, online(), CACHED_READ);
		expect(await res.json()).toEqual(BODY);
		await flushReadCache();
	});

	it('caching disabled (null) and offline: the original error is rethrown', async () => {
		setReadCacheFactory(null);
		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err), CACHED_READ)).rejects.toBe(err);
	});
});

// An opted-in read of a REAL screen's path and wire body, end to end through
// `entuFetch`. Deliberately not through `listWorks` (#434 review round 2,
// finding 2): no reader carries CACHED_READ in slice 1 — a reader gets the flag
// in the slice that also ships its screen's "as of <time>" line, so this pins
// the mechanism the library's own reader will opt into in slice 4.
describe('integration — an opted-in read of a real screen path (library works list)', () => {
	it('online then offline returns byte-identical body from the cache', async () => {
		const wire = {
			count: 1,
			entities: [
				{ _id: 'w1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Pärt' }] }
			]
		};
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T08:30:00.000Z'));
		const liveRes = await entuFetch(DB, PATH, TOKEN, {}, online(wire), CACHED_READ);
		expect(await liveRes.json()).toEqual(wire);
		await flushReadCache();

		vi.setSystemTime(new Date('2026-09-28T13:00:00.000Z'));
		const cachedRes = await entuFetch(DB, PATH, TOKEN, {}, offline(), CACHED_READ);

		expect(cachedRes.status).toBe(200);
		expect(await cachedRes.json()).toEqual(wire);
		expect(get(servedFromCache)).toBe('2026-09-28T08:30:00.000Z');
	});

	it('the library reader itself is NOT cached yet — offline it still fails (slice 4 flips it)', async () => {
		const err = new TypeError('Failed to fetch');
		await listWorks({ db: DB, token: TOKEN } as never, online());
		await flushReadCache();

		await expect(listWorks({ db: DB, token: TOKEN } as never, offline(err))).rejects.toBe(err);
	});
});

// ---------------------------------------------------------------------------
// #434 review round 1 (Bentham, RED) — the three findings, each pinned here.
// ---------------------------------------------------------------------------

describe('the cache is OPT IN — a GET reaches it only by asking (review finding 1/2)', () => {
	it('a GET with no cache option stores nothing', async () => {
		const res = await entuFetch(DB, PATH, TOKEN, {}, online());
		expect(res.ok).toBe(true);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
	});

	it('an uncached GET never even opens the database', async () => {
		await entuFetch(DB, PATH, TOKEN, {}, online());
		await flushReadCache();
		expect((await factory.databases()).map((d) => d.name)).not.toContain(READ_CACHE_DB_NAME);
	});

	it('a GET with no cache option is never SERVED the copy an opted-in call stored', async () => {
		await storeOnline(DB, PATH);

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
	});
});

describe('a short-lived body is never cached: the 60s signed file url (finding 1)', () => {
	const FILE_ID = 'file-prop-1';
	const SIGNED = 'https://bucket.invalid/part.pdf?X-Amz-Expires=60&sig=abc';
	const cfg = { db: DB, token: TOKEN } as never;

	it('signFileUrl online stores nothing under its property path', async () => {
		expect(await signFileUrl(cfg, FILE_ID, online({ url: SIGNED }))).toBe(SIGNED);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, `property/${FILE_ID}`)).toBeUndefined();
	});

	it('offline, signFileUrl REJECTS — an expired url is never handed back from a copy', async () => {
		// Whatever an earlier online click stored anywhere, this call must fail:
		// openFileBytes turns a resolved sign into a browser navigation, so a
		// stale url resolves onto the bucket's AccessDenied instead of failing
		// where the caller can say so (#343 review round 3, finding 2).
		expect(await signFileUrl(cfg, FILE_ID, online({ url: SIGNED }))).toBe(SIGNED);
		await flushReadCache();

		const err = new TypeError('Failed to fetch');
		await expect(signFileUrl(cfg, FILE_ID, offline(err))).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
	});
});

describe('a GET that is a STEP inside a write is never cache-served (finding 2)', () => {
	const ENTITY = 'e-1';
	const VALUE = { type: 'name', string: 'Uus nimi' };
	const LOOKUP = `entity/${ENTITY}?props=name`;

	/** The live wire: the lookup GET answers one existing value id, the POST 200s. */
	function liveWire(): ReturnType<typeof vi.fn> {
		return vi.fn((_url: string, init?: RequestInit) =>
			Promise.resolve(
				(init?.method ?? 'GET') === 'GET'
					? new Response(JSON.stringify({ entity: { name: [{ _id: 'v-old' }] } }), {
							status: 200,
							headers: { 'Content-Type': 'application/json' }
						})
					: new Response('{}', { status: 200 })
			)
		);
	}

	it("the write's lookup GET is not stored, even though it is a GET", async () => {
		await replaceEntityProperty({ db: DB, token: TOKEN }, ENTITY, VALUE, liveWire() as never);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, LOOKUP)).toBeUndefined();
	});

	it('on a flapping connection the lookup rejects and NO mutation is sent', async () => {
		await replaceEntityProperty({ db: DB, token: TOKEN }, ENTITY, VALUE, liveWire() as never);
		await flushReadCache();

		const err = new TypeError('Failed to fetch');
		const methods: string[] = [];
		const flapping = vi.fn((_url: string, init?: RequestInit) => {
			const method = (init?.method ?? 'GET').toUpperCase();
			methods.push(method);
			// The network is back for everything but the lookup — the exact shape
			// that would feed a cache-served, stale `_id` into a live POST.
			return method === 'GET'
				? Promise.reject(err)
				: Promise.resolve(new Response('{}', { status: 200 }));
		});

		await expect(
			replaceEntityProperty({ db: DB, token: TOKEN }, ENTITY, VALUE, flapping as never)
		).rejects.toBe(err);
		expect(methods).toEqual(['GET']);
		expect(get(servedFromCache)).toBeNull();
	});
});

describe('bounded: a byte budget, and oldest-readAt eviction on put (finding 3; round 3)', () => {
	// Bodies just under the per-entry ceiling, all the same encoded size (the
	// id is fixed-width), so the budget holds exactly FITS of them.
	const big = (i: number) => ({ _id: `e${String(i).padStart(3, '0')}`, pad: 'x'.repeat(900_000) });
	const BIG_BYTES = new TextEncoder().encode(JSON.stringify(big(0))).length;
	const FITS = Math.floor(READ_CACHE_MAX_BYTES / BIG_BYTES);

	/** Fills the budget with exactly FITS entries, one per minute, oldest first. */
	async function fillToBudget(baseMs: number): Promise<void> {
		for (let i = 0; i < FITS; i += 1) {
			vi.setSystemTime(new Date(baseMs + i * 60_000));
			await storeOnline(DB, `entity/e${i}`, big(i));
		}
	}

	it('a put over the budget evicts the oldest-readAt entry, and only that many', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		await fillToBudget(base);

		expect(await readCacheEntryCount()).toBe(FITS);
		expect(await readCacheGet(DB, PERSON_A, 'entity/e0')).toBeDefined();

		vi.setSystemTime(new Date(base + FITS * 60_000));
		await storeOnline(DB, 'entity/overflow', big(999));

		expect(await readCacheEntryCount()).toBe(FITS);
		expect(await readCacheGet(DB, PERSON_A, 'entity/e0')).toBeUndefined();
		expect(await readCacheGet(DB, PERSON_A, 'entity/e1')).toBeDefined();
		expect(await readCacheGet(DB, PERSON_A, 'entity/overflow')).toBeDefined();
	});

	it('eviction follows readAt, not insertion order: a re-read is no longer the candidate', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		await fillToBudget(base);

		// e0, the oldest, is read online again — now the freshest entry there is.
		vi.setSystemTime(new Date(base + 10 * 60 * 60_000));
		await storeOnline(DB, 'entity/e0', big(0));

		vi.setSystemTime(new Date(base + 11 * 60 * 60_000));
		await storeOnline(DB, 'entity/overflow', big(999));

		expect(await readCacheGet(DB, PERSON_A, 'entity/e0')).toBeDefined();
		expect(await readCacheGet(DB, PERSON_A, 'entity/e1')).toBeUndefined();
		expect(await readCacheEntryCount()).toBe(FITS);
	});

	it('the budget counts bytes across persons and dbs — it is the origin quota it protects', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		await fillToBudget(base);

		signIn({ [OTHER_DB]: PERSON_B });
		vi.setSystemTime(new Date(base + 10 * 60 * 60_000));
		await storeOnline(OTHER_DB, 'entity/other-person', big(999));

		expect(await readCacheEntryCount()).toBe(FITS);
		expect(await readCacheGet(OTHER_DB, PERSON_B, 'entity/other-person')).toBeDefined();
		expect(await readCacheGet(DB, PERSON_A, 'entity/e0')).toBeUndefined();
	});

	it('a body over READ_CACHE_MAX_ENTRY_BYTES is not stored; the live body is untouched', async () => {
		const big = { entities: [{ _id: 'w1', name: 'x'.repeat(READ_CACHE_MAX_ENTRY_BYTES) }] };

		const res = await entuFetch(DB, PATH, TOKEN, {}, online(big), CACHED_READ);

		expect(await res.json()).toEqual(big);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('the ceiling is BYTES: a body under it in characters but over it in UTF-8 is not stored (round 2, finding 3)', async () => {
		// 'ы' is two UTF-8 bytes and one UTF-16 code unit: 0.6M of them is ~600k
		// characters (under the ceiling) and ~1.2MB encoded (over it).
		const body = { entities: [{ _id: 'w1', name: 'ы'.repeat(600_000) }] };
		const text = JSON.stringify(body);
		expect(text.length).toBeLessThan(READ_CACHE_MAX_ENTRY_BYTES);
		expect(new TextEncoder().encode(text).length).toBeGreaterThan(READ_CACHE_MAX_ENTRY_BYTES);

		const res = await entuFetch(DB, PATH, TOKEN, {}, online(body), CACHED_READ);

		expect(await res.json()).toEqual(body);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
		expect(await readCacheEntryCount()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// #434 review round 3 (Bentham, F1) — the budget is BYTES, not entries. The
// three offline screens fan out per ENTITY (resolveCopyChains: one GET per copy
// and per edition; resolveBorrowerName: one per member plus a profiles read;
// loadWorksByEventId: ~N+4 for N events; listFullAgenda: one listEvents per
// season), so a real library + agenda load is well past 64 paths. A 64-entry
// cap evicted a screen's own earliest reads mid-load, and offline its
// Promise.all then rejected instead of showing last-seen data.
// ---------------------------------------------------------------------------

describe('bounded by bytes: a real screen fan-out survives, the budget evicts oldest-first (round 3)', () => {
	/** A kilobyte-class entity body, the size real Entu reads come back at. */
	function entityBody(id: string, extra: string): unknown {
		return {
			_id: id,
			name: [{ string: `${extra} ${id}` }],
			_parent: [{ reference: `parent-${id}`, string: 'Kammerkoor' }],
			notes: [{ string: 'Märkus: '.repeat(40) }]
		};
	}

	/** The library + agenda fan-out: lists, then one read per copy, edition,
	 *  member and profile, then one listEvents per season and per-event works. */
	function libraryShapedPaths(): string[] {
		const paths = [
			'entity?_type.string=work&props=name,composer&limit=500',
			'entity?_type.string=edition&props=name,_parent,publisher&limit=500',
			'entity?_type.string=copy&props=_parent,label&limit=500',
			'entity?_type.string=lending&props=copy,member,renewed_at&limit=500'
		];
		for (let i = 0; i < 25; i += 1) paths.push(`entity/copy-${i}?props=_parent,label`);
		for (let i = 0; i < 20; i += 1) paths.push(`entity/edition-${i}?props=name,_parent`);
		for (let i = 0; i < 20; i += 1) paths.push(`entity/member-${i}?props=person,name`);
		for (let i = 0; i < 20; i += 1) paths.push(`entity?_type.string=profile&_parent.reference=person-${i}`);
		for (let i = 0; i < 8; i += 1) paths.push(`entity?_type.string=event&_parent.reference=season-${i}&limit=500`);
		for (let i = 0; i < 30; i += 1) paths.push(`entity?_type.string=program_item&_parent.reference=event-${i}`);
		return paths;
	}

	it('a library + agenda load well past 64 paths keeps every read — nothing is evicted under the budget', async () => {
		const paths = libraryShapedPaths();
		expect(paths.length).toBeGreaterThan(64);

		for (const [i, path] of paths.entries()) await storeOnline(DB, path, entityBody(`e${i}`, 'Bogoróditse'));

		expect(await readCacheEntryCount()).toBe(paths.length);
		for (const path of paths) {
			expect(await readCacheGet(DB, PERSON_A, path), `evicted: ${path}`).toBeDefined();
		}
	});

	it('over READ_CACHE_MAX_BYTES, the oldest-readAt entries go first until the total fits', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		// Bodies just under the per-entry ceiling, so the budget is crossed in a
		// few dozen puts.
		const big = (i: number) => ({ _id: `e${String(i).padStart(3, '0')}`, pad: 'x'.repeat(900_000) });
		const bytesEach = new TextEncoder().encode(JSON.stringify(big(0))).length;
		const fits = Math.floor(READ_CACHE_MAX_BYTES / bytesEach);
		const total = fits + 3;

		for (let i = 0; i < total; i += 1) {
			vi.setSystemTime(new Date(base + i * 60_000));
			await storeOnline(DB, `entity/e${i}`, big(i));
		}

		expect(await readCacheEntryCount()).toBe(fits);
		for (let i = 0; i < 3; i += 1) {
			expect(await readCacheGet(DB, PERSON_A, `entity/e${i}`), `e${i} should be evicted`).toBeUndefined();
		}
		for (let i = 3; i < total; i += 1) {
			expect(await readCacheGet(DB, PERSON_A, `entity/e${i}`), `e${i} should be kept`).toBeDefined();
		}
	});
});

// ---------------------------------------------------------------------------
// #434 review round 2 (Bentham) — finding 1: the pending-write list must not
// grow for the life of the tab. `flushReadCache` is a spec affordance; the app
// never calls it, so a settled write has to drop itself.
// ---------------------------------------------------------------------------

describe('pending cache writes drain themselves, with no flush (review round 2, finding 1)', () => {
	// No `flushReadCache()` anywhere in here — that is the whole point.
	async function settle(): Promise<void> {
		for (let i = 0; i < 200 && pendingCacheWriteCount() > 0; i += 1) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	it('the list returns to empty on its own once the writes land', async () => {
		for (let i = 0; i < 5; i += 1) {
			const res = await entuFetch(DB, `entity/e${i}`, TOKEN, {}, online(), CACHED_READ);
			expect(res.ok).toBe(true);
		}

		await settle();

		expect(pendingCacheWriteCount()).toBe(0);
		// The writes really did land — draining is not "the writes were dropped".
		expect(await readCacheEntryCount()).toBe(5);
	});

	it('an over-ceiling body (never stored) still drops its tracking entry', async () => {
		const big = { entities: [{ _id: 'w1', name: 'x'.repeat(READ_CACHE_MAX_ENTRY_BYTES) }] };

		await entuFetch(DB, PATH, TOKEN, {}, online(big), CACHED_READ);
		await settle();

		expect(pendingCacheWriteCount()).toBe(0);
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('a write that FAILS drops its tracking entry too', async () => {
		setReadCacheFactory({
			open: () => {
				throw new Error('IndexedDB unavailable');
			}
		} as unknown as IDBFactory);

		const res = await entuFetch(DB, PATH, TOKEN, {}, online(), CACHED_READ);

		expect(res.ok).toBe(true);
		await settle();
		expect(pendingCacheWriteCount()).toBe(0);
	});

	it('flushReadCache still awaits everything started before it', async () => {
		await entuFetch(DB, PATH, TOKEN, {}, online(), CACHED_READ);

		await flushReadCache();

		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeDefined();
		expect(pendingCacheWriteCount()).toBe(0);
	});
});

// (*MVOX:Tallis*) — review-round-1 and review-round-2 additions (*MVOX:Josquin*)
// (*MVOX:Josquin* — #434 slice 3 review round 2, findings 1-4)
