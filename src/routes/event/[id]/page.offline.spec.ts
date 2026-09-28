// @vitest-environment happy-dom
//
// #434 slice 3/6 RED — the EVENT PAGE offline, and the NEXT event fetched ahead.
//
// CONTRACT (team-lead shared design, fixed for all six slices; slice-3 shape
// defined HERE, implemented in GREEN):
//
//   src/lib/events/eventDetail.ts
//     loadEventDetail(cfg, eventId, fetchImpl = fetch, opts: EntuFetchOptions = {})
//     — a SHARED reader (the page's post-write refresh calls it too), so it
//     hard-wires no flag (slice 2 review round, finding 2). It threads `opts`
//     into EVERY read it makes: the event entity, the parent season
//     (fetchSeason — conductor + season rights), the parent series
//     (fetchSeries — inherited name/duration/location/description), and each
//     conductor's profile read (profileData.listMyProfiles, which gains the same
//     `opts: EntuFetchOptions = {}` parameter). A header that comes back offline
//     with its conductor or its series-inherited location missing is a stored
//     copy rendered wrong, not a last-seen screen.
//
//   src/lib/events/eventPageData.ts (NEW — the screen's own entry point, the
//     same role agendaData.loadFullAgenda plays for the agenda)
//     export function loadEventPageDetail(cfg, eventId, fetchImpl = fetch)
//       = loadEventDetail(cfg, eventId, fetchImpl, CACHED_READ)
//     It is the ONE new file allowed to name CACHED_READ
//     (readCache.optin-fence.spec.ts's allowlist).
//
//   src/routes/event/[id]/+page.svelte
//     - `loadForSelected` loads through loadEventPageDetail, and calls
//       resetServedFromCache() when its load starts.
//     - When $servedFromCache is non-null, a visible line
//       data-testid="event-detail-as-of" carries the STORED read's time via
//       tallinnHHMM, plus its ISO date (isoDateFormatter('Europe/Tallinn'), as
//       the agenda does) when that read is not from today.
//
//   src/routes/+page.svelte (the agenda) — the #409/#410 next-event prefetch
//     (runPressureSweepThenPrefetch -> prefetchNextEventPartsAfterSettle) ALSO
//     calls loadEventPageDetail for agendaItems[0], so the next event's reads
//     land in the cache although she never opens it. NOTE: the fixtures below
//     give the next event NO parts — `nextEventFileIds` is empty — so the
//     detail prefetch must not sit behind that function's
//     `if (fileIds.length === 0) return;` early exit. An event with no music
//     attached is still an event she needs to find offline (time, place).
//
// INTEGRATION, NOT ISOLATION: nothing between the pages and `fetch` is mocked —
// the REAL hydrateCollectives -> discoverCollectives (cached since slice 2), the
// REAL loadEventDetail -> entuFetch -> readCache over fake-indexeddb, and for
// the prefetch the REAL agenda page's load chain. Only `globalThis.fetch` is
// stubbed: an online router, then a stub rejecting every call. The event page's
// other reads (rsvp, tally, works, schedule, rights) are not in this slice and
// simply fail offline — the header must survive that.
import { IDBFactory } from 'fake-indexeddb';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { msgProxy } = vi.hoisted(() => ({
	msgProxy: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_t, key) => (params?: Record<string, unknown>) =>
			params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/messages.js', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/messages', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/runtime', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk'],
	overwriteGetLocale: vi.fn()
}));
vi.mock('$lib/paraglide/runtime.js', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk'],
	overwriteGetLocale: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import EventPage from './+page.svelte';
import AgendaPage from '../../+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache, resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { isoDateFormatter, tallinnHHMM } from '$lib/preferences/timeFormat';

const DB = 'sampledb';
const PERSON = 'person-1';
const DB_ENTITY = 'db-entity-1';
const SEASON = 'season-1';
const SERIES = 'series-1';
const CONDUCTOR = 'p-cond';
const CONDUCTOR_NAME = 'Anna Dirigent';
const SERIES_LOCATION = 'Kaarli kirik';

// A fixed "today" (only Date is faked — IndexedDB and waitFor keep real timers).
// 07:05Z is 10:05 in Tallinn (EEST), so the as-of time is unmistakable.
const READ_AT = new Date('2026-09-28T07:05:00.000Z');
const LATER_SAME_DAY = new Date('2026-09-28T09:40:00.000Z');
const NEXT_DAY = new Date('2026-09-29T08:00:00.000Z');

// ev-1 is the NEXT event (agendaItems[0]) as of READ_AT; ev-2 comes after it.
// ev-1 takes its NAME from itself and its LOCATION from its series (no own
// location) — the offline header shows the series read landed in the cache too.
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

function eventEntity(e: (typeof EVENTS)[number]) {
	return {
		_id: e.id,
		event_name: [{ string: e.name }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: e.start }],
		duration_minutes: [{ number: 90 }],
		_parent: [
			{ reference: SEASON, entity_type: 'season' },
			{ reference: SERIES, entity_type: 'event_series' }
		]
	};
}

