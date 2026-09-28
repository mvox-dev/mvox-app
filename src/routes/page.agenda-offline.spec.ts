// @vitest-environment happy-dom
//
// #434 slice 2/6 RED — the agenda, offline, from the read cache, with "as of".
//
// CONTRACT (team-lead shared design, fixed for all six slices):
//   - The copy lives in the app ($lib/entu/readCache, IndexedDB
//     'mvox-read-cache'), never the service worker. A CALL SITE opts in with
//     CACHED_READ (review round finding 2: the flag is an argument, never
//     hard-wired inside a shared reader); slice 2 opts in the AGENDA's own path
//     — collective discovery (discover.ts) and `loadFullAgenda` -> listSeasons /
//     resolveDatabaseEntityId / listEvents — so a start with no network renders
//     the agenda it last saw instead of the `collectives.status === 'error'`
//     branch.
//   - The agenda branch carries its OWN /downloads door
//     (agenda-downloads-link-cached), because reaching 'ready' offline is
//     exactly what takes the singer off the error branch that used to hold the
//     only link to her downloaded parts (review round finding 1).
//   - Offline = every fetch REJECTS. The page then shows the same rows it
//     showed online, plus a visible line `data-testid="agenda-as-of"` whose
//     text is m.agenda_as_of({ time }) — time via tallinnHHMM (the one shared
//     instant->'HH:MM' formatter), date added only when the stored read is
//     not from today.
//   - `servedFromCache` is a monotone minimum: the page calls
//     resetServedFromCache() when its load starts, so an online load shows NO
//     as-of line.
//
// INTEGRATION, NOT ISOLATION: nothing between the page and `fetch` is mocked —
// the REAL hydrateCollectives -> discoverCollectives -> checkCollectiveMarker,
// the REAL loadFullAgenda -> listSeasons/listEvents, the REAL entuFetch and
// readCache over fake-indexeddb. Only `globalThis.fetch` is stubbed: an online
// router first, then a stub that rejects every call. Every other agenda-page
// read (rsvp, attendance, works, rights) runs for real too and simply fails
// offline — the agenda rows must survive that.
import { IDBFactory } from 'fake-indexeddb';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { msgProxy } = vi.hoisted(() => ({
	msgProxy: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_t, key) => (params?: Record<string, unknown>) =>
			params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/messages.js', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/messages', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache, resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { tallinnHHMM } from '$lib/preferences/timeFormat';

const DB = 'sampledb';
const PERSON = 'person-1';
const DB_ENTITY = 'db-entity-1';
const SEASON = 'season-1';

// A fixed "today" (only Date is faked — IndexedDB and waitFor keep real timers).
// 07:05Z is 10:05 in Tallinn (EEST), so the as-of time is unmistakable.
const READ_AT = new Date('2026-09-28T07:05:00.000Z');
const LATER_SAME_DAY = new Date('2026-09-28T09:40:00.000Z');
const NEXT_DAY = new Date('2026-09-29T08:00:00.000Z');

const EVENTS = [
	{ id: 'ev-1', name: 'Tuesday rehearsal', start: '2026-10-06T15:00:00.000Z' },
	{ id: 'ev-2', name: 'Autumn concert', start: '2026-10-18T14:00:00.000Z' }
];

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** The online Entu, answering the agenda's reads by path; everything else empty. */
function onlineEntu() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (url.includes('_type.string=mvox_collective')) {
			return json({ count: 1, entities: [{ _id: 'marker-1', name: [{ string: 'Sample Choir' }] }] });
		}
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: DB_ENTITY }] });
		}
		if (url.includes('_type.string=season')) {
			return json({
				count: 1,
				entities: [
					{
						_id: SEASON,
						name: [{ string: '2026/27' }],
						start_date: [{ date: '2026-09-01' }],
						end_date: [{ date: '2027-06-30' }]
					}
				]
			});
		}
		if (url.includes('_type.string=event&')) {
			return json({
				count: EVENTS.length,
				entities: EVENTS.map((e) => ({
					_id: e.id,
					event_name: [{ string: e.name }],
					start_datetime: [{ datetime: e.start }],
					duration_minutes: [{ number: 90 }],
					_parent: [{ reference: SEASON, entity_type: 'season' }]
				}))
			});
		}
		return json({ count: 0, entities: [] });
	});
}

