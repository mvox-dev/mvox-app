// #434 slice 3/6 RED — the event page's data entry point, and the opt-in fence
// around the shared reader it wraps.
//
// CONTRACT (see src/routes/event/[id]/page.offline.spec.ts's header for the
// whole slice):
//   - loadEventDetail(cfg, eventId, fetchImpl = fetch, opts = {}) — SHARED, so
//     its DEFAULT is uncached: no stored entry, and a rejection offline even
//     when a stored copy for the same key exists (the page's post-write refresh
//     must never paint a stored header as the result of a write).
//   - loadEventPageDetail(cfg, eventId, fetchImpl = fetch) — the screen's own
//     entry point, = loadEventDetail(..., CACHED_READ): every read it makes
//     (event, season, series, conductor profiles) is stored online and served
//     offline, giving the SAME EventDetail back.
//   - refreshEventPageDetail(cfg, eventId, fetchImpl = fetch) — slice 3 review
//     round, findings 1 and 2: the same reads STORE-ONLY. Online it stores
//     exactly what loadEventPageDetail would; offline it REJECTS and never
//     touches `servedFromCache`. Used by the two reads that are not what a
//     mounted screen is rendering — the agenda's next-event prefetch and this
//     page's own post-write refresh.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { authStore } from '$lib/auth/session';
import {
	flushReadCache,
	readCacheEntryCount,
	resetServedFromCache,
	servedFromCache,
	setReadCacheFactory
} from '$lib/entu/readCache';
import { get } from 'svelte/store';
import { loadEventDetail } from './eventDetail';
import { loadEventPageDetail, refreshEventPageDetail } from './eventPageData';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DB = 'sampledb';
const PERSON = 'person-1';
const CFG = { db: DB, token: 'tok-1' };

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function online() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('entity/ev-1?')) {
			return json({
				entity: {
					_id: 'ev-1',
					event_name: [{ string: 'Tuesday rehearsal' }],
					event_type: [{ string: 'rehearsal' }],
					start_datetime: [{ datetime: '2026-10-06T15:00:00.000Z' }],
					_parent: [
						{ reference: 'season-1', entity_type: 'season' },
						{ reference: 'series-1', entity_type: 'event_series' }
					]
				}
			});
		}
		if (url.includes('entity/season-1?')) {
			return json({ entity: { _id: 'season-1', conductor: [{ reference: 'p-cond' }] } });
		}
		if (url.includes('entity/series-1?')) {
			return json({
				entity: {
					_id: 'series-1',
					duration_minutes: [{ number: 90 }],
					default_location: [{ string: 'Kaarli kirik' }]
				}
			});
		}
		if (url.includes('_type.string=profile') && url.includes('_parent.reference=p-cond')) {
			return json({
				count: 1,
				entities: [
					{ _id: 'prof-cond', name: [{ string: 'Anna Dirigent' }], _sharing: [{ string: 'domain' }] }
				]
			});
		}
		return json({ count: 0, entities: [] });
	});
}

function offline() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

beforeEach(() => {
	setReadCacheFactory(new IDBFactory());
	resetServedFromCache();
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: Date.now() + 3_600_000
	});
});

afterEach(() => {
	setReadCacheFactory(undefined);
	authStore.set({ status: 'anonymous' });
});

describe('#434 slice 3 — loadEventDetail (shared) stays uncached by default', () => {
	it('the default call stores nothing', async () => {
		const detail = await loadEventDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		expect(detail.name).toBe('Tuesday rehearsal');
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('the default call REJECTS offline even with a stored copy of the same reads', async () => {
		await loadEventPageDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBeGreaterThan(0);
		await expect(
			loadEventDetail(CFG, 'ev-1', offline() as unknown as typeof fetch)
		).rejects.toThrow('Failed to fetch');
	});
});

describe('#434 slice 3 — loadEventPageDetail is cache-backed for every read it makes', () => {
	it('stores the event, season, series and conductor-profile reads online', async () => {
		await loadEventPageDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		await flushReadCache();
		// event + season + series + one conductor profile read. (The real-names
		// overlay reads are not part of this slice; they degrade to profile names.)
		expect(await readCacheEntryCount()).toBeGreaterThanOrEqual(4);
	});

	it('offline, returns the SAME detail it returned online, and marks it served from cache', async () => {
		const live = await loadEventPageDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		expect(live.conductorNames).toEqual(['Anna Dirigent']);
		expect(live.location).toBe('Kaarli kirik');
		await flushReadCache();
		resetServedFromCache();
		expect(get(servedFromCache)).toBeNull();

		const stored = await loadEventPageDetail(CFG, 'ev-1', offline() as unknown as typeof fetch);
		expect(stored).toEqual(live);
		expect(get(servedFromCache)).not.toBeNull();
	});
});

// #434 slice 3 review round, findings 1 and 2.
describe('#434 slice 3 — refreshEventPageDetail stores without ever serving', () => {
	it('stores every read online, exactly as loadEventPageDetail does', async () => {
		const detail = await refreshEventPageDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		expect(detail.name).toBe('Tuesday rehearsal');
		await flushReadCache();
		expect(await readCacheEntryCount()).toBeGreaterThanOrEqual(4);
	});

	it('REJECTS offline even with a stored copy, and leaves servedFromCache null', async () => {
		await loadEventPageDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBeGreaterThan(0);
		resetServedFromCache();

		await expect(
			refreshEventPageDetail(CFG, 'ev-1', offline() as unknown as typeof fetch)
		).rejects.toThrow('Failed to fetch');
		// The whole point: a read that is not what the screen renders cannot put
		// an "as of <time>" line on it.
		expect(get(servedFromCache)).toBeNull();
	});

	it('a post-write refresh moves the STORED header forward, so a later offline visit shows the write', async () => {
		// Before the write: no name of its own, so the header inherits nothing
		// but the series duration/location.
		const preWrite = online();
		await loadEventPageDetail(CFG, 'ev-1', preWrite as unknown as typeof fetch);
		await flushReadCache();

		// The write landed; the post-write re-read sees the new name.
		// `online()` routes on the URL alone, so no `init` is threaded here.
		const postWrite = vi.fn(async (input: RequestInfo | URL) => {
			const url = urlOf(input);
			if (url.includes('entity/ev-1?')) {
				const res = await online()(input);
				const body = (await res.json()) as { entity: { event_name: { string: string }[] } };
				body.entity.event_name = [{ string: 'Thursday rehearsal' }];
				return json(body);
			}
			return online()(input);
		});
		const refreshed = await refreshEventPageDetail(
			CFG,
			'ev-1',
			postWrite as unknown as typeof fetch
		);
		expect(refreshed.name).toBe('Thursday rehearsal');
		await flushReadCache();

		// Offline, the SCREEN's own reader now serves the post-write header — not
		// the pre-write one the refresh used to leave behind.
		const offlineDetail = await loadEventPageDetail(
			CFG,
			'ev-1',
			offline() as unknown as typeof fetch
		);
		expect(offlineDetail.name).toBe('Thursday rehearsal');
	});

	it('the event page wires its post-write refresh through this function, not the serving one', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/event/[id]/+page.svelte'),
			'utf-8'
		);
		expect(source).toContain('refreshEventPageDetail');
		// The shared uncached reader is no longer called from the page at all.
		expect(source).not.toMatch(/await loadEventDetail\(/);
	});

	it('the agenda wires its next-event prefetch through this function, not the serving one', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf-8');
		expect(source).toContain('refreshEventPageDetail(cfg, nextEventId, fetch)');
		expect(source).not.toContain('loadEventPageDetail(');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin* — #434 slice 3 review round, findings 1 and 2)
