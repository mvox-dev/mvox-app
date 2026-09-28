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
//     ISO string }.
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
//   - BOUNDED (#434 review round 1, finding 3): at most READ_CACHE_MAX_ENTRIES
//     entries, oldest-`readAt` evicted first on a put over the cap, and a body
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
//   readCacheGet(db, personId, pathAndQuery): Promise<{ body, readAt } | undefined>
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

import { CACHED_READ, entuFetch } from './request';
import {
	READ_CACHE_DB_NAME,
	READ_CACHE_MAX_ENTRIES,
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
			readAt: expect.any(String)
		});
		const names = (await browserIdb.databases()).map((d) => d.name);
		expect(names).toContain('mvox-read-cache');
	});
});

describe('entuFetch GET — online stores the read', () => {
	it('an online GET stores exactly { body: <parsed JSON>, readAt: ISO now }', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T10:15:00.000Z'));

		await storeOnline(DB, PATH);

		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: '2026-09-28T10:15:00.000Z'
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
			readAt: '2026-09-28T11:00:00.000Z'
		});
	});

	it('a non-ok response (500) is returned as-is and NOT stored', async () => {
		const res = await entuFetch(DB, PATH, TOKEN, {}, online({ error: 'boom' }, 500), CACHED_READ);
		expect(res.status).toBe(500);
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
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
				readAt: '2026-09-28T10:15:00.000Z'
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
			readAt: expect.any(String)
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
			readAt: expect.any(String)
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
			readAt: expect.any(String)
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
			readAt: expect.any(String)
		});
	});

	it('entries persist across a re-open of the database (a new app load)', async () => {
		await storeOnline(DB, PATH);
		setReadCacheFactory(factory); // drops the memoised connection
		expect(await readCacheGet(DB, PERSON_A, PATH)).toEqual({
			body: BODY,
			readAt: expect.any(String)
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

describe('bounded: a cap, and oldest-readAt eviction on put (finding 3)', () => {
	/** Fills the cache to exactly the cap, one entry per minute, oldest first. */
	async function fillToCap(baseMs: number): Promise<void> {
		for (let i = 0; i < READ_CACHE_MAX_ENTRIES; i += 1) {
			vi.setSystemTime(new Date(baseMs + i * 60_000));
			await storeOnline(DB, `entity/e${i}`);
		}
	}

	it('a put over the cap evicts the oldest-readAt entry, and only that many', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		await fillToCap(base);

		expect(await readCacheEntryCount()).toBe(READ_CACHE_MAX_ENTRIES);
		expect(await readCacheGet(DB, PERSON_A, 'entity/e0')).toBeDefined();

		vi.setSystemTime(new Date(base + READ_CACHE_MAX_ENTRIES * 60_000));
		await storeOnline(DB, 'entity/overflow');

		expect(await readCacheEntryCount()).toBe(READ_CACHE_MAX_ENTRIES);
		expect(await readCacheGet(DB, PERSON_A, 'entity/e0')).toBeUndefined();
		expect(await readCacheGet(DB, PERSON_A, 'entity/e1')).toBeDefined();
		expect(await readCacheGet(DB, PERSON_A, 'entity/overflow')).toBeDefined();
	});

	it('eviction follows readAt, not insertion order: a re-read is no longer the candidate', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		await fillToCap(base);

		// e0, the oldest, is read online again — now the freshest entry there is.
		vi.setSystemTime(new Date(base + 10 * 60 * 60_000));
		await storeOnline(DB, 'entity/e0');

		vi.setSystemTime(new Date(base + 11 * 60 * 60_000));
		await storeOnline(DB, 'entity/overflow');

		expect(await readCacheGet(DB, PERSON_A, 'entity/e0')).toBeDefined();
		expect(await readCacheGet(DB, PERSON_A, 'entity/e1')).toBeUndefined();
		expect(await readCacheEntryCount()).toBe(READ_CACHE_MAX_ENTRIES);
	});

	it('the cap counts entries across persons and dbs — it is the origin quota it protects', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const base = Date.parse('2026-09-28T00:00:00.000Z');
		await fillToCap(base);

		signIn({ [OTHER_DB]: PERSON_B });
		vi.setSystemTime(new Date(base + 10 * 60 * 60_000));
		await storeOnline(OTHER_DB, 'entity/other-person');

		expect(await readCacheEntryCount()).toBe(READ_CACHE_MAX_ENTRIES);
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
