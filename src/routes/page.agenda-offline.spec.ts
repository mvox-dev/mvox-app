// @vitest-environment happy-dom

// The agenda offline: rows from the read cache plus an as-of line. Only fetch is stubbed,
// so every real reader between the page and the wire runs.
import { IDBFactory } from 'fake-indexeddb';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () => (await import('$lib/testing/messageMocks')).echoMessages());
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache, readCacheGet, resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { tallinnHHMM } from '$lib/preferences/timeFormat';
import { json } from '$lib/testing/entuFetchKit';

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

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function urlOf(input: RequestInfo | URL): string {
	return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** The online Entu, answering the agenda's reads by path; everything else empty. */
function onlineEntu() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (url.includes('_type.string=mvox_collective')) {
			return json(
				{ count: 1, entities: [{ _id: 'marker-1', name: [{ string: 'Sample Choir' }] }] },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes('_type.string=database')) {
			return json({ count: 1, entities: [{ _id: DB_ENTITY }] }, 200, JSON_HEADERS);
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
			}, 200, JSON_HEADERS);
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
			}, 200, JSON_HEADERS);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
	});
}

function offlineEntu() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

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
	// The as-of line claims the agenda's own rows only: a next-event prefetch that falls back
	// to the cache must not stamp an age over rows that came back live.
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

		expect(container.querySelector('[data-testid="agenda-as-of"]')).toBeNull();
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
		expect(asOf.textContent).toContain('last_read_as_of');
		// The STORED read's time (10:05 Tallinn), not the offline load's (12:40).
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		expect(asOf.textContent).not.toContain(tallinnHHMM(LATER_SAME_DAY));
		expect(asOf.textContent).toContain(`"time":"${tallinnHHMM(READ_AT)}"`);

		// The door to parts already on this device: the rows' own part links need uncached reads,
		// so /downloads is the only way in.
		const door = container.querySelector('[data-testid="agenda-downloads-link-cached"]');
		expect(door, 'agenda-downloads-link-cached').not.toBeNull();
		expect(door!.getAttribute('href')).toBe('/downloads');
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
		const load = readFileSync(resolve(process.cwd(), 'src/lib/agenda/agendaSelectedLoad.ts'), 'utf-8');
		expect(load.includes('resetServedFromCache()'), 'resetServedFromCache()').toBe(true);
		const source = readFileSync(resolve(process.cwd(), 'src/lib/agenda/AgendaNotices.svelte'), 'utf-8');
		for (const needle of [
			'$servedFromCache',
			// The line itself is the shared AsOfLine, which owns the today-vs-date rule.
			'<AsOfLine',
			'testid="agenda-as-of"',
			'data-testid="agenda-downloads-link-cached"'
		]) {
			expect(source.includes(needle), needle).toBe(true);
		}
	});
});

// The agenda's own works read stores the works fan-out; no separate next-event warm-up
// re-fetches the same collections on every load.
describe('#434 slice 5 — one works read per agenda load, and it stores', () => {
	const WORKS_READ = /_type\.string=(work|edition|copy|program_item|repertoire_item)(&|$)/;

	it('each works URL is fetched exactly once, the reads are stored, and nothing is "as of"', async () => {
		const live = onlineEntu();
		vi.stubGlobal('fetch', live);
		const { container } = await coldStart();
		await expectAgendaRows(container);
		// The next-event detail prefetch fires after the works read settles —
		// once it has run, any warm-up beside it has run too.
		await waitFor(() => {
			const urls = live.mock.calls.map((c) => urlOf(c[0] as RequestInfo | URL));
			expect(urls.some((u) => u.includes(`entity/${EVENTS[0].id}?`)), 'prefetch ran').toBe(true);
		});
		await flushReadCache();

		const counts = new Map<string, number>();
		for (const c of live.mock.calls) {
			const url = urlOf(c[0] as RequestInfo | URL);
			if (WORKS_READ.test(url)) counts.set(url, (counts.get(url) ?? 0) + 1);
		}
		const kinds = [...counts.keys()].map((u) => u.match(WORKS_READ)![1]);
		for (const kind of ['work', 'edition', 'copy', 'program_item']) {
			expect(kinds, `the ${kind} read ran`).toContain(kind);
		}
		expect(
			[...counts.entries()].filter(([, n]) => n !== 1),
			'a works URL fetched more than once'
		).toEqual([]);

		// Stored: the agenda's own read keeps the event page's works section
		// restorable offline.
		const base = `https://api.entu-test.invalid/${DB}/`;
		for (const url of counts.keys()) {
			expect(await readCacheGet(DB, PERSON, url.slice(base.length)), `stored: ${url}`).toBeDefined();
		}
		expect(container.querySelector('[data-testid="agenda-as-of"]')).toBeNull();
	});
});

describe('#434 slice 2 — the as-of copy exists in all four locales', () => {
	it('last_read_as_of is a {time} message in en/et/lv/uk', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, string>;
			expect(messages.last_read_as_of, locale).toBeTypeOf('string');
			expect(messages.last_read_as_of, locale).toContain('{time}');
		}
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
