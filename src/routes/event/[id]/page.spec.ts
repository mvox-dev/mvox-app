// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '$lib/auth/storage';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	setToken('jwt-editor');
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

type AppLocale = 'en' | 'et' | 'lv' | 'uk';
const localeMock = vi.hoisted(() => ({
	state: null as { get(k: string): string | undefined; set(k: string, v: string): unknown } | null
}));
vi.mock('$lib/paraglide/runtime.js', async () => {
	const { SvelteMap } = await import('svelte/reactivity');
	localeMock.state ??= new SvelteMap<string, string>([['locale', 'en']]);
	return {
		getLocale: () => localeMock.state!.get('locale'),
		setLocale: vi.fn(),
		locales: ['en', 'et', 'lv', 'uk'],
		overwriteGetLocale: vi.fn()
	};
});
function setAppLocale(locale: AppLocale): void {
	localeMock.state?.set('locale', locale);
}

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const { gotoMock, discoverMock } = vi.hoisted(() => ({ gotoMock: vi.fn(), discoverMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './+page.svelte';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { REDACT_ATTR } from '$lib/redact/redact';
import { loadEventDetail, EventDetailLoadError, type EventDetail } from '$lib/events/eventDetail';
import { authStore } from '$lib/auth/session';
import { IDBFactory } from 'fake-indexeddb';
import { setReadCacheFactory } from '$lib/entu/readCache';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const cfg = { db: 'sampledb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		event_name: [{ string: 'Tuesday Rehearsal' }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ number: 90 }],
		location: [{ string: 'Rehearsal Hall' }],
		description: [{ string: 'Come 15 minutes early for warm-ups.' }],
		capacity: [{ number: 20 }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		...over
	};
}

function seasonEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: [{ reference: 'p-mihkel' }, { reference: 'p-alice' }],
		...over
	};
}

function seriesEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }],
		default_location: [{ string: 'Church Hall' }],
		default_description: [{ string: 'Series default note.' }],
		...over
	};
}

const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	],
	'p-alice': [
		{ _id: 'prof-a-priv', name: [{ string: 'Alice Hidden' }], _sharing: [{ string: 'private' }] },
		{ _id: 'prof-a-pub', name: [{ string: 'Alice Smith' }], _sharing: [{ string: 'public' }] }
	],
	'p-guest': [
		{ _id: 'prof-g', name: [{ string: 'Guest Conductor' }], _sharing: [{ string: 'domain' }] }
	],
	'p-nameless': [{ _id: 'prof-n', name: [], _sharing: [{ string: 'domain' }] }]
};

type Fixtures = {
	event?: Record<string, unknown>;
	season?: Record<string, unknown>;
	series?: Record<string, unknown>;
	profiles?: Record<string, unknown[]>;
};

function entuFetchStub(fixtures: Fixtures = {}) {
	const event = fixtures.event ?? eventEntity();
	const season = fixtures.season ?? seasonEntity();
	const series = fixtures.series ?? seriesEntity();
	const profiles = fixtures.profiles ?? PROFILES;
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
			return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=profile')) {
			for (const [personId, list] of Object.entries(profiles)) {
				if (url.includes(personId) || url.includes(encodeURIComponent(personId)))
					return json({ entities: list });
			}
			return json({ entities: [] });
		}
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		if (url.includes('_type.string=member') && url.includes('status.string=active')) {
			return json({ entities: activeMemberEntitiesForEv1() });
		}
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
}

describe('loadEventDetail — full header shape', () => {
	it('fetches the event and maps the FULL EventDetail shape (event conductor empty → inherits season conductors)', async () => {
		const fetchImpl = entuFetchStub();
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toEqual({
			id: 'ev1',
			name: 'Tuesday Rehearsal',
			eventType: 'rehearsal',
			startDatetime: '2026-09-01T16:00:00.000Z',
			durationMinutes: 90,
			location: 'Rehearsal Hall',
			description: 'Come 15 minutes early for warm-ups.',
			conductorIds: ['p-mihkel', 'p-alice'],
			conductorNames: ['Mihkel Putrinš', 'Alice Smith'],
			capacity: 20,
			ownerIds: [],
			editorIds: [],
			seasonId: 'season1',
			seasonOwnerIds: [],
			seasonEditorIds: [],
			seriesId: 'series1',
			inheritedFields: []
		});
	});

	it('carries the parent season id and its rights tiers — asked for on the ONE season read, no second GET', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({
				_owner: [{ reference: 'p-boss' }],
				_editor: [{ reference: 'p-viewer' }]
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.seasonId).toBe('season1');
		expect(detail.seasonOwnerIds).toEqual(['p-boss']);
		expect(detail.seasonEditorIds).toEqual(['p-viewer']);
		const seasonUrls = fetchImpl.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('/entity/season1'));
		expect(seasonUrls).toHaveLength(1);
		expect(seasonUrls[0]).toContain('_owner');
		expect(seasonUrls[0]).toContain('_editor');
		expect(
			fetchImpl.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/entity/ev1'))
		).toHaveLength(1);
	});

	it('seasonId is null (and the season rights empty) when the event has no season parent', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ _parent: [{ reference: 'org1', entity_type: 'organization' }] })
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.seasonId).toBeNull();
		expect(detail.seasonOwnerIds).toEqual([]);
		expect(detail.seasonEditorIds).toEqual([]);
	});

	it('the event GET asks for event_name and NEVER the retired bare name (#420 — no fallback read)', async () => {
		const fetchImpl = entuFetchStub();
		await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		const evUrl = fetchImpl.mock.calls
			.map((c) => String(c[0]))
			.find((u) => u.includes('/entity/ev1'))!;
		const props = (/[?&]props=([^&]*)/.exec(evUrl)?.[1] ?? '').split(',');
		expect(props).toContain('event_name');
		expect(props).not.toContain('name');
	});

	it('throws on a non-2xx event response (fail loud, no silent empty detail)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(
			loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch)
		).rejects.toThrow();
	});
});

describe('loadEventDetail — series inheritance (read-time merge, verbatim listEvents semantics)', () => {
	it('missing name/duration/location/description fall back to the parent series values', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				event_name: undefined,
				duration_minutes: undefined,
				location: undefined,
				description: undefined
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toMatchObject({
			name: 'Tuesday Series',
			durationMinutes: 120,
			location: 'Church Hall',
			description: 'Series default note.'
		});
	});

	it('explicit event values ALWAYS win over series defaults', async () => {
		const fetchImpl = entuFetchStub(); // full event + full series
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toMatchObject({
			name: 'Tuesday Rehearsal',
			durationMinutes: 90,
			location: 'Rehearsal Hall',
			description: 'Come 15 minutes early for warm-ups.'
		});
	});

	it('no series parent → event values only, absent fields default to 0/"" (no throw)', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				description: undefined,
				_parent: [
					{ reference: 'org1', entity_type: 'organization' },
					{ reference: 'season1', entity_type: 'season' }
				]
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail).toMatchObject({
			name: 'Tuesday Rehearsal',
			durationMinutes: 90,
			location: 'Rehearsal Hall',
			description: ''
		});
	});
});

describe('loadEventDetail — conductor resolution (#77 model via resolveConductors)', () => {
	it('event conductor OVERLAPPING the season list → override: event list only', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ conductor: [{ reference: 'p-mihkel' }] })
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-mihkel']);
		expect(detail.conductorNames).toEqual(['Mihkel Putrinš']);
	});

	it('event conductor with NO overlap → merge: season list + guests, in that order', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ conductor: [{ reference: 'p-guest' }] })
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-mihkel', 'p-alice', 'p-guest']);
		expect(detail.conductorNames).toEqual(['Mihkel Putrinš', 'Alice Smith', 'Guest Conductor']);
	});

	it('a conductor with no domain/public name is DROPPED from conductorNames (never a raw id, never a private-tier name)', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({
				conductor: [{ reference: 'p-mihkel' }, { reference: 'p-nameless' }]
			})
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-mihkel', 'p-nameless']);
		expect(detail.conductorNames).toEqual(['Mihkel Putrinš']);
	});
});

function setAuthedWithSampledb() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

function renderEventPage(fixtures: Fixtures = {}) {
	const fetchStub = entuFetchStub(fixtures);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	setAppLocale('en');
});

describe('/event/[id] — header (integration: route param → loadEventDetail → render)', () => {
	it('renders name, type badge, time range (19:00–20:30 Tallinn), duration and location', async () => {
		const { container } = renderEventPage();

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-name"]')?.textContent
			).toContain('Tuesday Rehearsal');
		});

		const type = container.querySelector('[data-testid="event-detail-type"]');
		expect(type).not.toBeNull();
		expect(type!.textContent).toMatch(/rehearsal/i);

		const time = container.querySelector('[data-testid="event-detail-time"]');
		expect(time).not.toBeNull();
		expect(time!.textContent).toContain('19:00');
		expect(time!.textContent).toContain('20:30');

		const duration = container.querySelector('[data-testid="event-detail-duration"]');
		expect(duration).not.toBeNull();
		expect(duration!.textContent).toContain('90');

		const location = container.querySelector('[data-testid="event-detail-location"]');
		expect(location).not.toBeNull();
		expect(location!.textContent).toContain('Rehearsal Hall');
	});

	it('reaches Entu for THIS event in the SELECTED collective (the wire, not a hardcoded fixture)', async () => {
		const { container, fetchStub } = renderEventPage();
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-name"]')?.textContent
			).toContain('Tuesday Rehearsal');
		});
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('/sampledb/') && u.includes('ev1'))).toBe(true);
	});

	it('renders conductor names comma-separated, in resolved order', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			const line = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(line).not.toBeNull();
			expect(line!.textContent).toContain('Mihkel Putrinš, Alice Smith');
		});
	});
});

