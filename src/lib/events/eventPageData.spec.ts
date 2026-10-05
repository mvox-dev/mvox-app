// The event page's data entry points: the shared reader stays uncached by default, the
// screen's reader stores and serves, and the refresh twins store without serving.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

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
import {
	loadEventPageDetail,
	loadEventPageWorkRows,
	refreshEventPageDetail,
	refreshEventPageWorkRows
} from './eventPageData';
import { loadWorksByEventId } from '$lib/repertoire/workRows';
import { refetchWorkRows } from '$lib/repertoire/refetchWorkRows';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const DB = 'sampledb';
const PERSON = 'person-1';
const CFG = testCfg(DB, 'tok-1');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

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
			}, 200, JSON_HEADERS);
		}
		if (url.includes('entity/season-1?')) {
			return json({ entity: { _id: 'season-1', conductor: [{ reference: 'p-cond' }] } }, 200, JSON_HEADERS);
		}
		if (url.includes('entity/series-1?')) {
			return json({
				entity: {
					_id: 'series-1',
					duration_minutes: [{ number: 90 }],
					default_location: [{ string: 'Kaarli kirik' }]
				}
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=profile') && url.includes('_parent.reference=p-cond')) {
			return json({
				count: 1,
				entities: [
					{ _id: 'prof-cond', name: [{ string: 'Anna Dirigent' }], _sharing: [{ string: 'domain' }] }
				]
			}, 200, JSON_HEADERS);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
	});
}

/** Real names ON and a conductor named only by her admin_member_record: offline, losing
 *  the overlay would drop her from the header, not rename her. */