/** The online Entu: the agenda's reads (slice 2's fixture) plus the event
 *  page's single-entity reads. Everything else answers empty. */
function onlineEntu() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
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
			return json({ count: EVENTS.length, entities: EVENTS.map(eventEntity) });
		}
		for (const e of EVENTS) {
			if (url.includes(`entity/${e.id}?`)) return json({ entity: eventEntity(e) });
		}
		if (url.includes(`entity/${SEASON}?`)) {
			return json({ entity: { _id: SEASON, conductor: [{ reference: CONDUCTOR }] } });
		}
		if (url.includes(`entity/${SERIES}?`)) {
			return json({
				entity: {
					_id: SERIES,
					name: [{ string: 'Tuesday rehearsals' }],
					default_location: [{ string: SERIES_LOCATION }]
				}
			});
		}
		if (url.includes('_type.string=profile') && url.includes(`_parent.reference=${CONDUCTOR}`)) {
			return json({
				count: 1,
				entities: [
					{
						_id: 'prof-cond',
						name: [{ string: CONDUCTOR_NAME }],
						_sharing: [{ string: 'domain' }]
					}
				]
			});
		}
		return json({ count: 0, entities: [] });
	});
}

function offlineEntu() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

/** Discovery through the store's own entry point, then mount /event/<id>. */
async function openEventPage(id: string) {
	pageStub.params = { id };
	pageStub.url = new URL(`http://localhost/event/${id}`);
	collectiveState.set({ status: 'loading' });
	await hydrateCollectives();
	return render(EventPage);
}

/** Discovery, then mount the agenda at `/`. */
async function openAgenda() {
	pageStub.params = {};
	pageStub.url = new URL('http://localhost/');
	collectiveState.set({ status: 'loading' });
	await hydrateCollectives();
	return render(AgendaPage);
}

async function expectHeader(container: HTMLElement, e: (typeof EVENTS)[number]) {
	await waitFor(() => {
		const name = container.querySelector('[data-testid="event-detail-name"]');
		expect(name, 'event-detail-name').not.toBeNull();
		expect(name!.textContent).toContain(e.name);
		// Season read (conductor ref) + profile read (conductor name).
		const conductors = container.querySelector('[data-testid="event-detail-conductors"]');
		expect(conductors, 'event-detail-conductors').not.toBeNull();
		expect(conductors!.textContent).toContain(CONDUCTOR_NAME);
		// Series read (inherited location).
		const location = container.querySelector('[data-testid="event-detail-location"]');
		expect(location, 'event-detail-location').not.toBeNull();
		expect(location!.textContent).toContain(SERIES_LOCATION);
	});
	expect(container.querySelector('[data-testid="event-detail-load-error"]')).toBeNull();
}

async function asOfLine(container: HTMLElement): Promise<Element> {
	return waitFor(() => {
		const el = container.querySelector('[data-testid="event-detail-as-of"]');
		expect(el, 'event-detail-as-of').not.toBeNull();
		return el!;
	});
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: READ_AT });
	setReadCacheFactory(new IDBFactory());
	// #343's part byte store (next-event prefetch, file presence) opens the
	// global IndexedDB — a separate, fresh one.
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
	collectiveState.set({ status: 'loading' });
});