describe('/event/[id] — description', () => {
	it('renders the description when present', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			const desc = container.querySelector('[data-testid="event-detail-description"]');
			expect(desc).not.toBeNull();
			expect(desc!.textContent).toContain('Come 15 minutes early for warm-ups.');
		});
	});

	it('renders NO description element when event AND series carry none (hidden, not an empty block)', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ description: undefined }),
			series: seriesEntity({ default_description: undefined })
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-name"]')?.textContent
			).toContain('Tuesday Rehearsal');
		});
		expect(container.querySelector('[data-testid="event-detail-description"]')).toBeNull();
	});
});

describe('/event/[id] — back link', () => {
	it('renders a back link to the agenda (/)', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			const back = container.querySelector('[data-testid="event-detail-back"]');
			expect(back).not.toBeNull();
			expect(back!.tagName).toBe('A');
			expect(back!.getAttribute('href')).toBe('/');
		});
	});

	it('renders the ← as decorative markup, not as part of the translated string', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-back"]')).not.toBeNull();
		});
		const back = container.querySelector('[data-testid="event-detail-back"]')!;
		const arrow = [...back.querySelectorAll('span')].find((s) => s.textContent?.includes('←'));
		expect(arrow, 'the ← lives in its own span').not.toBeUndefined();
		expect(arrow!.getAttribute('aria-hidden')).toBe('true');
		expect(back.textContent).toContain('[event_detail_back]');
	});
});

describe('/event/[id] — optional type badge', () => {
	it('renders no type badge at all when the event carries no event_type', async () => {
		const { container } = renderEventPage({ event: eventEntity({ event_type: [] }) });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-type"]')).toBeNull();
	});
});

describe('/event/[id] — event with no start_datetime (renderable-invalid data)', () => {
	it('still renders the whole header; the time line is simply absent (no RangeError mid-render)', async () => {
		const { container } = renderEventPage({ event: eventEntity({ start_datetime: [] }) });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-time"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-location"]')?.textContent).toContain(
			'Rehearsal Hall'
		);
		expect(
			container.querySelector('[data-testid="event-detail-conductors"]')?.textContent
		).toContain('Mihkel Putrinš');
		expect(container.querySelector('[data-testid="event-detail-duration"]')?.textContent).toContain(
			'90'
		);
		expect(container.querySelector('[data-testid="event-detail-load-error"]')).toBeNull();
	});

	it('an UNPARSEABLE start_datetime is treated the same as a missing one', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ start_datetime: [{ datetime: 'not-a-date' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-time"]')).toBeNull();
	});
});

describe('/event/[id] — unknown duration (0)', () => {
	function noDurationAnywhere() {
		return {
			event: eventEntity({ duration_minutes: [] }),
			series: seriesEntity({ duration_minutes: undefined })
		};
	}

	it('renders NO duration line at all — never a literal "0 min"', async () => {
		const { container } = renderEventPage(noDurationAnywhere());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-duration"]')).toBeNull();
	});

	it('collapses the time line to the START time alone — never "19:00–19:00"', async () => {
		const { container } = renderEventPage(noDurationAnywhere());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
		});
		const time = container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
		expect(time).toContain('19:00');
		expect(time).not.toContain('–');
		expect(time.match(/19:00/g)).toHaveLength(1);
	});
});

describe('/event/[id] — type badge is translated', () => {
	it('routes a KNOWN event_type through paraglide, not the raw Entu string', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-type"]')!.textContent).toContain(
			'[event_type_rehearsal]'
		);
	});

	it('falls back to the RAW value for an unknown event_type (visibly wrong beats invisibly blank)', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ event_type: [{ string: 'flashmob' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-type"]')!.textContent).toContain(
			'flashmob'
		);
	});

	it('guard: every event_type_* key in en.json exists in et, lv and uk, and none is empty', () => {
		const en = JSON.parse(readFileSync(resolve('messages/en.json'), 'utf8')) as MessageFile;
		const typeKeys = Object.keys(en).filter((k) => k.startsWith('event_type_'));
		expect(typeKeys.length).toBe(10); // a hard literal on purpose: the locale files, not the constant
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(
				readFileSync(resolve(`messages/${locale}.json`), 'utf8')
			) as MessageFile;
			expect(
				typeKeys.filter((k) => !(k in messages)),
				`${locale}.json is missing event_type keys`
			).toEqual([]);
			expect(
				typeKeys.filter((k) => k in messages && isMessageEmpty(messages[k])),
				`${locale}.json has empty event_type values`
			).toEqual([]);
			expect(
				'event_detail_not_in_collective' in messages,
				`${locale}.json is missing event_detail_not_in_collective`
			).toBe(true);
		}
	});
});

describe('/event/[id] — the date', () => {
	it('shows the Tallinn-zoned weekday + date alongside the time', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-date"]')).not.toBeNull();
		});
		const date = container.querySelector('[data-testid="event-detail-date"]')!.textContent ?? '';
		expect(date).toMatch(/Tuesday/i);
		expect(date).toMatch(/September/i);
		expect(date).toContain('1');
		expect(date.trim()).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const time = container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
		expect(time).toContain('19:00');
		expect(time).toContain('20:30');
	});
});

describe('#251 — event-detail date renders in the app language', () => {
	const expectedDate: Record<AppLocale, string> = {
		en: 'Tuesday, September 1',
		et: 'teisipäev, 1. september',
		lv: 'otrdiena, 1. septembris',
		uk: 'вівторок, 1 вересня'
	};
	for (const locale of ['et', 'en', 'lv', 'uk'] as AppLocale[]) {
		it(`app language '${locale}': the date line reads '${expectedDate[locale]}' regardless of the device locale`, async () => {
			setAppLocale(locale);
			const { container } = renderEventPage();
			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-date"]')).not.toBeNull();
			});
			expect(
				container.querySelector('[data-testid="event-detail-date"]')?.textContent?.trim()
			).toBe(expectedDate[locale]);
			const time = container.querySelector('[data-testid="event-detail-time"]')?.textContent ?? '';
			expect(time).toContain('19:00');
			expect(time).toContain('20:30');
		});
	}

	it('switching the app language re-renders the date WITHOUT a remount (formatter is rebuilt, not a construction-time constant)', async () => {
		setAppLocale('en');
		const { container } = renderEventPage();
		const dateText = () =>
			container.querySelector('[data-testid="event-detail-date"]')?.textContent?.trim();
		await waitFor(() => {
			expect(dateText()).toBe('Tuesday, September 1');
		});

		setAppLocale('et');
		await waitFor(() => {
			expect(dateText()).toBe('teisipäev, 1. september');
		});
	});
});

describe('/event/[id] — event not readable in the selected collective', () => {
	it('loadEventDetail throws an EventDetailLoadError carrying the status', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		const err = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch).catch(
			(e: unknown) => e
		);
		expect(err).toBeInstanceOf(EventDetailLoadError);
		expect((err as EventDetailLoadError).status).toBe(403);
		expect((err as EventDetailLoadError).unavailable).toBe(true);
	});

	it('a 2xx that carried no entity is unavailable too (status 0), not a transient failure', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 200));
		const err = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch).catch(
			(e: unknown) => e
		);
		expect(err).toBeInstanceOf(EventDetailLoadError);
		expect((err as EventDetailLoadError).unavailable).toBe(true);
	});

	it('a 5xx is NOT unavailable — that one is worth retrying', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 503));
		const err = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch).catch(
			(e: unknown) => e
		);
		expect((err as EventDetailLoadError).unavailable).toBe(false);
	});

	it('renders a not-in-this-collective message with NO Retry button on a 404', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => json({}, 404))
		);
		pageStub.params = { id: 'ev1' };
		pageStub.url = new URL('http://localhost/event/ev1');
		setAuthedWithSampledb();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-not-available"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-retry"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-back"]')).not.toBeNull();
	});

	it('still offers Retry for a genuinely transient failure (network throw)', async () => {
		setReadCacheFactory(new IDBFactory());
		try {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new TypeError('network down');
				})
			);
			pageStub.params = { id: 'ev1' };
			pageStub.url = new URL('http://localhost/event/ev1');
			setAuthedWithSampledb();
			const { container } = render(Page);

			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-load-error"]')).not.toBeNull();
			});
			expect(container.querySelector('[data-testid="event-detail-retry"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-not-available"]')).toBeNull();
			expect(container.querySelector('[data-testid="event-detail-as-of"]')).toBeNull();
		} finally {
			setReadCacheFactory(undefined);
		}
	});
});

type EventDetailTe2 = EventDetail & {
	capacity: number | null;
	ownerIds: string[];
	editorIds: string[];
};

function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}

function ownerOnlyEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _owner: [{ reference: 'p-viewer' }], ...over });
}