function onlineRealNames() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: 'db-1' }] }, 200, JSON_HEADERS);
		}
		if (url.includes('entity/db-1?')) {
			return json({
				entity: { _id: 'db-1', roster_show_real_names: [{ _id: 'v-1', boolean: true }] }
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=admin_member_record')) {
			return json({
				count: 1,
				entities: [
					{ _id: 'rec-1', person: [{ reference: 'p-cond' }], name: [{ string: 'Anna Päts' }] }
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=profile') && url.includes('_parent.reference=p-cond')) {
			return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
		}
		return online()(input);
	});
}

/** Every read one `loadEventPageDetail` stores against `online()`, exact: event, season,
 *  series, conductor profile, and the overlay's database-entity probe. */
const CACHED_READS_PER_LOAD = 5;

/** The works read's fixture: three collective-wide label lookups plus this event's
 *  program_item list; the event is programmed, so the season fallback is never read. */
function onlineWorks(
	programme: Array<Record<string, unknown>> = [
		{
			_id: 'pi-1',
			name: [{ string: 'Ave Maria' }],
			edition: [{ reference: 'ed-1' }],
			ordinal: [{ number: 1 }]
		}
	]
) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=work&')) {
			return json({
				count: 1,
				entities: [
					{ _id: 'work-1', name: [{ string: 'Ave Maria' }], composer: [{ string: 'Arvo Pärt' }] }
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=edition&')) {
			return json({
				count: 1,
				entities: [
					{
						_id: 'ed-1',
						name: [{ string: 'Urtext' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }],
						file: [
							{
								_id: 'file-1',
								filename: 'ave-maria.pdf',
								filesize: 1234,
								filetype: 'application/pdf'
							}
						]
					}
				]
			}, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=copy&')) {
			return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
		}
		if (url.includes('_type.string=program_item') && url.includes('_parent.reference=ev-1')) {
			return json({ count: programme.length, entities: programme }, 200, JSON_HEADERS);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
	});
}

/** Work + edition + copy + this event's program_item list, and nothing else. */
const CACHED_WORKS_READS_PER_LOAD = 4;

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
	vi.unstubAllGlobals();
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
		// Exact, not a lower bound: a new cached read has to be accounted for on purpose.
		expect(await readCacheEntryCount()).toBe(CACHED_READS_PER_LOAD);
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

	// The real-names overlay is threaded: offline it must not rename or drop the conductor.
	it('offline, a conductor named only by her admin_member_record keeps that name', async () => {
		const live = await loadEventPageDetail(
			CFG,
			'ev-1',
			onlineRealNames() as unknown as typeof fetch
		);
		expect(live.conductorNames).toEqual(['Anna Päts']);
		await flushReadCache();
		resetServedFromCache();

		const stored = await loadEventPageDetail(CFG, 'ev-1', offline() as unknown as typeof fetch);
		// The same name: an un-threaded overlay would drop a conductor with no profile name.
		expect(stored.conductorNames).toEqual(live.conductorNames);
		expect(stored).toEqual(live);
		expect(get(servedFromCache)).not.toBeNull();
	});
});

describe('#434 slice 3 — refreshEventPageDetail stores without ever serving', () => {
	it('stores every read online, exactly as loadEventPageDetail does', async () => {
		const detail = await refreshEventPageDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		expect(detail.name).toBe('Tuesday rehearsal');
		await flushReadCache();
		// Exactly what `loadEventPageDetail` stores: a lower bound cannot prove "the same".
		expect(await readCacheEntryCount()).toBe(CACHED_READS_PER_LOAD);
	});

	it('REJECTS offline even with a stored copy, and leaves servedFromCache null', async () => {
		await loadEventPageDetail(CFG, 'ev-1', online() as unknown as typeof fetch);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBeGreaterThan(0);
		resetServedFromCache();

		await expect(
			refreshEventPageDetail(CFG, 'ev-1', offline() as unknown as typeof fetch)
		).rejects.toThrow('Failed to fetch');
		// A read the screen does not render cannot put an as-of line on it.
		expect(get(servedFromCache)).toBeNull();
	});

	it('a post-write refresh moves the STORED header forward, so a later offline visit shows the write', async () => {
		const preWrite = online();
		await loadEventPageDetail(CFG, 'ev-1', preWrite as unknown as typeof fetch);
		await flushReadCache();

		// The write landed; the post-write re-read sees the new name.
		const postWrite = vi.fn(async (input: RequestInfo | URL) => {
			const url = urlOf(input);
			if (url.includes('entity/ev-1?')) {
				const res = await online()(input);
				const body = (await res.json()) as { entity: { event_name: { string: string }[] } };
				body.entity.event_name = [{ string: 'Thursday rehearsal' }];
				return json(body, 200, JSON_HEADERS);
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

		// Offline, the screen's own reader serves the post-write header.
		const offlineDetail = await loadEventPageDetail(
			CFG,
			'ev-1',
			offline() as unknown as typeof fetch
		);
		expect(offlineDetail.name).toBe('Thursday rehearsal');
	});
});

// The works read's store-only twin.
describe('#434 slice 5 — refreshEventPageWorkRows stores without ever serving', () => {
	it('the shared loadWorksByEventId still stores nothing by default', async () => {
		const rows = await loadWorksByEventId(
			CFG,
			['ev-1'],
			'season-1',
			onlineWorks() as unknown as typeof fetch
		);
		expect(rows['ev-1']?.map((r) => r.workName)).toEqual(['Ave Maria']);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(0);
	});

	it('stores every read online, exactly as loadEventPageWorkRows does', async () => {
		const rows = await refreshEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			onlineWorks() as unknown as typeof fetch
		);
		expect(rows['ev-1']?.map((r) => r.workName)).toEqual(['Ave Maria']);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(CACHED_WORKS_READS_PER_LOAD);
	});

	it('REJECTS offline even with a stored copy, and leaves servedFromCache null', async () => {
		await loadEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			onlineWorks() as unknown as typeof fetch
		);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(CACHED_WORKS_READS_PER_LOAD);
		resetServedFromCache();

		await expect(
			refreshEventPageWorkRows(CFG, ['ev-1'], 'season-1', offline() as unknown as typeof fetch)
		).rejects.toThrow('Failed to fetch');
		expect(get(servedFromCache)).toBeNull();
	});

	// Parts prefetched from the agenda must find a stored works read offline, or the event
	// page renders an empty repertoire section.
	it('the agenda-side warm-up is what lets the event page restore its works list offline', async () => {
		const live = await refreshEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			onlineWorks() as unknown as typeof fetch
		);
		await flushReadCache();
		resetServedFromCache();

		const stored = await loadEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			offline() as unknown as typeof fetch
		);
		// The same rows: a row restored without `fileId` has no door to the file.
		expect(stored).toEqual(live);
		expect(stored['ev-1']?.map((r) => r.fileId)).toEqual(['file-1']);
		// The store-only warm-up never claims an age; the screen's serving read does.
		expect(get(servedFromCache)).not.toBeNull();
	});

	// The post-write re-read.
	it('a post-write refresh moves the STORED rows forward, so a later offline visit shows the write', async () => {
		await loadEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			onlineWorks() as unknown as typeof fetch
		);
		await flushReadCache();

		const afterWrite = onlineWorks([
			{
				_id: 'pi-1',
				name: [{ string: 'Ave Maria' }],
				edition: [{ reference: 'ed-1' }],
				ordinal: [{ number: 1 }]
			},
			{
				_id: 'pi-2',
				name: [{ string: 'Ave Maria' }],
				edition: [{ reference: 'ed-1' }],
				ordinal: [{ number: 2 }]
			}
		]);
		const refreshed = await refreshEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			afterWrite as unknown as typeof fetch
		);
		expect(refreshed['ev-1']).toHaveLength(2);
		await flushReadCache();

		// Offline, the screen's own reader serves the post-write programme.
		const stored = await loadEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			offline() as unknown as typeof fetch
		);
		expect(stored['ev-1']?.map((r) => r.id)).toEqual(['pi-1', 'pi-2']);
	});

	it('refetchWorkRows, the re-read both pages run after a write, stores and never serves', async () => {
		vi.stubGlobal('fetch', onlineWorks());
		const rows = await new Promise<Record<string, unknown[]>>((resolve, reject) =>
			refetchWorkRows(CFG, ['ev-1'], 'season-1', {
				includeInactive: false,
				isCurrent: () => true,
				onRows: resolve,
				onFailure: () => reject(new Error('refetch failed online'))
			})
		);
		expect(rows['ev-1']).toHaveLength(1);
		await flushReadCache();
		expect(await readCacheEntryCount()).toBe(CACHED_WORKS_READS_PER_LOAD);
		resetServedFromCache();

		vi.stubGlobal('fetch', offline());
		await new Promise<void>((resolve, reject) =>
			refetchWorkRows(CFG, ['ev-1'], 'season-1', {
				includeInactive: false,
				isCurrent: () => true,
				onRows: () => reject(new Error('served a stored copy')),
				onFailure: resolve
			})
		);
		expect(get(servedFromCache)).toBeNull();
	});
});

// (*MVOX:Tallis*)