function offlineEntu() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

/** Cold start: discovery via the store's own entry point, then mount. */
async function coldStart() {
	collectiveState.set({ status: 'loading' });
	await hydrateCollectives();
	return render(Page);
}

async function expectAgendaRows(container: HTMLElement) {
	await waitFor(() => {
		for (const e of EVENTS) {
			const row = container.querySelector(`[data-testid="agenda-row-${e.id}"]`);
			expect(row, `row ${e.id}`).not.toBeNull();
			expect(row!.textContent).toContain(e.name);
		}
	});
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: READ_AT });
	setReadCacheFactory(new IDBFactory());
	// #343's part byte store (next-event prefetch, file presence) opens the
	// global IndexedDB on this page too — a separate, fresh one, so its reads
	// resolve instead of logging a missing global.
	vi.stubGlobal('indexedDB', new IDBFactory());
	resetServedFromCache();
	localStorage.clear();
	setToken('tok-1');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB]: PERSON },
		expMs: READ_AT.getTime() + 48 * 3_600_000
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	clearAll({ preserveProvider: false });
	setReadCacheFactory(undefined);
});

describe('#434 slice 2 — the agenda renders offline from the read cache', () => {
	// #434 slice 3 review round, finding 1 — the agenda's "as of" line is its own
	// claim about its own rows, and `servedFromCache` is ONE store. Slice 3 added
	// a fire-and-forget prefetch of the NEXT EVENT's detail reads to this page;
	// cache-backed, on a flapping connection those reads reject, serve stored
	// copies and stamp their age onto the agenda — over rows that all came back
	// live, for data this page never renders.
	//
	// Position-independent (slice 3 review round, finding 2). This test used to
	// carry a "KEEP THIS FIRST" note: the offline loads below leave read chains in
	// flight that outlive their own test (an unmounted page's retention sweep and
	// prefetch keep resolving), and a `readCacheGet` already awaiting the previous
	// test's IDBFactory when `beforeEach` swaps in a fresh one still served from
	// the OLD database — landing a foreign as-of on whatever test was running by
	// then. That leak is now closed at the seam instead: `setReadCacheFactory`
	// bumps a generation counter, and a read whose generation has moved serves
	// nothing and stamps nothing (readCache.ts's `factoryGeneration`).
	it('the next-event detail prefetch rejecting does NOT age-stamp a fully live agenda', async () => {
		// Warm the store online, so the prefetch's own reads have a stored copy
		// to be tempted by.
		const firstOnline = onlineEntu();
		vi.stubGlobal('fetch', firstOnline);
		const first = await coldStart();
		await expectAgendaRows(first.container);
		await waitFor(() => {
			const urls = firstOnline.mock.calls.map((c) => urlOf(c[0] as RequestInfo | URL));
			expect(urls.some((u) => u.includes(`entity/${EVENTS[0].id}?`)), 'prefetch ran').toBe(true);
		});
		await flushReadCache();
		cleanup();

		// A flapping connection: the AGENDA's own reads all succeed; only the
		// next event's detail read rejects.
		vi.setSystemTime(LATER_SAME_DAY);
		const live = onlineEntu();
		let detailRejections = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL) => {
				if (urlOf(input).includes(`entity/${EVENTS[0].id}?`)) {
					detailRejections += 1;
					return Promise.reject(new TypeError('Failed to fetch'));
				}
				// `init` is deliberately dropped: `onlineEntu` routes on the URL
				// alone, exactly as the other tests here use it.
				return live(input);
			})
		);

		const { container } = await coldStart();
		await expectAgendaRows(container);
		await waitFor(() => {
			expect(detailRejections, 'the prefetch read rejected').toBeGreaterThan(0);
		});
		await flushReadCache();

		// Every row on screen is live, so there is nothing to be "as of".
		expect(container.querySelector('[data-testid="agenda-as-of"]')).toBeNull();
		// And the offline door gated on the same store stays shut.
		expect(container.querySelector('[data-testid="agenda-downloads-link-cached"]')).toBeNull();
	});

	it('an online load shows the agenda rows and NO as-of line', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await coldStart();
		await expectAgendaRows(container);
		expect(container.querySelector('[data-testid="agenda-as-of"]')).toBeNull();
		// The cached-branch /downloads door rides the same gate: online, the rows'
		// own part links are live and this second door is not rendered.
		expect(
			container.querySelector('[data-testid="agenda-downloads-link-cached"]')
		).toBeNull();
	});

	it('online, then every fetch rejecting: the same rows, plus "as of" the stored read time', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const first = await coldStart();
		await expectAgendaRows(first.container);
		await flushReadCache();
		cleanup();

		// Later the same day, no network at all.
		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await coldStart();

		// Collective discovery was served from the cache, so the agenda branch
		// renders — not the 'error' branch a cold offline start fell to before.
		expect(container.querySelector('[data-testid="collectives-retry"]')).toBeNull();
		await expectAgendaRows(container);

		const asOf = await waitFor(() => {
			const el = container.querySelector('[data-testid="agenda-as-of"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(asOf.textContent).toContain('agenda_as_of');
		// The STORED read's time (10:05 Tallinn), not the offline load's (12:40).
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		expect(asOf.textContent).not.toContain(tallinnHHMM(LATER_SAME_DAY));
		// Same day: the time alone, no date.
		expect(asOf.textContent).toContain(`"time":"${tallinnHHMM(READ_AT)}"`);

		// Review round finding 1 — the door to the parts already on this device,
		// IN THE RENDERED CONTAINER (not merely present in the page source): this
		// branch is what a warm offline start shows, and the event rows' own part
		// links need reads that are not cached, so /downloads is the only way in.
		const door = container.querySelector('[data-testid="agenda-downloads-link-cached"]');
		expect(door, 'agenda-downloads-link-cached').not.toBeNull();
		expect(door!.getAttribute('href')).toBe('/downloads');
		// The cold-start branch is NOT what rendered — this is the other door.
		expect(container.querySelector('[data-testid="agenda-downloads-link"]')).toBeNull();
	});

	it('a stored read from an EARLIER day carries its date as well as its time', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const first = await coldStart();
		await expectAgendaRows(first.container);
		await flushReadCache();
		cleanup();

		vi.setSystemTime(NEXT_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await coldStart();
		await expectAgendaRows(container);
		const asOf = await waitFor(() => {
			const el = container.querySelector('[data-testid="agenda-as-of"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		// Not the bare time: a date rides with it.
		expect(asOf.textContent).not.toContain(`"time":"${tallinnHHMM(READ_AT)}"`);
	});

	it('a later ONLINE load after an offline one shows no as-of line (servedFromCache is reset at load start)', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const first = await coldStart();
		await expectAgendaRows(first.container);
		await flushReadCache();
		cleanup();

		vi.stubGlobal('fetch', offlineEntu());
		const second = await coldStart();
		await waitFor(() => {
			expect(second.container.querySelector('[data-testid="agenda-as-of"]')).not.toBeNull();
		});
		cleanup();

		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await coldStart();
		await expectAgendaRows(container);
		expect(container.querySelector('[data-testid="agenda-as-of"]')).toBeNull();
	});

	it('the page resets servedFromCache when its load starts, and reads it for the as-of line', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf-8');
		for (const needle of [
			'resetServedFromCache()',
			'$servedFromCache',
			'tallinnHHMM',
			'data-testid="agenda-as-of"',
			'data-testid="agenda-downloads-link-cached"'
		]) {
			expect(source.includes(needle), needle).toBe(true);
		}
	});
});

describe('#434 slice 2 — the as-of copy exists in all four locales', () => {
	it('agenda_as_of is a {time} message in en/et/lv/uk', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, string>;
			expect(messages.agenda_as_of, locale).toBeTypeOf('string');
			expect(messages.agenda_as_of, locale).toContain('{time}');
		}
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin* — #434 slice 3 review round 2, findings 1-4)