describe('#434 slice 3 — the event page renders offline from the read cache', () => {
	it('an online visit shows the header and NO as-of line', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openEventPage('ev-1');
		await expectHeader(container, EVENTS[0]);
		expect(container.querySelector('[data-testid="event-detail-as-of"]')).toBeNull();
	});

	it('online visit, then every fetch rejecting: the same header, plus "as of" the stored read time', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const first = await openEventPage('ev-1');
		await expectHeader(first.container, EVENTS[0]);
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openEventPage('ev-1');

		// Name (event read), conductor (season + profile reads) and the
		// series-inherited location (series read) — every read loadEventDetail
		// makes was cached, not only the first.
		await expectHeader(container, EVENTS[0]);

		const asOf = await asOfLine(container);
		// The STORED read's time (10:05 Tallinn), not the offline visit's (12:40).
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		expect(asOf.textContent).not.toContain(tallinnHHMM(LATER_SAME_DAY));
		// Same day: no date alongside it.
		expect(asOf.textContent).not.toContain(isoDateFormatter('Europe/Tallinn').format(READ_AT));
	});

	it('a stored read from an EARLIER day carries its date as well as its time', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const first = await openEventPage('ev-1');
		await expectHeader(first.container, EVENTS[0]);
		await flushReadCache();
		cleanup();

		vi.setSystemTime(NEXT_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openEventPage('ev-1');
		await expectHeader(container, EVENTS[0]);
		const asOf = await asOfLine(container);
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		expect(asOf.textContent).toContain(isoDateFormatter('Europe/Tallinn').format(READ_AT));
	});

	it('a later ONLINE visit after an offline one shows no as-of line (reset at load start)', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const first = await openEventPage('ev-1');
		await expectHeader(first.container, EVENTS[0]);
		await flushReadCache();
		cleanup();

		vi.stubGlobal('fetch', offlineEntu());
		const second = await openEventPage('ev-1');
		await asOfLine(second.container);
		cleanup();

		vi.stubGlobal('fetch', onlineEntu());
		const { container } = await openEventPage('ev-1');
		await expectHeader(container, EVENTS[0]);
		expect(container.querySelector('[data-testid="event-detail-as-of"]')).toBeNull();
	});

	it('an event never read online is still a load-error offline (nothing cached for it)', async () => {
		// Warm the cache for ev-1 only; ev-2 has no stored copy.
		vi.stubGlobal('fetch', onlineEntu());
		const first = await openEventPage('ev-1');
		await expectHeader(first.container, EVENTS[0]);
		await flushReadCache();
		cleanup();

		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openEventPage('ev-2');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-name"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-as-of"]')).toBeNull();
	});
});

describe('#434 slice 3 — the NEXT event is fetched ahead by the agenda', () => {
	it('after the agenda loads online, the next event — never opened — is readable offline', async () => {
		const online = onlineEntu();
		vi.stubGlobal('fetch', online);
		const agenda = await openAgenda();
		await waitFor(() => {
			expect(agenda.container.querySelector('[data-testid="agenda-row-ev-1"]')).not.toBeNull();
		});
		// Drive the REAL prefetch: works settle -> pressure sweep -> prefetch.
		// It has landed once the next event's own detail read went out.
		await waitFor(
			() => {
				const urls = online.mock.calls.map(([input]) => urlOf(input as RequestInfo | URL));
				expect(
					urls.some((u) => u.includes('entity/ev-1?props=event_name')),
					'the agenda fetched the next event (ev-1) ahead'
				).toBe(true);
				// ...and the reads that header needs beyond the event entity.
				expect(urls.some((u) => u.includes(`entity/${SEASON}?props=conductor`))).toBe(true);
				expect(urls.some((u) => u.includes(`entity/${SERIES}?props=`))).toBe(true);
				expect(
					urls.some(
						(u) => u.includes('_type.string=profile') && u.includes(`_parent.reference=${CONDUCTOR}`)
					)
				).toBe(true);
			},
			{ timeout: 4000 }
		);
		// Only the NEXT event — ev-2 is not fetched ahead.
		const urls = online.mock.calls.map(([input]) => urlOf(input as RequestInfo | URL));
		expect(urls.some((u) => u.includes('entity/ev-2?props=event_name'))).toBe(false);
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openEventPage('ev-1');
		await expectHeader(container, EVENTS[0]);
		const asOf = await asOfLine(container);
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
	});
});

// (*MVOX:Tallis*)