function allRsvpsForEv1(): unknown[] {
	const rows: unknown[] = [
		{ _id: 'rsvp-77', member: [{ reference: 'member-1' }], status: [{ string: 'going' }] }
	];
	for (let i = 0; i < 11; i++)
		rows.push({ _id: `rsvp-g${i}`, member: [{ reference: `m-g${i}` }], status: [{ string: 'going' }] });
	for (let i = 0; i < 2; i++)
		rows.push({
			_id: `rsvp-n${i}`,
			member: [{ reference: `m-n${i}` }],
			status: [{ string: 'not_going' }]
		});
	rows.push({ _id: 'rsvp-m0', member: [{ reference: 'm-m0' }], status: [{ string: 'maybe' }] });
	return rows;
}

function activeMemberEntitiesForEv1(): unknown[] {
	const memberIds = new Set<string>(
		allRsvpsForEv1().map((row) => (row as { member: Array<{ reference: string }> }).member[0].reference)
	);
	return [...memberIds].map((id) => ({ _id: id, person: [{ reference: `p-${id}` }] }));
}

function rsvpWireStub(fixtures: Fixtures = {}, opts: { myRsvp?: boolean } = {}) {
	const base = entuFetchStub(fixtures);
	const myRsvp = opts.myRsvp ?? true;
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/')) return json({ deleted: true });
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') return json({});
			return json({
				entity: {
					_id: 'rsvp-77',
					status: [{ _id: 'val-status-1' }],
					event: [{ reference: 'ev1' }],
					going_ref: [{ _id: 'val-sentinel-1' }]
				}
			});
		}
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=rsvp')) {
			if (url.includes('_parent.reference=p-viewer'))
				return json({
					entities: myRsvp
						? [{ _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] }]
						: []
				});
			if (url.includes('event.reference=ev1')) return json({ entities: allRsvpsForEv1() });
			return json({ entities: [] });
		}
		return base(input);
	});
}

function renderRsvpPage(fixtures: Fixtures = {}, opts: { myRsvp?: boolean } = {}) {
	return renderWithFetch(rsvpWireStub(fixtures, opts));
}

function renderWithFetch(fetchStub: ReturnType<typeof vi.fn>) {
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

function rsvpButtons(container: HTMLElement): HTMLButtonElement[] {
	return ['going', 'not_going', 'maybe', 'late'].map(
		(s) => container.querySelector(`[data-testid="rsvp-btn-${s}"]`) as HTMLButtonElement
	);
}

describe('loadEventDetail — TE.2 capacity + _editor rights (contract extension)', () => {
	it('maps event.capacity and the visible _editor refs into capacity/editorIds', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }, { reference: 'p-other' }] })
		});
		const detail = (await loadEventDetail(
			cfg,
			'ev1',
			fetchImpl as unknown as typeof fetch
		)) as EventDetailTe2;
		expect(detail.capacity).toBe(20);
		expect(detail.editorIds).toEqual(['p-viewer', 'p-other']);
	});

	it('capacity is null (never 0) when the event carries none; editorIds [] when _editor is invisible', async () => {
		const fetchImpl = entuFetchStub({ event: eventEntity({ capacity: undefined }) });
		const detail = (await loadEventDetail(
			cfg,
			'ev1',
			fetchImpl as unknown as typeof fetch
		)) as EventDetailTe2;
		expect(detail.capacity).toBeNull();
		expect(detail.ownerIds).toEqual([]);
		expect(detail.editorIds).toEqual([]);
	});

	it('reads BOTH rights tiers and maps _owner into ownerIds (owner-or-editor is one rule, not two)', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				_owner: [{ reference: 'p-viewer' }],
				_editor: [{ reference: 'p-other' }]
			})
		});
		const detail = (await loadEventDetail(
			cfg,
			'ev1',
			fetchImpl as unknown as typeof fetch
		)) as EventDetailTe2;
		expect(detail.ownerIds).toEqual(['p-viewer']);
		expect(detail.editorIds).toEqual(['p-other']);
		const eventUrl = fetchImpl.mock.calls
			.map((c) => String(c[0]))
			.find((u) => u.includes('/entity/ev1'));
		expect(eventUrl).toContain('_owner');
	});
});

describe('/event/[id] — RSVP control (integration: same RsvpControl, same rsvp entity as the agenda)', () => {
	it('renders the RsvpControl — all four status buttons + the msg line — inside the RSVP section', async () => {
		const { container } = renderRsvpPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
		});
		const section = container.querySelector('[data-testid="event-detail-rsvp"]')!;
		expect(section.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
		for (const s of ['going', 'not_going', 'maybe', 'late']) {
			expect(
				section.querySelector(`[data-testid="rsvp-btn-${s}"]`),
				`rsvp-btn-${s} missing`
			).not.toBeNull();
		}
		expect(section.querySelector('[data-testid="rsvp-msg-line"]')).not.toBeNull();
	});

	it('enables the buttons for an active member (findMyMemberId resolved over the wire) — no non-member hint', async () => {
		const { container, fetchStub } = renderRsvpPage();
		await waitFor(() => {
			const btn = container.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn).not.toBeNull();
			expect(btn!.disabled).toBe(false);
		});
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=member') && u.includes('p-viewer'))).toBe(
			true
		);
	});

	it("seeds the control from the viewer's EXISTING rsvp — the same entity the agenda row owns", async () => {
		const { container, fetchStub } = renderRsvpPage();
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(
			urls.some((u) => u.includes('_type.string=rsvp') && u.includes('_parent.reference=p-viewer'))
		).toBe(true);
	});

	it('a status change WRITES to that same rsvp entity (update rsvp-77) — never a second create', async () => {
		const { container, fetchStub } = renderRsvpPage();
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
			const maybe = container.querySelector(
				'[data-testid="rsvp-btn-maybe"]'
			) as HTMLButtonElement | null;
			expect(maybe).not.toBeNull();
			expect(maybe!.disabled).toBe(false);
		});

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);

		await waitFor(() => {
			const posts = fetchStub.mock.calls.filter(
				(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
			);
			expect(posts.length).toBeGreaterThan(0);
			for (const c of posts) expect(String(c[0])).toContain('/entity/rsvp-77');
		});
	});
});

