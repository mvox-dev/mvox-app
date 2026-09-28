// @vitest-environment happy-dom
//
// #434 slice 6/6 review F3 — the write gate is not `navigator.onLine` alone.
//
// The finding: on rehearsal-hall wifi with no uplink — the case #434's user
// story names — `navigator.onLine` is TRUE while every fetch rejects. The
// screen already knows: its reads came out of `$lib/entu/readCache` and it is
// showing an "as of" line. Gating writes on `navigator.onLine` alone left every
// control enabled there, so a tap reached the wire and the member got a generic
// write error instead of "No signal".
//
// CONTRACT:
//   writesAvailable ($lib/net/online) = online AND NOT readFellBackToCache
//   readFellBackToCache ($lib/net/cacheFallback) is written by readCache:
//     • set when a live GET rejects and the cache answers it in its place;
//     • cleared when a live read gets through (NOT a latch — one transient
//       fallback must not wedge writes off for the session);
//     • cleared at every load boundary (resetServedFromCache).
//   A store-only cached read (no serve half) never sets it.
import { IDBFactory } from 'fake-indexeddb';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Severs the $env/dynamic/public chain, same as readCache.spec.ts.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { CACHED_READ, CACHED_READ_STORE_ONLY, entuFetch } from '$lib/entu/request';
import {
	flushReadCache,
	resetServedFromCache,
	servedFromCache,
	setReadCacheFactory
} from '$lib/entu/readCache';
import { authStore } from '$lib/auth/session';
import { goOffline, goOnline, resetOnLine } from '$lib/testing/networkSignal';
import {
	clearReadFellBackToCache,
	noteReadFellBackToCache,
	readFellBackToCache
} from './cacheFallback';
import { online, writesAvailable } from './online';

const DB = 'sampledb';
const PERSON = 'person-a';
const PATH = 'entity?_type.string=work&props=name&limit=500';
const OTHER_PATH = 'entity?_type.string=member&props=name&limit=500';
const TOKEN = 'jwt-abc';
const BODY = { count: 1, entities: [{ _id: 'w1' }] };

function liveOk(body: unknown = BODY) {
	return vi.fn().mockImplementation(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		)
	);
}

function rejects(err: Error = new TypeError('Failed to fetch')) {
	return vi.fn().mockRejectedValue(err);
}

async function storeLive(path: string, options = CACHED_READ) {
	const res = await entuFetch(DB, path, TOKEN, {}, liveOk(), options);
	expect(res.ok).toBe(true);
	await flushReadCache();
}

let factory: IDBFactory;

beforeEach(async () => {
	factory = new IDBFactory();
	setReadCacheFactory(factory);
	resetServedFromCache();
	clearReadFellBackToCache();
	await goOnline();
	authStore.set({ status: 'authenticated', personIdByDb: { [DB]: PERSON }, expMs: Date.now() + 3_600_000 });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	setReadCacheFactory(undefined);
	resetServedFromCache();
	clearReadFellBackToCache();
	resetOnLine();
	authStore.set({ status: 'anonymous' });
});

describe('writesAvailable — the derivation', () => {
	it('online with reads reaching the network: writes are available', () => {
		expect(get(online)).toBe(true);
		expect(get(readFellBackToCache)).toBe(false);
		expect(get(writesAvailable)).toBe(true);
	});

	it('the browser says offline: writes are not available', async () => {
		await goOffline();
		expect(get(writesAvailable)).toBe(false);
	});

	it('the browser says ONLINE but reads fell back to the cache: writes are not available', () => {
		// The wifi-with-no-uplink case, stated as the two stores it comes down to.
		noteReadFellBackToCache();
		expect(get(online)).toBe(true);
		expect(get(writesAvailable)).toBe(false);
		clearReadFellBackToCache();
		expect(get(writesAvailable)).toBe(true);
	});

	it('follows the cache-fallback signal live while subscribed', async () => {
		const seen: boolean[] = [];
		const unsubscribe = writesAvailable.subscribe((v) => seen.push(v));
		await storeLive(PATH);
		await entuFetch(DB, PATH, TOKEN, {}, rejects(), CACHED_READ);
		expect(get(writesAvailable)).toBe(false);
		unsubscribe();
		expect(seen).toContain(false);
	});
});

