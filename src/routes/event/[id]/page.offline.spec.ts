// @vitest-environment happy-dom
// The event page offline, and the next event fetched ahead.
import { IDBFactory } from 'fake-indexeddb';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () => (await import('$lib/testing/messageMocks')).echoMessages());
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
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import EventPage from './+page.svelte';
import AgendaPage from '../../+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache, resetServedFromCache, setReadCacheFactory } from '$lib/entu/readCache';
import { isoDateFormatter, tallinnHHMM } from '$lib/preferences/timeFormat';
import { json } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';

const DB = 'sampledb';
const PERSON = 'person-1';
const DB_ENTITY = 'db-entity-1';
const SEASON = 'season-1';
const SERIES = 'series-1';
const CONDUCTOR = 'p-cond';
const CONDUCTOR_NAME = 'Anna Dirigent';
const SERIES_LOCATION = 'Kaarli kirik';

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

function onlineEntu() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = urlOf(input);
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
			return json({ count: EVENTS.length, entities: EVENTS.map(eventEntity) }, 200, JSON_HEADERS);
		}
		for (const e of EVENTS) {
			if (url.includes(`entity/${e.id}?`)) return json(
				{ entity: eventEntity(e) },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes(`entity/${SEASON}?`)) {
			return json(
				{ entity: { _id: SEASON, conductor: [{ reference: CONDUCTOR }] } },
				200,
				JSON_HEADERS
			);
		}
		if (url.includes(`entity/${SERIES}?`)) {
			return json({
				entity: {
					_id: SERIES,
					name: [{ string: 'Tuesday rehearsals' }],
					default_location: [{ string: SERIES_LOCATION }]
				}
			}, 200, JSON_HEADERS);
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
			}, 200, JSON_HEADERS);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
	});
}

function offlineEntu() {
	return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

async function openEventPage(id: string) {
	pageStub.params = { id };
	pageStub.url = new URL(`http://localhost/event/${id}`);
	collectiveState.set({ status: 'loading' });
	await hydrateCollectives();
	return render(EventPage);
}

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
		const conductors = container.querySelector('[data-testid="event-detail-conductors"]');
		expect(conductors, 'event-detail-conductors').not.toBeNull();
		expect(conductors!.textContent).toContain(CONDUCTOR_NAME);
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
	resetAppState();
	setReadCacheFactory(undefined);
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

		await expectHeader(container, EVENTS[0]);

		const asOf = await asOfLine(container);
		expect(asOf.textContent).toContain(tallinnHHMM(READ_AT));
		expect(asOf.textContent).not.toContain(tallinnHHMM(LATER_SAME_DAY));
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
		await waitFor(
			() => {
				const urls = online.mock.calls.map(([input]) => urlOf(input as RequestInfo | URL));
				expect(
					urls.some((u) => u.includes('entity/ev-1?props=event_name')),
					'the agenda fetched the next event (ev-1) ahead'
				).toBe(true);
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