describe('/event/[id] — tally + capacity render from the domain rsvp read for EVERY member (#363)', () => {
	it('an _editor on the event sees the tally: per-status counts from the domain rsvp read', async () => {
		const { container } = renderRsvpPage({ event: editorEvent() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		const count = (s: string) =>
			container.querySelector(`[data-testid="event-detail-tally-${s}"]`);
		expect(count('going'), 'tally-going missing').not.toBeNull();
		expect(count('going')!.textContent).toContain('12');
		expect(count('not_going')!.textContent).toContain('2');
		expect(count('maybe')!.textContent).toContain('1');
		expect(count('late')!.textContent).toContain('0');
	});

	it('a plain member with NO grant on the event sees the tally AND capacity — the render follows the read, not a rights predicate (#363)', async () => {
		const { container, fetchStub } = renderRsvpPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		const count = (s: string) =>
			container.querySelector(`[data-testid="event-detail-tally-${s}"]`);
		expect(count('going')!.textContent).toContain('12');
		expect(count('not_going')!.textContent).toContain('2');
		expect(count('maybe')!.textContent).toContain('1');
		expect(count('late')!.textContent).toContain('0');
		const cap = container.querySelector('[data-testid="event-detail-capacity"]')!.textContent ?? '';
		expect(cap).toContain('12');
		expect(cap).toContain('20');
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(
			urls.some(
				(u) =>
					u.includes('_type.string=rsvp') &&
					u.includes('event.reference=ev1') &&
					!u.includes('_parent.reference=')
			)
		).toBe(true);
	});

	it('an _editor list WITHOUT the viewer changes nothing — the tally renders from the read, not from list membership (#363)', async () => {
		const { container } = renderRsvpPage({
			event: eventEntity({ _editor: [{ reference: 'p-other' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="event-detail-tally-going"]')!.textContent
		).toContain('12');
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).not.toBeNull();
	});

	it('capacity renders as going-count / capacity alongside the tally when event.capacity is set', async () => {
		const { container } = renderRsvpPage({ event: editorEvent() }); // default capacity: 20
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-capacity"]')).not.toBeNull();
		});
		const cap = container.querySelector('[data-testid="event-detail-capacity"]')!.textContent ?? '';
		expect(cap).toContain('12');
		expect(cap).toContain('20');
		expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
	});

	it('capacity is hidden when the event has none — the tally still renders', async () => {
		const { container } = renderRsvpPage({ event: editorEvent({ capacity: undefined }) });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).toBeNull();
	});

	it('an `_owner` on the event who is NOT in `_editor` sees the tally + capacity — ownership subsumes editing', async () => {
		const { container } = renderRsvpPage({ event: ownerOnlyEvent() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="event-detail-tally-going"]')!.textContent
		).toContain('12');
		const cap = container.querySelector('[data-testid="event-detail-capacity"]')!.textContent ?? '';
		expect(cap).toContain('12');
		expect(cap).toContain('20');
	});

	it('an `_owner` list WITHOUT the viewer changes nothing either — tally + capacity render for her too (#363)', async () => {
		const { container } = renderRsvpPage({
			event: eventEntity({ _owner: [{ reference: 'p-other' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="event-detail-tally-going"]')!.textContent
		).toContain('12');
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).not.toBeNull();
	});

	it('integration: the RSVP section holds the control AND the tally + capacity together (editor view)', async () => {
		const { container } = renderRsvpPage({ event: editorEvent() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		const section = container.querySelector('[data-testid="event-detail-rsvp"]')!;
		expect(section.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="event-detail-capacity"]')).not.toBeNull();
	});
});

describe('/event/[id] — RSVP control while membership is still unresolved (#372 supersedes #102 review F2)', () => {
	function stallingMemberWire(opts: { myRsvp?: boolean } = {}) {
		const base = rsvpWireStub({}, opts);
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=member')) return new Promise<Response>(() => {});
			return base(input, init);
		});
	}

	function lateMemberWire() {
		const base = rsvpWireStub({}, { myRsvp: false });
		let memberCalls = 0;
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.includes('_type.string=member')) {
				memberCalls += 1;
				if (memberCalls === 1) return new Promise<Response>(() => {});
				return json({ entities: [{ _id: 'member-1' }] });
			}
			if (url.includes('_type.string=entity') && url.includes('name.string=rsvp'))
				return json({ entities: [{ _id: 'type-rsvp' }] });
			if (method === 'POST' && /\/entity$/.test(url.split('?')[0])) return json({ _id: 'rsvp-new' });
			return base(input, init);
		});
	}

	function failingMemberWire() {
		const base = rsvpWireStub({}, { myRsvp: false });
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=member'))
				return new Response('boom', { status: 500 });
			return base(input, init);
		});
	}

	function noMemberWire() {
		const base = rsvpWireStub({}, { myRsvp: false });
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=member')) return json({ entities: [] });
			return base(input, init);
		});
	}

	function postCalls(fetchStub: ReturnType<typeof vi.fn>) {
		return fetchStub.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
	}

	it('ENABLES on the grant alone — membership staying unresolved decides nothing, no non-member hint', async () => {
		const { container } = renderWithFetch(stallingMemberWire());
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await waitFor(() => {
			for (const btn of rsvpButtons(container)) expect(btn.disabled).toBe(false);
		});
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
		expect(container.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
	});

	it('a first tap RESOLVES the member id at write time when the load-time lookup never answered — the create lands', async () => {
		const { container, fetchStub } = renderWithFetch(lateMemberWire());
		const btn = await waitFor(() => {
			const b = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
			expect(b).not.toBeNull();
			expect(b!.disabled).toBe(false);
			return b!;
		});
		await fireEvent.click(btn);

		const post = await waitFor(() => {
			const posts = postCalls(fetchStub);
			expect(posts.length).toBe(1);
			return posts[0];
		});
		const body = JSON.parse(String((post[1] as RequestInit).body)) as Array<Record<string, unknown>>;
		expect(body).toContainEqual({ type: 'member', reference: 'member-1' });
		expect(body).toContainEqual({ type: 'event', reference: 'ev1' });
		expect(container.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('a write-time lookup that REJECTS fails safely — revert + save-failed, no POST ever issued', async () => {
		const { container, fetchStub } = renderWithFetch(failingMemberWire());
		const btn = await waitFor(() => {
			const b = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
			expect(b).not.toBeNull();
			expect(b!.disabled).toBe(false);
			return b!;
		});
		await fireEvent.click(btn);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(postCalls(fetchStub)).toEqual([]);
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('false');
	});

	it('a confirmed non-member never gets the control at all — the hint stands in its place', async () => {
		const { container, fetchStub } = renderWithFetch(noMemberWire());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(postCalls(fetchStub)).toEqual([]);
	});
});

describe('/event/[id] — a past event is read-only (#102 review F3)', () => {
	function pastEvent(over: Partial<Record<string, unknown>> = {}) {
		return eventEntity({
			start_datetime: [{ datetime: '2026-08-19T16:00:00.000Z' }],
			...over
		});
	}

	it('disables all four buttons for an event that has already started', async () => {
		const { container } = renderRsvpPage({ event: pastEvent() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		for (const btn of rsvpButtons(container)) expect(btn.disabled).toBe(true);
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('a tap on a past event writes nothing', async () => {
		const { container, fetchStub } = renderRsvpPage({ event: pastEvent() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);
		const posts = fetchStub.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(posts).toEqual([]);
	});

	it('an UPCOMING event stays interactive (the past gate is the clock, not a blanket disable)', async () => {
		const { container } = renderRsvpPage(); // fixture starts 2026-09-01, after NOW
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going.disabled).toBe(false);
		});
	});

	it('an event with no parseable start is NOT treated as past (unknown ≠ over)', async () => {
		const { container } = renderRsvpPage({ event: eventEntity({ start_datetime: [] }) });
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going.disabled).toBe(false);
		});
	});
});

describe('/event/[id] — the tally refreshes after the editor changes her OWN rsvp (#102 review F4)', () => {
	function mutatingTallyWire() {
		const base = rsvpWireStub({ event: editorEvent() });
		let mine = 'going';
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.includes('/entity/rsvp-77') && method === 'POST') {
				mine = 'maybe';
				return json({});
			}
			if (
				url.includes('_type.string=rsvp') &&
				url.includes('event.reference=ev1') &&
				!url.includes('_parent.reference=')
			) {
				const rows = allRsvpsForEv1();
				rows[0] = {
					_id: 'rsvp-77',
					member: [{ reference: 'member-1' }],
					status: [{ string: mine }]
				};
				return json({ entities: rows });
			}
			return base(input, init);
		});
	}

	it('re-reads the counts on a successful write — going drops, maybe rises, capacity follows', async () => {
		const { container: c } = renderWithFetch(mutatingTallyWire());
		await waitFor(() => {
			expect(
				c.querySelector('[data-testid="event-detail-tally-going"]')?.textContent
			).toContain('12');
			const maybe = c.querySelector('[data-testid="rsvp-btn-maybe"]') as HTMLButtonElement;
			expect(maybe.disabled).toBe(false);
		});
		expect(c.querySelector('[data-testid="event-detail-capacity"]')!.textContent).toContain('12');

		await fireEvent.click(c.querySelector('[data-testid="rsvp-btn-maybe"]')!);

		await waitFor(() => {
			expect(c.querySelector('[data-testid="event-detail-tally-going"]')!.textContent).toContain(
				'11'
			);
		});
		expect(c.querySelector('[data-testid="event-detail-tally-maybe"]')!.textContent).toContain('2');
		expect(c.querySelector('[data-testid="event-detail-capacity"]')!.textContent).toContain('11');
	});

	it("a plain member's F4 re-fetch DOES issue the cross-person tally read, same as the initial load (#363)", async () => {
		const { container, fetchStub } = renderRsvpPage(); // default fixture: no rights visible
		await waitFor(() => {
			const maybe = container.querySelector('[data-testid="rsvp-btn-maybe"]') as HTMLButtonElement;
			expect(maybe.disabled).toBe(false);
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);
		await waitFor(() => {
			const posts = fetchStub.mock.calls.filter(
				(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
			);
			expect(posts.length).toBeGreaterThan(0);
		});
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(
			urls.some((u) => u.includes('event.reference=ev1') && !u.includes('_parent.reference='))
		).toBe(true);
	});
});

describe('/event/[id] — a write that settles after a collective switch never lands (#102 review round 2, F1)', () => {
	function switchedCollectiveWire() {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const poly = rsvpWireStub({}, { myRsvp: true });
		const vox = rsvpWireStub({}, { myRsvp: false });
		const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/entity/rsvp-77') && (init?.method ?? 'GET') === 'POST') {
				await gate;
				return json({});
			}
			return url.includes('/vox/') ? vox(input, init) : poly(input, init);
		});
		return { fetchStub, release: () => release() };
	}

	function renderWithTwoCollectives(fetchStub: ReturnType<typeof vi.fn>) {
		vi.stubGlobal('fetch', fetchStub);
		pageStub.params = { id: 'ev1' };
		pageStub.url = new URL('http://localhost/event/ev1');
		authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'p-viewer', vox: 'p-viewer' },
			expMs: Date.now() + 100_000
		});
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'p-viewer' },
				{ db: 'vox', name: 'Vox', personId: 'p-viewer' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('sampledb');
		return { ...render(Page), fetchStub };
	}

	it('the stale reconcile does not seed the control — and the next tap never rewrites the OTHER db rsvp entity', async () => {
		const { fetchStub, release } = switchedCollectiveWire();
		const { container } = renderWithTwoCollectives(fetchStub);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
			const maybe = container.querySelector('[data-testid="rsvp-btn-maybe"]') as HTMLButtonElement;
			expect(maybe.disabled).toBe(false);
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);

		selectedCollectiveDbStore.set('vox');
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going.disabled).toBe(false);
			for (const btn of rsvpButtons(container))
				expect(btn.getAttribute('aria-pressed')).toBe('false');
		});

		release();
		await new Promise((r) => setTimeout(r, 30));
		for (const btn of rsvpButtons(container))
			expect(btn.getAttribute('aria-pressed'), 'a superseded write seeded the control').toBe(
				'false'
			);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-going"]')!);
		await new Promise((r) => setTimeout(r, 30));
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(
			urls.filter((u) => u.includes('rsvp-77')).every((u) => u.includes('/sampledb/')),
			'rsvp-77 was touched in the vox db'
		).toBe(true);
	});
});