describe('readFellBackToCache — written by the read path, not by the browser flag', () => {
	it('a live GET that rejects and is answered from the cache closes the write gate', async () => {
		await storeLive(PATH);
		expect(get(writesAvailable)).toBe(true);

		const served = await entuFetch(DB, PATH, TOKEN, {}, rejects(), CACHED_READ);

		expect(await served.json()).toEqual(BODY);
		// `navigator.onLine` never moved — this is the hall-wifi shape exactly.
		expect(get(online)).toBe(true);
		expect(get(servedFromCache)).not.toBeNull();
		expect(get(readFellBackToCache)).toBe(true);
		expect(get(writesAvailable)).toBe(false);
	});

	it('a later live read that gets through reopens the gate — one fallback does not wedge it', async () => {
		await storeLive(PATH);
		await entuFetch(DB, PATH, TOKEN, {}, rejects(), CACHED_READ);
		expect(get(writesAvailable)).toBe(false);

		const res = await entuFetch(DB, OTHER_PATH, TOKEN, {}, liveOk(), CACHED_READ);

		expect(res.ok).toBe(true);
		expect(get(readFellBackToCache)).toBe(false);
		expect(get(writesAvailable)).toBe(true);
	});

	it('the next load boundary clears it (resetServedFromCache is the load boundary)', async () => {
		await storeLive(PATH);
		await entuFetch(DB, PATH, TOKEN, {}, rejects(), CACHED_READ);
		expect(get(writesAvailable)).toBe(false);

		resetServedFromCache();

		expect(get(readFellBackToCache)).toBe(false);
		expect(get(writesAvailable)).toBe(true);
	});

	it('the browser flag still closes the gate on its own, cache or no cache', async () => {
		await goOffline();
		expect(get(readFellBackToCache)).toBe(false);
		expect(get(writesAvailable)).toBe(false);
	});

	it('a rejected read with NOTHING cached rethrows and leaves the gate open (no serve happened)', async () => {
		const err = new TypeError('Failed to fetch');
		await expect(entuFetch(DB, PATH, TOKEN, {}, rejects(err), CACHED_READ)).rejects.toBe(err);
		expect(get(readFellBackToCache)).toBe(false);
	});

	it('a store-only cached read that rejects never closes the gate — it has no serve half', async () => {
		await storeLive(PATH, CACHED_READ_STORE_ONLY);
		const err = new TypeError('Failed to fetch');

		await expect(
			entuFetch(DB, PATH, TOKEN, {}, rejects(err), CACHED_READ_STORE_ONLY)
		).rejects.toBe(err);

		expect(get(readFellBackToCache)).toBe(false);
	});

	it('an uncached GET touches neither half of the signal', async () => {
		await expect(entuFetch(DB, PATH, TOKEN, {}, rejects())).rejects.toThrow();
		expect(get(readFellBackToCache)).toBe(false);
	});

	it('a read from a SUPERSEDED load neither stamps an age nor closes the gate', async () => {
		await storeLive(PATH);
		let rejectLive: (reason: unknown) => void = () => undefined;
		const held = vi.fn(
			() => new Promise<Response>((_resolve, reject) => (rejectLive = reject))
		) as unknown as typeof fetch;
		const pending = entuFetch(DB, PATH, TOKEN, {}, held, CACHED_READ);

		// The next screen's load starts while this read is still in flight.
		resetServedFromCache();
		rejectLive(new TypeError('Failed to fetch'));
		await pending;

		expect(get(servedFromCache)).toBeNull();
		expect(get(readFellBackToCache)).toBe(false);
		expect(get(writesAvailable)).toBe(true);
	});

	it('a live success from a SUPERSEDED load cannot reopen the gate for the current one', async () => {
		await storeLive(PATH);
		let resolveLive: (res: Response) => void = () => undefined;
		const held = vi.fn(
			() => new Promise<Response>((resolve) => (resolveLive = resolve))
		) as unknown as typeof fetch;
		const pending = entuFetch(DB, OTHER_PATH, TOKEN, {}, held, CACHED_READ);

		// A new load starts, and ITS read falls back to the cache.
		resetServedFromCache();
		await entuFetch(DB, PATH, TOKEN, {}, rejects(), CACHED_READ);
		expect(get(writesAvailable)).toBe(false);

		resolveLive(new Response(JSON.stringify(BODY), { status: 200 }));
		await pending;
		await flushReadCache();

		expect(get(writesAvailable)).toBe(false);
	});
});

// (*MVOX:Josquin* — #434 slice 6 review F3)
