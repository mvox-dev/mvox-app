// The event page's data entry points: the shared reader stays uncached by default, the
// screen's reader stores and serves, and the refresh twins store without serving.
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
import {
	loadEventPageDetail,
	loadEventPageWorkRows,
	refreshEventPageDetail,
	refreshEventPageWorkRows
} from './eventPageData';
import { loadWorksByEventId } from '$lib/repertoire/workRows';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { surfacesUnder } from '$lib/testing/svelteSurfaces';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const EVENT_SURFACES = surfacesUnder('src/routes/event/', 'src/lib/events/');

describe('the derived event surfaces', () => {
	it('the derived EVENT_SURFACES list is not empty (a moved folder would scan nothing)', () => {
		expect(EVENT_SURFACES.length).toBeGreaterThanOrEqual(8);
	});
});

const eventSurfacesSource = () =>
	EVENT_SURFACES.map((file) => readFileSync(resolve(process.cwd(), file), 'utf-8')).join('\n');

const AGENDA_SOURCE = () =>
	[
		'src/routes/+page.svelte',
		'src/lib/agenda/agendaLoad.ts',
		'src/lib/agenda/agendaRosterCache.ts',
		'src/lib/agenda/agendaSelectedLoad.ts',
		'src/lib/agenda/agendaWorksLoad.ts',
		'src/lib/agenda/agendaRowStore.ts',
		'src/lib/agenda/agendaPanels.ts',
		'src/lib/repertoire/refetchWorkRows.ts'
	]
		.map((p) => readFileSync(resolve(process.cwd(), p), 'utf-8'))
		.join('\n');

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

	it('the event page wires its post-write refresh through this function, not the serving one', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/event/[id]/+page.svelte'),
			'utf-8'
		);
		expect(source).toContain('refreshEventPageDetail');
		expect(eventSurfacesSource()).not.toMatch(/await loadEventDetail\(/);
	});

	it('the agenda wires its next-event prefetch through this function, not the serving one', () => {
		const source = AGENDA_SOURCE();
		expect(source).toContain('refreshEventPageDetail(cfg, nextEventId, fetch)');
		expect(source).not.toContain('loadEventPageDetail(');
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

	it("the agenda's own works reads go through the store-only entry point, with no separate warm-up", () => {
		const source = AGENDA_SOURCE();
		expect(source).toContain('refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {');
		expect(source).not.toContain('refreshEventPageWorkRows(cfg, [nextEventId]');
		// The as-of line here is the agenda's own claim, so never the serving reader.
		expect(source).not.toContain('loadEventPageWorkRows(');
		expect(source).not.toMatch(/loadWorksByEventId\(/);
	});

	it('the event page wires BOTH its works reads through eventPageData, not the shared reader', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/event/[id]/+page.svelte'),
			'utf-8'
		);
		const works = readFileSync(
			resolve(process.cwd(), 'src/lib/events/EventWorksSection.svelte'),
			'utf-8'
		);
		expect(source).toContain('loadEventPageWorkRows(cfg, [loaded.id], sid, fetch, {');
		const refetch = readFileSync(
			resolve(process.cwd(), 'src/lib/repertoire/refetchWorkRows.ts'),
			'utf-8'
		);
		expect(works).toContain('refetchWorkRows(cfg, [evId], seasonId, {');
		expect(refetch).toContain('refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {');
		// Not imported at all any more, so neither read can drift off the store.
		expect(eventSurfacesSource()).not.toMatch(/loadWorksByEventId\s*\}/);
		expect(eventSurfacesSource()).not.toMatch(/loadWorksByEventId\(/);
	});
});

// (*MVOX:Tallis*)