describe('/event/[id] — a FAILED tally read is surfaced, not silently collapsed (#102 review round 2, F2)', () => {
	function failingTallyWire(failTimes = Number.POSITIVE_INFINITY) {
		const base = rsvpWireStub({ event: editorEvent() });
		let left = failTimes;
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (
				url.includes('_type.string=rsvp') &&
				url.includes('event.reference=ev1') &&
				!url.includes('_parent.reference=') &&
				left > 0
			) {
				left -= 1;
				return json({ message: 'boom' }, 500);
			}
			return base(input, init);
		});
	}

	it('shows an error line (and logs) instead of the plain-member view — no tally, no capacity', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = renderWithFetch(failingTallyWire());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-tally"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).toBeNull();
		expect(
			errorSpy.mock.calls.some((c) => c.some((a) => String(a).includes('tally'))),
			'the failure was not logged'
		).toBe(true);
		errorSpy.mockRestore();
	});

	it('Retry re-reads the counts and clears the error line', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = renderWithFetch(failingTallyWire(1));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-error"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-detail-tally-retry"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-tally-going"]')?.textContent
			).toContain('12');
		});
		expect(container.querySelector('[data-testid="event-detail-tally-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-capacity"]')!.textContent).toContain(
			'12'
		);
		errorSpy.mockRestore();
	});

	it("a plain member's FAILED tally read shows HER the error line + Retry (#363)", async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const base = rsvpWireStub(); // default fixture: no rights visible
		const failing = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (
				url.includes('_type.string=rsvp') &&
				url.includes('event.reference=ev1') &&
				!url.includes('_parent.reference=')
			)
				return json({ message: 'boom' }, 500);
			return base(input, init);
		});
		const { container } = renderWithFetch(failing);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-tally-retry"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="event-detail-tally"]')).toBeNull();
		errorSpy.mockRestore();
	});
});

function pastEventEntity(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({
		start_datetime: [{ datetime: '2026-08-19T16:00:00.000Z' }],
		...over
	});
}

function conductorSeason(over: Partial<Record<string, unknown>> = {}) {
	return seasonEntity({
		conductor: [{ reference: 'p-viewer' }, { reference: 'p-mihkel' }],
		...over
	});
}

function editorSeason(over: Partial<Record<string, unknown>> = {}) {
	return seasonEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}

const VIEWER_PROFILE: Record<string, unknown[]> = {
	'p-viewer': [
		{ _id: 'prof-v', name: [{ string: 'Viewer Vera' }], _sharing: [{ string: 'domain' }] }
	]
};

function repertoireItemsFixture(): unknown[] {
	return [
		{
			_id: 'ri-1',
			name: [{ string: 'Bogoróditse Djévo' }],
			work: [{ reference: 'w-1' }],
			status: [{ string: 'active' }]
		},
		{
			_id: 'ri-2',
			name: [{ string: 'Locus iste' }],
			work: [{ reference: 'w-2' }],
			status: [{ string: 'learning' }]
		}
	];
}

function programItemsFixture(): unknown[] {
	return [
		{
			_id: 'pi-1',
			name: [{ string: 'Bogoróditse Djévo' }],
			edition: [{ reference: 'ed-1' }],
			ordinal: [{ number: 0 }]
		},
		{
			_id: 'pi-2',
			name: [{ string: 'Locus iste' }],
			edition: [{ reference: 'ed-2' }],
			ordinal: [{ number: 1 }]
		}
	];
}

function libraryWorksFixture(): unknown[] {
	return [
		{ _id: 'w-1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Arvo Pärt' }] },
		{ _id: 'w-2', name: [{ string: 'Locus iste' }], composer: [{ string: 'Anton Bruckner' }] }
	];
}

function activeMembersFixture(): unknown[] {
	const org = [{ reference: 'org1', entity_type: 'organization' }];
	return [
		{ _id: 'member-1', person: [{ reference: 'p-viewer' }], _parent: org },
		{ _id: 'member-2', person: [{ reference: 'p-mihkel' }], _parent: org },
		{ _id: 'member-3', person: [{ reference: 'p-alice' }], _parent: org },
		{ _id: 'member-4', person: [{ reference: 'p-guest' }], _parent: org }
	];
}

type AttendanceRaw = {
	_id: string;
	member?: Array<{ reference: string }>;
	status?: Array<{ string: string }>;
};

function attendanceForEv1(): AttendanceRaw[] {
	return [
		{ _id: 'att-1', member: [{ reference: 'member-1' }], status: [{ string: 'present' }] },
		{ _id: 'att-2', member: [{ reference: 'member-2' }], status: [{ string: 'present' }] },
		{ _id: 'att-3', member: [{ reference: 'member-3' }], status: [{ string: 'absent' }] },
		{ _id: 'att-4', member: [{ reference: 'member-4' }], status: [{ string: 'late' }] }
	];
}

type ComposeFixtures = Fixtures & {
	programItems?: unknown[];
	repertoireItems?: unknown[];
	works?: unknown[];
	editions?: unknown[];
	copies?: unknown[];
	members?: unknown[];
	workCount?: number;
	editionCount?: number;
	memberCount?: number;
	attendance?: AttendanceRaw[];
	realNames?: boolean | 'off';
};

const RN_DB_ENTITY = 'db-ent-fence';

const RN_RECORD_NAMES: Record<string, string> = {
	'p-viewer': 'Zoe Zeta',
	'p-mihkel': 'Aaron Aardvark',
	'p-alice': 'Yuri Yew',
	'p-guest': 'Bruno Birch'
};

function composeWireStub(fixtures: ComposeFixtures = {}) {
	const profiles = { ...PROFILES, ...VIEWER_PROFILE, ...(fixtures.profiles ?? {}) };
	const base = rsvpWireStub({
		event: fixtures.event,
		season: fixtures.season,
		series: fixtures.series,
		profiles
	});
	const programItems = fixtures.programItems ?? [];
	const repertoireItems = fixtures.repertoireItems ?? repertoireItemsFixture();
	const works = fixtures.works ?? libraryWorksFixture();
	const editions = fixtures.editions ?? [];
	const copies = fixtures.copies ?? [];
	const members = fixtures.members ?? activeMembersFixture();
	const attendance = fixtures.attendance ?? attendanceForEv1();
	const myAttendance = attendance
		.filter((r) => r.member?.[0]?.reference === 'member-1')
		.map((r) => ({ _id: r._id, _parent: [{ reference: 'ev1' }], status: r.status }));
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (fixtures.realNames) {
			if (url.includes('_type.string=admin_member_record')) {
				return json({
					entities: Object.entries(RN_RECORD_NAMES).map(([personId, name]) => ({
						_id: `rec-${personId}`,
						person: [{ reference: personId }],
						name: [{ string: name }]
					}))
				});
			}
			if (url.includes('_type.string=database')) {
				return json({ entities: [{ _id: RN_DB_ENTITY }] });
			}
			if (url.includes(`entity/${RN_DB_ENTITY}`) && url.includes('roster_show_real_names')) {
				return json({
					entity: {
						_id: RN_DB_ENTITY,
						roster_show_real_names: [
							{ _id: 'v-toggle', boolean: fixtures.realNames !== 'off' }
						]
					}
				});
			}
		}
		if (url.includes('_type.string=program_item')) return json({ entities: programItems });
		if (url.includes('_type.string=repertoire_item')) return json({ entities: repertoireItems });
		if (url.includes('_type.string=work'))
			return json(
				fixtures.workCount === undefined
					? { entities: works }
					: { count: fixtures.workCount, entities: works }
			);
		if (url.includes('_type.string=edition'))
			return json(
				fixtures.editionCount === undefined
					? { entities: editions }
					: { count: fixtures.editionCount, entities: editions }
			);
		if (url.includes('_type.string=copy')) return json({ entities: copies });
		if (url.includes('_type.string=member') && !url.includes('person.reference'))
			return json(
				fixtures.memberCount === undefined
					? { entities: members }
					: { count: fixtures.memberCount, entities: members }
			);
		if (url.includes('_type.string=attendance')) {
			if (url.includes('_parent.reference=ev1')) return json({ entities: attendance });
			if (url.includes('member.reference=member-1')) return json({ entities: myAttendance });
			return json({ entities: [] });
		}
		return base(input, init);
	});
}

function renderComposePage(fixtures: ComposeFixtures = {}) {
	return renderWithFetch(composeWireStub(fixtures));
}

