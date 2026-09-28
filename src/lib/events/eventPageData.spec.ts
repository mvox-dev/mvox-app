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
//   - the SAME pair over the WORKS read (slice 5, and its review round findings
//     1 and 2): loadEventPageWorkRows(cfg, eventIds, seasonId, fetchImpl, opts)
//     for the mounted screen, refreshEventPageWorkRows(...) store-only for the
//     agenda's next-event warm-up and this page's post-write re-read. The shared
//     loadWorksByEventId underneath them stays uncached by default.
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

/**
 * Slice 3 review round, finding 1 — the same event, but the collective has
 * `roster_show_real_names` ON and its conductor is named ONLY by her
 * `admin_member_record`: no profile entity at all, so there is no
 * domain-or-public profile name to degrade to. Online the header names her; the
 * overlay losing its reads offline would not rename her, it would DROP her (the
 * `conductorNames` filter removes the empty string).
 */
function onlineRealNames() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: 'db-1' }] });
		}
		if (url.includes('entity/db-1?')) {
			return json({
				entity: { _id: 'db-1', roster_show_real_names: [{ _id: 'v-1', boolean: true }] }
			});
		}
		if (url.includes('_type.string=admin_member_record')) {
			return json({
				count: 1,
				entities: [
					{ _id: 'rec-1', person: [{ reference: 'p-cond' }], name: [{ string: 'Anna Päts' }] }
				]
			});
		}
		// Her profile read answers "no profile", so `domainOrPublicName` is ''.
		if (url.includes('_type.string=profile') && url.includes('_parent.reference=p-cond')) {
			return json({ count: 0, entities: [] });
		}
		return online()(input);
	});
}

/**
 * Every read ONE `loadEventPageDetail` stores against the `online()` fixture —
 * exact, because the number is knowable and it is the interesting one (finding
 * 4): the event entity, its parent season, its parent series, the conductor's
 * profile read, and the real-names overlay's `resolveDatabaseEntityId` (which
 * this fixture answers with an empty list — a 200, so it is stored — leaving the
 * overlay to degrade before it reaches its toggle or records read).
 */
const CACHED_READS_PER_LOAD = 5;

/**
 * Slice 5 review round, findings 1 and 2 — the WORKS read's own fixture: the
 * three collective-wide label lookups `loadWorksByEventId` makes (work, edition,
 * copy) plus this event's `program_item` list. The event IS programmed, so the
 * season-repertoire fallback is never read — which is why the count below holds
 * whatever `seasonId` a caller passes.
 *
 * `programme` is the wire shape of the event's program_items, so a test can hand
 * the "after the write" list to a second call.
 */
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
			});
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
			});
		}
		if (url.includes('_type.string=copy&')) {
			return json({ count: 0, entities: [] });
		}
		if (url.includes('_type.string=program_item') && url.includes('_parent.reference=ev-1')) {
			return json({ count: programme.length, entities: programme });
		}
		return json({ count: 0, entities: [] });
	});
}

/** Exact, for the same reason CACHED_READS_PER_LOAD is: work + edition + copy +
 *  this event's program_item list, and nothing else. */
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
		// EXACT, not a lower bound (slice 3 review round, finding 4): a lenient
		// `>= 4` passes just as happily when a read that must NOT be cached starts
		// being one, which is the single thing this assertion is here to catch.
		// Any new cached read has to be accounted for here on purpose.
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

	// Slice 3 review round, finding 1 — the real-names overlay is threaded, not
	// excluded. With the toggle ON its degrade is not "lose a decoration", it is
	// "show a different name", and for a conductor with no domain/public profile
	// name it is "show no conductor at all".
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
		// Not merely non-empty: the SAME name. An un-threaded overlay gives [] here
		// (she has no profile name to fall back to) — an offline header with no
		// conductor where the online one named her.
		expect(stored.conductorNames).toEqual(live.conductorNames);
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
		// Exactly what `loadEventPageDetail` stores — same reads, same count
		// (finding 4): "exactly as loadEventPageDetail does" is the claim, and a
		// lower bound cannot make it.
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

// #434 slice 5 review round, findings 1 and 2 — the works read's store-only twin.
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

	// Finding 1 — the whole slice's Done-when, in the case #409 creates: the part
	// bytes are prefetched while she is on the AGENDA, and until this warm-up
	// existed the event page's works read had nothing stored to restore from, so
	// offline it fell into its own `.catch` and rendered an EMPTY repertoire
	// section — the part on the device, and /downloads the only door to it.
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
		// The SAME rows, not merely non-empty: the part link the row carries is
		// `fileId`, so a row restored without it is a row with no door to the file.
		expect(stored).toEqual(live);
		expect(stored['ev-1']?.map((r) => r.fileId)).toEqual(['file-1']);
		// The store-only warm-up itself never claimed an age; the SCREEN's own
		// serving read is what sets it.
		expect(get(servedFromCache)).not.toBeNull();
	});

	// Finding 2 — the post-write re-read.
	it('a post-write refresh moves the STORED rows forward, so a later offline visit shows the write', async () => {
		await loadEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			onlineWorks() as unknown as typeof fetch
		);
		await flushReadCache();

		// She adds a second piece to tonight's programme; the post-write re-read
		// sees both.
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

		// Offline, the SCREEN's own reader serves the POST-write programme — not
		// the pre-write one the uncached re-read used to leave behind.
		const stored = await loadEventPageWorkRows(
			CFG,
			['ev-1'],
			'season-1',
			offline() as unknown as typeof fetch
		);
		expect(stored['ev-1']?.map((r) => r.id)).toEqual(['pi-1', 'pi-2']);
	});

	it('the agenda wires a works warm-up beside its next-event detail prefetch', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf-8');
		expect(source).toContain('refreshEventPageWorkRows(cfg, [nextEventId], currentSeasonId, fetch)');
		// Store-only, never the serving entry point: `servedFromCache` on this page
		// is the AGENDA's own as-of claim.
		expect(source).not.toContain('loadEventPageWorkRows(');
	});

	it('the event page wires BOTH its works reads through eventPageData, not the shared reader', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/event/[id]/+page.svelte'),
			'utf-8'
		);
		expect(source).toContain('loadEventPageWorkRows(cfg, [loaded.id], sid, fetch, {');
		expect(source).toContain('refreshEventPageWorkRows(cfg, [evId], seasonId, fetch, {');
		// Not imported at all any more, so neither read can drift off the store.
		expect(source).not.toMatch(/loadWorksByEventId\s*\}/);
		expect(source).not.toMatch(/loadWorksByEventId\(/);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin* — #434 slice 3 review round, findings 1 and 2)
// (*MVOX:Josquin* — #434 slice 3 review round 2, findings 1-4)
// (*MVOX:Josquin* — #434 slice 5 review round, findings 1-3)
