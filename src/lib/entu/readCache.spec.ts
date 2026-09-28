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

import { entuFetch } from './request';
import {
	READ_CACHE_DB_NAME,
	flushReadCache,
	readCacheGet,
	resetServedFromCache,
	servedFromCache,
	setReadCacheFactory
} from './readCache';
import { authStore, endSession } from '$lib/auth/session';
import { listWorks } from '$lib/library/libraryData';

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
	const res = await entuFetch(db, path, TOKEN, {}, online(body));
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
		const res = await entuFetch(DB, PATH, TOKEN, {}, online());
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
		const res = await entuFetch(DB, PATH, TOKEN, {}, online({ error: 'boom' }, 500));
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

		const res = await entuFetch(DB, PATH, TOKEN, {}, offline());

		expect(res.ok).toBe(true);
		expect(await res.json()).toEqual(BODY);
		expect(get(servedFromCache)).toBe('2026-09-28T10:15:00.000Z');
	});

	it('a rejected fetch with nothing cached rethrows the ORIGINAL error', async () => {
		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
	});

	it('servedFromCache is the OLDEST readAt among entries served since the last reset', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T09:00:00.000Z'));
		await storeOnline(DB, 'entity/old');
		vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
		await storeOnline(DB, 'entity/new');

		await entuFetch(DB, 'entity/new', TOKEN, {}, offline());
		expect(get(servedFromCache)).toBe('2026-09-28T10:00:00.000Z');
		await entuFetch(DB, 'entity/old', TOKEN, {}, offline());
		expect(get(servedFromCache)).toBe('2026-09-28T09:00:00.000Z');
		await entuFetch(DB, 'entity/new', TOKEN, {}, offline());
		expect(get(servedFromCache)).toBe('2026-09-28T09:00:00.000Z');

		resetServedFromCache();
		expect(get(servedFromCache)).toBeNull();
		await entuFetch(DB, 'entity/new', TOKEN, {}, offline());
		expect(get(servedFromCache)).toBe('2026-09-28T10:00:00.000Z');
	});

	it('a resolved 401 is NOT offline: AuthExpiredError, never the cached copy', async () => {
		await storeOnline(DB, PATH);
		const res401 = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
		await expect(entuFetch(DB, PATH, TOKEN, {}, res401)).rejects.toMatchObject({
			name: 'AuthExpiredError'
		});
		expect(get(servedFromCache)).toBeNull();
	});

	it('a resolved 500 is NOT offline: the 500 is returned, not the cached copy', async () => {
		await storeOnline(DB, PATH);
		const res = await entuFetch(DB, PATH, TOKEN, {}, online({ error: 'boom' }, 500));
		expect(res.status).toBe(500);
		expect(get(servedFromCache)).toBeNull();
	});
});

describe('reads only — a write never touches the cache', () => {
	for (const method of ['POST', 'DELETE']) {
		it(`an online ${method} writes nothing to the cache`, async () => {
			await entuFetch(DB, PATH, TOKEN, { method, body: '[]' }, online({ ok: true }));
			await flushReadCache();
			expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
		});

		it(`an online ${method} does not overwrite a cached GET for the same path`, async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2026-09-28T10:15:00.000Z'));
			await storeOnline(DB, PATH);
			vi.setSystemTime(new Date('2026-09-28T11:00:00.000Z'));
			await entuFetch(DB, PATH, TOKEN, { method, body: '[]' }, online({ written: true }));
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
				entuFetch(DB, PATH, TOKEN, { method, body: '[]' }, offline(err))
			).rejects.toBe(err);
			expect(get(servedFromCache)).toBeNull();
		});
	}

	it("method matching is case-insensitive: 'post' is a write too", async () => {
		await entuFetch(DB, PATH, TOKEN, { method: 'post', body: '[]' }, online({ ok: true }));
		await flushReadCache();
		expect(await readCacheGet(DB, PERSON_A, PATH)).toBeUndefined();
	});

	it("an explicit method 'GET' is a read", async () => {
		await entuFetch(DB, PATH, TOKEN, { method: 'GET' }, online());
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
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
		expect(get(servedFromCache)).toBeNull();
		expect(await readCacheGet(DB, PERSON_B, PATH)).toBeUndefined();
	});

	it("db X's entry is never served for db Y (same person id, same path)", async () => {
		signIn({ [DB]: PERSON_A, [OTHER_DB]: PERSON_A });
		await storeOnline(DB, PATH);

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(OTHER_DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
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
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
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
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
	});

	it("an entry stored while signed in is not served once there's no personId", async () => {
		await storeOnline(DB, PATH);
		authStore.set({ status: 'anonymous' });

		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
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
		const res = await entuFetch(DB, PATH, TOKEN, {}, offline());
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

		const res = await entuFetch(DB, PATH, TOKEN, {}, online());
		expect(await res.json()).toEqual(BODY);
		await flushReadCache();
	});

	it('caching disabled (null) and offline: the original error is rethrown', async () => {
		setReadCacheFactory(null);
		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, offline(err))).rejects.toBe(err);
	});
});

describe('integration — a real reader through entuFetch (library works list)', () => {
	it('listWorks, online then offline, returns the same works from the cache', async () => {
		const wire = {
			count: 1,
			entities: [
				{ _id: 'w1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Pärt' }] }
			]
		};
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-28T08:30:00.000Z'));
		const live = await listWorks({ db: DB, token: TOKEN } as never, online(wire));
		await flushReadCache();

		vi.setSystemTime(new Date('2026-09-28T13:00:00.000Z'));
		const cached = await listWorks({ db: DB, token: TOKEN } as never, offline());

		expect(cached).toEqual(live);
		expect(cached.items).toEqual([{ id: 'w1', name: 'Bogoróditse Djévo', composer: 'Pärt' }]);
		expect(get(servedFromCache)).toBe('2026-09-28T08:30:00.000Z');
	});
});

// (*MVOX:Tallis*)