describe('/event/[id] — works section (#103 TE.3: RepertoireElement, always expanded)', () => {
	it('renders the works section with the rows ALREADY expanded — work names + composers, no tap needed', async () => {
		const { container, fetchStub } = renderComposePage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;

		expect(section.querySelector('[data-testid="works-expanded"]')).not.toBeNull();
		const rows = [...section.querySelectorAll('[data-testid="work-row"]')];
		expect(rows).toHaveLength(2);
		const text = rows.map((r) => r.textContent ?? '').join(' ');
		expect(text).toContain('Bogoróditse Djévo');
		expect(text).toContain('Locus iste');
		expect(text).toContain('Arvo Pärt');
		expect(text).toContain('Anton Bruckner');

		const line = section.querySelector('[data-testid="works-line"]');
		if (line) expect(line.getAttribute('aria-expanded')).toBe('true');

		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=program_item') && u.includes('ev1'))).toBe(
			true
		);
		expect(
			urls.some((u) => u.includes('_type.string=repertoire_item') && u.includes('season1'))
		).toBe(true);
	});

	it('management controls render for a season rights-holder (_editor on the parent season)', async () => {
		const { container } = renderComposePage({ season: editorSeason() });
		await waitFor(() => {
			expect(
				container.querySelectorAll('[data-testid="work-row"]').length
			).toBeGreaterThan(0);
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;
		expect(section.querySelectorAll('[data-testid="work-status-active"]')).toHaveLength(2);
		expect(section.querySelectorAll('[data-testid="work-manage-remove"]')).toHaveLength(2);
		expect(section.querySelector('[data-testid="work-manage-add-work"]')).not.toBeNull();
	});

	it('reads the event and the season ONCE each — no second GET for the parent id or for season rights', async () => {
		const { container, fetchStub } = renderComposePage({ season: editorSeason() });
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('/entity/ev1'))).toHaveLength(1);
		expect(urls.filter((u) => u.includes('/entity/season1'))).toHaveLength(1);
	});

	it('a season editor sees the RETIRED rows too — includeInactive rides on the same read as the rights', async () => {
		const { container } = renderComposePage({
			season: editorSeason(),
			repertoireItems: [
				...repertoireItemsFixture(),
				{
					_id: 'ri-3',
					name: [{ string: 'Ave Maria' }],
					work: [{ reference: 'w-3' }],
					status: [{ string: 'retired' }]
				}
			],
			works: [
				...libraryWorksFixture(),
				{ _id: 'w-3', name: [{ string: 'Ave Maria' }], composer: [{ string: 'Josquin' }] }
			]
		});
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(3);
		});
		expect(
			container.querySelector('[data-testid="event-detail-works"]')!.textContent
		).toContain('Ave Maria');
	});

	it('a plain member reads the works with NO management controls (default season: no rights visible)', async () => {
		const { container } = renderComposePage();
		await waitFor(() => {
			expect(
				container.querySelectorAll('[data-testid="work-row"]').length
			).toBeGreaterThan(0);
		});
		expect(container.querySelector('[data-testid="work-status-active"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-remove"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
	});

	it('NO works section at all when the event resolves no works — never an empty placeholder', async () => {
		const { container } = renderComposePage({ programItems: [], repertoireItems: [] });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-works"]')).toBeNull();
		expect(container.querySelector('[data-testid="works-line"]')).toBeNull();
		expect(container.querySelector('[data-testid="work-row"]')).toBeNull();
	});

	it('a PROGRAMMED event shows the PROGRAMME surface — per-row move/remove for an event editor, as on the agenda', async () => {
		const { container } = renderComposePage({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: editorSeason(),
			programItems: programItemsFixture()
		});
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;
		expect(section.querySelectorAll('[data-testid="work-manage-move-up"]')).toHaveLength(2);
		expect(section.querySelectorAll('[data-testid="work-manage-move-down"]')).toHaveLength(2);
		expect(section.querySelectorAll('[data-testid="work-manage-remove"]')).toHaveLength(2);
		expect(section.querySelector('[data-testid="work-manage-add-programme"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="work-manage-add-work"]')).toBeNull();
		expect(section.querySelector('[data-testid="work-status-active"]')).toBeNull();
	});
});

describe('/event/[id] — #311: the Add Work picker keys hiding off "nothing left to pick once loading COMPLETED SUCCESSFULLY"', () => {
	function worksHoldStub(
		fixtures: ComposeFixtures = {},
		{ failWorks = false, armed = false }: { failWorks?: boolean; armed?: boolean } = {}
	) {
		const base = composeWireStub(fixtures);
		const held: Array<(r: Response) => void> = [];
		let holdArmed = armed;
		const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if ((init?.method ?? 'GET') === 'GET' && url.includes('_type.string=work')) {
				if (failWorks) return json({ error: 'boom' }, 500);
				if (holdArmed) return new Promise<Response>((resolve) => held.push(resolve));
			}
			return base(input, init);
		});
		return {
			stub,
			heldCount: () => held.length,
			async releaseWorkReads() {
				holdArmed = false;
				for (const resolve of held.splice(0, held.length)) {
					resolve(await base('https://api.entu-test.invalid/sampledb/search?_type.string=work'));
				}
			}
		};
	}

	it('load completes with every library work already in the repertoire → select and button GONE, wrapper and rows stand', async () => {
		const { container } = renderComposePage({ season: editorSeason() });
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		const section = container.querySelector('[data-testid="event-detail-works"]')!;
		await waitFor(() => {
			expect(section.querySelector('[data-testid="work-manage-add-work-select"]')).toBeNull();
		});
		expect(section.querySelector('[data-testid="work-manage-add-work-button"]')).toBeNull();
		expect(section.querySelector('[data-testid="work-manage-add-work"]')).not.toBeNull();
		expect(section.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
	});

	it('while the picker load is IN FLIGHT the select stays (still loading is not empty), and settles to the real options', async () => {
		const world = worksHoldStub(
			{
				season: editorSeason(),
				works: [
					...libraryWorksFixture(),
					{ _id: 'w-3', name: [{ string: 'Ave Maria' }], composer: [{ string: 'Josquin' }] }
				]
			},
			{ armed: true }
		);
		const { container } = renderWithFetch(world.stub);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
		});
		await waitFor(() => {
			expect(world.heldCount()).toBeGreaterThan(0);
		});
		expect(
			container.querySelector('[data-testid="work-manage-add-work-select"]'),
			'picker load in flight → the select must not be withheld off a still-loading list'
		).not.toBeNull();

		await world.releaseWorkReads();
		await waitFor(() => {
			const select = container.querySelector(
				'[data-testid="work-manage-add-work-select"]'
			) as HTMLSelectElement | null;
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="w-3"]')).not.toBeNull();
		});
	});

	it('the picker load FAILS → the select stays — the catch’s visible-but-empty choice stands, a failed load never hides', async () => {
		const world = worksHoldStub({ season: editorSeason() }, { failWorks: true });
		const { container } = renderWithFetch(world.stub);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await new Promise((r) => setTimeout(r, 30));
		const section = container.querySelector('[data-testid="event-detail-works"]');
		expect(section, 'the editor still gets the works section').not.toBeNull();
		expect(
			section!.querySelector('[data-testid="work-manage-add-work-select"]'),
			'a FAILED load must never hide the control'
		).not.toBeNull();
	});
});

describe('/event/[id] — the repertoire pickers state a truncated library read (#321 review F2)', () => {
	const WORK_OPTION = 'work-manage-add-work-partial-option';
	const PROGRAMME_OPTION = 'work-manage-add-programme-partial-option';

	function worksWithSomethingPickable(): unknown[] {
		return [
			...libraryWorksFixture(),
			{ _id: 'w-3', name: [{ string: 'Ave Maria' }], composer: [{ string: 'Josquin' }] }
		];
	}

	it('a truncated WORK read puts a trailing disabled option inside the Add-work select', async () => {
		const { container } = renderComposePage({
			season: editorSeason(),
			works: worksWithSomethingPickable(),
			workCount: 900
		});

		await waitFor(() => {
			expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).not.toBeNull();
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-work-select"]'
		) as HTMLSelectElement;
		const options = Array.from(select.options);
		const last = options[options.length - 1];
		expect(last.getAttribute('data-testid')).toBe(WORK_OPTION);
		expect(last.disabled).toBe(true);
		expect(container.querySelector(`[data-testid="${PROGRAMME_OPTION}"]`)).toBeNull();
	});

	it('with the reads complete the option is ABSENT from the select', async () => {
		const { container } = renderComposePage({
			season: editorSeason(),
			works: worksWithSomethingPickable()
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="work-manage-add-work-select"]')).not.toBeNull();
		});

		expect(container.querySelector(`[data-testid="${WORK_OPTION}"]`)).toBeNull();
	});
});

