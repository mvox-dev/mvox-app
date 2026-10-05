// @vitest-environment happy-dom
// The event page offline, and the next event fetched ahead.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () => (await import('$lib/testing/messageMocks')).echoMessages());
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$lib/paraglide/runtime.js', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
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
import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
import { flushReadCache } from '$lib/entu/readCache';
import { isoDateFormatter, tallinnHHMM } from '$lib/preferences/timeFormat';
import { json } from '$lib/testing/entuFetchKit';
import {
	DB_ENTITY,
	EVENTS,
	JSON_HEADERS,
	LATER_SAME_DAY,
	READ_AT,
	SEASON,
	cleanupResetReadCache,
	offlineEntu,
	seedOfflineSession,
	urlOf
} from '$lib/testing/pages/event';
import { REPERTOIRE_ITEMS } from '$lib/testing/pages/agendaWorks';

const SERIES = 'series-1';
const CONDUCTOR = 'p-cond';
const CONDUCTOR_NAME = 'Anna Dirigent';
const SERIES_LOCATION = 'Kaarli kirik';

const NEXT_DAY = new Date('2026-09-29T08:00:00.000Z');
const WORK_NAME = 'Spem in alium';

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
		if (url.includes('_type.string=repertoire_item')) {
			return json({ count: 1, entities: [REPERTOIRE_ITEMS[0]] }, 200, JSON_HEADERS);
		}
		if (/_type\.string=work(&|$)/.test(url)) {
			return json(
				{ count: 1, entities: [{ _id: 'work-1', name: [{ string: WORK_NAME }] }] },
				200,
				JSON_HEADERS
			);
		}
		return json({ count: 0, entities: [] }, 200, JSON_HEADERS);
	});
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

beforeEach(seedOfflineSession);

afterEach(cleanupResetReadCache);

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

describe('#434 slice 5 — the event page works list offline', () => {
	it('online visit, then every fetch rejecting: the same works list', async () => {
		vi.stubGlobal('fetch', onlineEntu());
		const online = await openEventPage('ev-1');
		await waitFor(() => {
			expect(online.container.querySelector('[data-testid="event-detail-works"]')?.textContent).toContain(WORK_NAME);
		});
		await flushReadCache();
		cleanup();

		vi.setSystemTime(LATER_SAME_DAY);
		vi.stubGlobal('fetch', offlineEntu());
		const { container } = await openEventPage('ev-1');
		await expectHeader(container, EVENTS[0]);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-works"]')?.textContent).toContain(WORK_NAME);
		});
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