describe('/event/[id] — attendance surfaces on a PAST event (#103 TE.3)', () => {
	it("shows the viewer's OWN attendance badge (member-1 was recorded present)", async () => {
		const { container, fetchStub } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-attendance"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-attendance-badge"]');
		expect(badge).not.toBeNull();
		const rendered = `${badge!.textContent ?? ''} ${badge!.getAttribute('aria-label') ?? ''}`;
		expect(rendered).toContain('attendance_status_present');
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=attendance'))).toBe(true);
	});

	it('shows the attendance tally — per-status counts from the child-of-event read (2 present / 1 absent / 1 late)', async () => {
		const { container } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-attendance-tally"]')
			).not.toBeNull();
		});
		const count = (s: string) =>
			container.querySelector(`[data-testid="event-detail-attendance-tally-${s}"]`);
		expect(count('present'), 'tally-present missing').not.toBeNull();
		expect(count('present')!.textContent).toContain('2');
		expect(count('absent')!.textContent).toContain('1');
		expect(count('late')!.textContent).toContain('1');
	});

	it("offers 'Take attendance' to a CONDUCTOR and opens the real AttendanceSurface over the real roster", async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason()
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});

		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-member-1"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="attendance-row-member-1"]')!.textContent
		).toContain('Viewer Vera');
		expect(container.querySelector('[data-testid="attendance-row-member-2"]')).not.toBeNull();

		expect(
			container
				.querySelector('[data-testid="attendance-toggle-member-1-present"]')
				?.getAttribute('aria-pressed')
		).toBe('true');
		expect(
			container
				.querySelector('[data-testid="attendance-toggle-member-3-absent"]')
				?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it("the attendance panel shows REAL names with the toggle ON — one toggle read, one records read, profile name gone (#469, supersedes the #269 roster-only ruling)", async () => {
		const { container, fetchStub } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			realNames: true
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		const before = fetchStub.mock.calls.length;
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-member-1"]')).not.toBeNull();
		});

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="attendance-row-member-1"]')!.textContent
			).toContain(RN_RECORD_NAMES['p-viewer']);
		});
		const panel = container.querySelector('[data-testid="attendance-panel"]')!;
		expect(panel.textContent).toContain(RN_RECORD_NAMES['p-mihkel']);
		expect(panel.textContent).not.toContain('Viewer Vera');

		const opened = fetchStub.mock.calls.slice(before).map((c) => String(c[0]));
		expect(opened.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(opened.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
	});

	it('the header names the conductors by their REAL names with the toggle ON (#469 review F3)', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			realNames: true
		});
		const line = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain(RN_RECORD_NAMES['p-mihkel']);
			return el!;
		});
		expect(line.textContent).toContain(RN_RECORD_NAMES['p-viewer']);
		expect(line.textContent).not.toContain('Mihkel Putrinš');
		expect(line.textContent).not.toContain('Viewer Vera');
	});

	it('the header keeps the conductors\' PROFILE names with the toggle OFF, spending no records read (#469 review F3)', async () => {
		const { container, fetchStub } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			realNames: 'off'
		});
		const line = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain('Mihkel Putrinš');
			return el!;
		});
		for (const recordName of Object.values(RN_RECORD_NAMES)) {
			expect(line.textContent).not.toContain(recordName);
		}
		expect(
			fetchStub.mock.calls
				.map((c) => String(c[0]))
				.filter((u) => u.includes('admin_member_record'))
		).toEqual([]);
	});

	it("the attendance panel keeps PROFILE names with the toggle OFF — the toggle is read (once), no records request is ever issued (#469)", async () => {
		const { container, fetchStub } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			realNames: 'off'
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-member-1"]')).not.toBeNull();
		});

		expect(
			container.querySelector('[data-testid="attendance-row-member-1"]')!.textContent
		).toContain('Viewer Vera');
		for (const recordName of Object.values(RN_RECORD_NAMES)) {
			expect(container.textContent).not.toContain(recordName);
		}

		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(2);
	});

	it('the RSVP tally card names a PAST event\'s respondents by their REAL names with the toggle ON — resolved via loadRosterIncludingArchived (#469)', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity(),
			realNames: true
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-toggle"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-detail-tally-toggle"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-card"]')).not.toBeNull();
		});

		const card = container.querySelector('[data-testid="event-detail-tally-card"]')!;
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-tally-card-group-going"]')!.textContent
			).toContain(RN_RECORD_NAMES['p-viewer']);
		});
		expect(card.textContent).not.toContain('Viewer Vera');
	});

	it('the RSVP tally card renders each respondent name through the capture marker, exactly once (#361)', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity(),
			realNames: true
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally-toggle"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-detail-tally-toggle"]')!);
		const group = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-tally-card-group-going"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain(RN_RECORD_NAMES['p-viewer']);
			return el!;
		});
		expectNameMarkedOnce(group, RN_RECORD_NAMES['p-viewer'], 'in the RSVP tally card');
	});

	it("a NON-conductor gets the badge and tally but NO 'Take attendance'", async () => {
		const { container } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-attendance-tally"]')
			).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
	});

	it('NO attendance section on a past event with NOTHING recorded — a plain member gets no empty placeholder', async () => {
		const { container } = renderComposePage({ event: pastEventEntity(), attendance: [] });
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-badge"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-tally"]')).toBeNull();
	});

	it("a CONDUCTOR still gets the section on a past event with nothing recorded — 'Take attendance' needs somewhere to live", async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			attendance: []
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-tally"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="event-detail-attendance-tally-present"]')
		).toBeNull();
	});

	it("the badge is the agenda's own component — colour dot (aria-hidden) + data-status", async () => {
		const { container } = renderComposePage({ event: pastEventEntity() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-attendance-badge"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-attendance-badge"]')!;
		expect(badge.getAttribute('data-status')).toBe('present');
		const dot = badge.querySelector('.rounded-full');
		expect(dot, 'the badge must carry the status dot the agenda badge carries').not.toBeNull();
		expect(dot!.getAttribute('aria-hidden')).toBe('true');
	});

	it('NO attendance section on a FUTURE event — even for a conductor', async () => {
		const { container } = renderComposePage({ season: conductorSeason() });
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going).not.toBeNull();
			expect(going.disabled).toBe(false);
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-badge"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance-tally"]')).toBeNull();
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});
});

describe('/event/[id] — composing both sections (#103 TE.3)', () => {
	it('BOTH sections absent when there is nothing to show (future event, no works) — the page stays whole', async () => {
		const { container } = renderComposePage({ programItems: [], repertoireItems: [] });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-works"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-attendance"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
		expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
	});

	it('integration: ONE page composes header + rsvp + works (expanded, managed) + attendance (badge, tally, surface) from the existing components', async () => {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: seasonEntity({
				conductor: [{ reference: 'p-viewer' }],
				_editor: [{ reference: 'p-viewer' }]
			})
		});

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-works"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-attendance"]')).not.toBeNull();
		});

		const worksSection = container.querySelector('[data-testid="event-detail-works"]')!;
		await waitFor(() => {
			expect(worksSection.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
		});
		expect(worksSection.querySelector('[data-testid="works-expanded"]')).not.toBeNull();
		expect(
			worksSection.querySelector('[data-testid="work-status-active"]')
		).not.toBeNull();

		const attSection = container.querySelector('[data-testid="event-detail-attendance"]')!;
		await waitFor(() => {
			expect(
				attSection.querySelector('[data-testid="event-detail-attendance-tally"]')
			).not.toBeNull();
		});
		expect(attSection.querySelector('[data-testid="event-detail-attendance-badge"]')).not.toBeNull();
		expect(attSection.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();

		await fireEvent.click(attSection.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(attSection.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
			expect(attSection.querySelector('[data-testid="attendance-row-member-1"]')).not.toBeNull();
		});

		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
		expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
	});
});

describe('/event/[id] — "Add to programme" picker shows composer (#204)', () => {
	it('labels read "Work - Composer — Edition"; a composerless work keeps its bare name — no dangling " - "', async () => {
		const { container } = renderComposePage({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: editorSeason(),
			programItems: programItemsFixture(),
			works: [
				{ _id: 'w-1', name: [{ string: 'Bogoróditse Djévo' }], composer: [{ string: 'Arvo Pärt' }] },
				{ _id: 'w-2', name: [{ string: 'Locus iste' }], composer: [{ string: 'Anton Bruckner' }] },
				{ _id: 'w-3', name: [{ string: 'Ubi caritas' }] }
			],
			editions: [
				{
					_id: 'ed-1',
					name: [{ string: 'Edition A' }],
					_parent: [{ reference: 'w-1', entity_type: 'work' }]
				},
				{
					_id: 'ed-2',
					name: [{ string: 'Edition B' }],
					_parent: [{ reference: 'w-2', entity_type: 'work' }]
				},
				{
					_id: 'ed-3',
					name: [{ string: 'Edition C' }],
					_parent: [{ reference: 'w-1', entity_type: 'work' }]
				},
				{
					_id: 'ed-4',
					name: [{ string: 'Edition D' }],
					_parent: [{ reference: 'w-3', entity_type: 'work' }]
				}
			]
		});

		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid="work-row"]').length).toBe(2);
			const sel = container.querySelector(
				'[data-testid="work-manage-add-programme-select"]'
			) as HTMLSelectElement | null;
			expect(sel).not.toBeNull();
			expect(sel!.querySelectorAll('option').length).toBe(3);
		});
		const select = container.querySelector(
			'[data-testid="work-manage-add-programme-select"]'
		) as HTMLSelectElement;
		const labels = [...select.querySelectorAll('option')]
			.filter((o) => (o as HTMLOptionElement).value !== '')
			.map((o) => (o.textContent ?? '').trim());
		expect(labels).toEqual([
			'Bogoróditse Djévo - Arvo Pärt — Edition C',
			'Ubi caritas — Edition D'
		]);
	});
});

// (*MVOX:Tallis*, *MVOX:Josquin*, *MVOX:Palestrina*)

describe('/event/[id] — type badge color scheme (#211)', () => {
	const styles = () =>
		import('$lib/events/eventTypeStyles') as Promise<{
			eventTypeBadgeClass: (type: string | undefined) => string;
		}>;

	const expectClasses = (badge: Element, classString: string) => {
		for (const cls of classString.split(/\s+/)) {
			expect(badge.classList.contains(cls), `badge missing class '${cls}'`).toBe(true);
		}
	};

	it("a rehearsal's badge carries eventTypeBadgeClass('rehearsal') — label text intact", async () => {
		const { eventTypeBadgeClass } = await styles();
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass('rehearsal'));
		expect(badge.textContent).toContain('[event_type_rehearsal]');
		expect(badge.children.length).toBe(0);
	});

	it("a social event's badge keeps the quiet default — no type-* token at all", async () => {
		const { eventTypeBadgeClass } = await styles();
		const { container } = renderEventPage({
			event: eventEntity({ event_type: [{ string: 'social' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass('social'));
		expect([...badge.classList].filter((cls) => cls.includes('type-'))).toEqual([]);
	});

	it("an UNKNOWN free-text type ('flashmob') keeps the quiet default and its raw label", async () => {
		const { eventTypeBadgeClass } = await styles();
		const { container } = renderEventPage({
			event: eventEntity({ event_type: [{ string: 'flashmob' }] })
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass(undefined));
		expect([...badge.classList].filter((cls) => cls.includes('type-'))).toEqual([]);
		expect(badge.textContent).toContain('flashmob');
	});
});

// (*MVOX:Tallis* — #211 RED: event-detail badge joins the type color scheme)

describe('/event/[id] — #220 AM/PM preference on the time line', () => {
	it("'ampm': the range renders BOTH ends explicit — '7:00 PM–8:30 PM' — and the narrative date stays untouched (rule 7)", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const { container } = renderEventPage();
			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
			});
			const timeLines = [...container.querySelectorAll('[data-testid="event-detail-time"]')];
			expect(timeLines.length).toBeGreaterThan(0);
			for (const el of timeLines) {
				const text = el.textContent ?? '';
				expect(text).toContain('7:00 PM–8:30 PM');
				expect(text).not.toContain('19:00');
				expect(text).not.toContain('20:30');
			}
			const date = container.querySelector('[data-testid="event-detail-date"]')!.textContent ?? '';
			expect(date).toMatch(/Tuesday/i);
			expect(date).toMatch(/September/i);
			expect(date).not.toMatch(/\b(AM|PM)\b/);
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'ampm', unknown duration: the line collapses to the START alone — '7:00 PM', no dash, no invented end", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const { container } = renderEventPage({
				event: eventEntity({ duration_minutes: [] }),
				series: seriesEntity({ duration_minutes: undefined })
			});
			await waitFor(() => {
				expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
			});
			const time =
				container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
			expect(time).toContain('7:00 PM');
			expect(time).not.toContain('–');
			expect(time).not.toContain('19:00');
			expect(time.match(/7:00 PM/g)).toHaveLength(1);
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'24h' (the unset default): byte-identical to today — '19:00' and '20:30', no AM/PM suffix anywhere in the line", async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-time"]')).not.toBeNull();
		});
		const time = container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
		expect(time).toContain('19:00');
		expect(time).toContain('20:30');
		expect(time).not.toMatch(/\b(AM|PM)\b/);
	});
});

describe('/event/[id] — the attendance panel states a truncated roster (#321 review F2)', () => {
	const NOTICE = '[data-testid="attendance-panel-partial-notice"]';

	async function openPanel(memberCount?: number) {
		const { container } = renderComposePage({
			event: pastEventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: conductorSeason(),
			memberCount
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-member-1"]')).not.toBeNull();
		});
		return container;
	}

	it('a member read whose count exceeds its rows raises the shared notice inside the panel', async () => {
		const container = await openPanel(500);

		await waitFor(() => {
			expect(container.querySelector(NOTICE)).not.toBeNull();
		});
		const notice = container.querySelector(NOTICE)!;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
		expect(
			container.querySelector(`[data-testid="attendance-panel"] ${NOTICE}`)
		).not.toBeNull();
	});

	it('a complete read leaves it ABSENT from the DOM', async () => {
		const container = await openPanel();
		expect(container.querySelector('[data-testid="attendance-row-member-2"]')).not.toBeNull();

		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Tallis* — #311 RED: the event page opts the Add Work picker into honest visibility)
// (*MVOX:Josquin* — #321 review F2: the attendance panel's closed-set roster notice)

const DOUBLED_PROFILES: Record<string, unknown[]> = {
	...PROFILES,
	'p-ada': [{ _id: 'prof-ada', name: [{ string: 'Ada Lovelace' }], _sharing: [{ string: 'domain' }] }],
	'p-grace': [
		{ _id: 'prof-grace', name: [{ string: 'Grace Hopper' }], _sharing: [{ string: 'domain' }] }
	],
	'p-other-ada': [
		{ _id: 'prof-other-ada', name: [{ string: 'Ada Lovelace' }], _sharing: [{ string: 'domain' }] }
	]
};

const DOUBLED_SEASON_CONDUCTORS = [
	{ reference: 'p-ada' },
	{ reference: 'p-ada' },
	{ reference: 'p-grace' }
];

describe('#483 loadEventDetail — a doubled conductor reference resolves to each person ONCE', () => {
	it('season conductors [ada, ada, grace], no event conductor → conductorIds [ada, grace], conductorNames aligned', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({ conductor: DOUBLED_SEASON_CONDUCTORS }),
			profiles: DOUBLED_PROFILES
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-ada', 'p-grace']);
		expect(detail.conductorNames).toEqual(['Ada Lovelace', 'Grace Hopper']);
	});

	it('the doubled person is resolved (profile read) ONCE — the dedupe happens before names are resolved', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({ conductor: DOUBLED_SEASON_CONDUCTORS }),
			profiles: DOUBLED_PROFILES
		});
		await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		const profileReadsFor = (personId: string) =>
			fetchImpl.mock.calls
				.map((c) => String(c[0]))
				.filter(
					(u) => u.includes('_type.string=profile') && u.includes(`_parent.reference=${personId}&`)
				);
		expect(profileReadsFor('p-ada').length).toBe(1);
		expect(profileReadsFor('p-grace').length).toBe(1);
	});

	it('event conductor values [ada, ada] (overriding a season that holds ada) → conductorIds [ada]', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({ conductor: [{ reference: 'p-ada' }, { reference: 'p-ada' }] }),
			season: seasonEntity({ conductor: [{ reference: 'p-ada' }, { reference: 'p-grace' }] }),
			profiles: DOUBLED_PROFILES
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-ada']);
		expect(detail.conductorNames).toEqual(['Ada Lovelace']);
	});

	it('two DIFFERENT people sharing a display name both stay — distinct by id, never by name', async () => {
		const fetchImpl = entuFetchStub({
			season: seasonEntity({
				conductor: [{ reference: 'p-ada' }, { reference: 'p-other-ada' }, { reference: 'p-ada' }]
			}),
			profiles: DOUBLED_PROFILES
		});
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(detail.conductorIds).toEqual(['p-ada', 'p-other-ada']);
		expect(detail.conductorNames).toEqual(['Ada Lovelace', 'Ada Lovelace']);
	});
});

describe('#483 /event/[id] header — a doubled season conductor is named ONCE, for everyone', () => {
	async function conductorLine(container: HTMLElement): Promise<string> {
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-conductors"]')?.textContent
			).toContain('Grace Hopper');
		});
		return (
			container.querySelector('[data-testid="event-detail-conductors"]')?.textContent ?? ''
		).trim();
	}

	it('a NON-editor reader sees "Ada Lovelace" exactly once', async () => {
		const { container } = renderEventPage({
			season: seasonEntity({ conductor: DOUBLED_SEASON_CONDUCTORS }),
			profiles: DOUBLED_PROFILES
		});
		const line = await conductorLine(container);
		expect(container.querySelector('[data-testid="event-edit-btn-name"]')).toBeNull();
		expect(line).toBe('[event_detail_conductor_label]: Ada Lovelace, Grace Hopper');
		expect(line.split('Ada Lovelace').length - 1).toBe(1);
	});

	it('an EDITOR sees "Ada Lovelace" exactly once too — the header is not the place to fix the duplicate', async () => {
		const { container } = renderEventPage({
			event: eventEntity({ _editor: [{ reference: 'p-viewer' }] }),
			season: seasonEntity({
				conductor: DOUBLED_SEASON_CONDUCTORS,
				_editor: [{ reference: 'p-viewer' }]
			}),
			profiles: DOUBLED_PROFILES
		});
		const line = await conductorLine(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-name"]')).not.toBeNull();
		});
		expect(line).toBe('[event_detail_conductor_label]: Ada Lovelace, Grace Hopper');
		expect(line.split('Ada Lovelace').length - 1).toBe(1);
	});
});

// (*MVOX:Tallis* — #483 RED: a doubled season conductor is named once on the event page)

describe('#361 — /event/[id] header: each conductor name is marked', () => {
	it('each name sits in its own marker (exactly the name), the separator is outside every marker', async () => {
		const { container } = renderEventPage();
		const line = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-detail-conductors"]');
			expect(el).not.toBeNull();
			expect(el!.textContent).toContain('Mihkel Putrinš, Alice Smith');
			return el as HTMLElement;
		});
		expectNameMarkedOnce(line, 'Mihkel Putrinš', 'in the event header conductor line');
		expectNameMarkedOnce(line, 'Alice Smith', 'in the event header conductor line');
		const markers = [...line.querySelectorAll(`[${REDACT_ATTR}]`)].map((e) => e.textContent);
		expect(markers).toEqual(['Mihkel Putrinš', 'Alice Smith']);
	});
});

// (*MVOX:Tallis* — #361 RED: event header conductor names marked)
