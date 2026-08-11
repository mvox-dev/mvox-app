// @vitest-environment happy-dom
//
// #101 TE.1 (RED) — the event detail page at /event/[id]: header (name, type
// badge, time range, duration, location), conductor line, description, and the
// back-to-agenda link — plus the data layer that feeds it, including read-time
// series inheritance (same merge listRehearsals performs — entuSeasons.ts:104)
// and the #77 conductor model via resolveConductors (conductorLogic.ts).
//
// CONTRACT under test (defined HERE, implemented in GREEN):
//
//   src/lib/events/eventDetail.ts
//     export type EventDetail = {
//       id: string;
//       name: string;              // event value, else series name, else ''
//       eventType: string;         // event_type (e.g. 'rehearsal')
//       startDatetime: string;     // ISO
//       durationMinutes: number;   // event value, else series, else 0
//       location: string;          // event value, else series.default_location, else ''
//       description: string;       // event value, else series.default_description, else ''
//       conductorIds: string[];    // resolveConductors(season.conductor, event.conductor)
//       conductorNames: string[];  // display names, conductorIds order, nameless dropped
//     };
//     export async function loadEventDetail(
//       cfg: { db: string; token: string },
//       eventId: string,
//       fetchImpl?: typeof fetch
//     ): Promise<EventDetail>;
//
//   src/routes/event/[id]/+page.svelte
//     Reads the event id from $app/state page.params.id, loads via
//     loadEventDetail for the SELECTED collective (same store wiring as the
//     agenda +page.svelte), renders the header. data-testids:
//       event-detail-name / event-detail-type / event-detail-time /
//       event-detail-duration / event-detail-location /
//       event-detail-conductors / event-detail-description /
//       event-detail-back (an <a href="/">)
//
// Conductor NAMES come from the person's shared profile subset — the SAME
// domain-or-public rule the roster enforces (rosterData.ts toRosterRow): a
// PRIVATE-only name must never leak into the conductor line, and a person with
// no domain/public name is dropped from the display list (never rendered as a
// raw entity id — "Entity IDs need names" cuts both ways).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Full-fallback paraglide mock: every key resolves to a `[key {params}]` stub,
// so the page's (not-yet-written) i18n keys can never crash the mock. Copy
// assertions below therefore match on DATA (names, numbers, times), not on
// translated sentences.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

// Mutable $app/state stub — the route param the page must read.
const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const { gotoMock, discoverMock } = vi.hoisted(() => ({ gotoMock: vi.fn(), discoverMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Sever the $env walls (same hygiene as page.agenda-error.spec.ts): discover.ts
// and entu-config both reach $env/*, unavailable under happy-dom outside a
// SvelteKit request context. The REAL data layer keeps running against the
// stubbed base url.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

import Page from './+page.svelte';
import { loadEventDetail, EventDetailLoadError } from '$lib/events/eventDetail';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const cfg = { db: 'polyphony', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures ─────────────────────────────────────────────────────────────
// 2026-09-01T16:00Z = 19:00 Europe/Tallinn (EEST, UTC+3); +90 min → 20:30.

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ string: 'Tuesday Rehearsal' }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ number: 90 }],
		location: [{ string: 'Rehearsal Hall' }],
		description: [{ string: 'Come 15 minutes early for warm-ups.' }],
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

// Shared-profile fixtures per person id — the domain-or-public name source.
// p-alice ALSO carries a private-tier profile with a different name: the
// private name must never win (roster rule, #28/#58).
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

/**
 * A liberal Entu wire stub: serves the SAME fixtures whether the implementation
 * reads entities by id (`entity/{id}`) or by query (`_type.string=…`), so the
 * tests pin the CONTRACT (what renders / what resolves), not one query shape.
 */
function entuFetchStub(fixtures: Fixtures = {}) {
	const event = fixtures.event ?? eventEntity();
	const season = fixtures.season ?? seasonEntity();
	const series = fixtures.series ?? seriesEntity();
	const profiles = fixtures.profiles ?? PROFILES;
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
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
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
}

// ── data layer: loadEventDetail ───────────────────────────────────────────────

describe('loadEventDetail — full header shape', () => {
	it('fetches the event and maps the FULL EventDetail shape (event conductor empty → inherits season conductors)', async () => {
		const fetchImpl = entuFetchStub();
		const detail = await loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		// Full-shape toEqual, never objectContaining — partial assertions hide bugs.
		expect(detail).toEqual({
			id: 'ev1',
			name: 'Tuesday Rehearsal',
			eventType: 'rehearsal',
			startDatetime: '2026-09-01T16:00:00.000Z',
			durationMinutes: 90,
			location: 'Rehearsal Hall',
			description: 'Come 15 minutes early for warm-ups.',
			conductorIds: ['p-mihkel', 'p-alice'],
			conductorNames: ['Mihkel Putrinš', 'Alice Smith']
		});
	});

	it('throws on a non-2xx event response (fail loud, no silent empty detail)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(
			loadEventDetail(cfg, 'ev1', fetchImpl as unknown as typeof fetch)
		).rejects.toThrow();
	});
});

describe('loadEventDetail — series inheritance (read-time merge, verbatim listRehearsals semantics)', () => {
	it('missing name/duration/location/description fall back to the parent series values', async () => {
		const fetchImpl = entuFetchStub({
			event: eventEntity({
				name: undefined,
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

// ── page: /event/[id] renders the header from route data ─────────────────────
//
// INTEGRATION posture: the page is rendered with the REAL data layer running —
// only the global fetch is stubbed at the wire. This is what forces GREEN to
// actually wire loadEventDetail into the route (a page that renders its header
// from anything but the loaded detail cannot pass these).

function setAuthedWithPolyphony() {
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function renderEventPage(fixtures: Fixtures = {}) {
	const fetchStub = entuFetchStub(fixtures);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
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

		// start 16:00Z = 19:00 Europe/Tallinn; +90 min = 20:30 — BOTH ends shown.
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
		expect(urls.some((u) => u.includes('/polyphony/') && u.includes('ev1'))).toBe(true);
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

	// #101 review fix (F1) — the ← is MARKUP, not message text: translators get
	// words only, and the glyph is decorative (aria-hidden), so a screen reader
	// announces the link as its words, never "left arrow, back to agenda".
	it('renders the ← as decorative markup, not as part of the translated string', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-back"]')).not.toBeNull();
		});
		const back = container.querySelector('[data-testid="event-detail-back"]')!;
		const arrow = [...back.querySelectorAll('span')].find((s) => s.textContent?.includes('←'));
		expect(arrow, 'the ← lives in its own span').not.toBeUndefined();
		expect(arrow!.getAttribute('aria-hidden')).toBe('true');
		// The paraglide stub renders keys as `[event_detail_back]` — the arrow must
		// NOT be inside it (that would bake a glyph into the translators' string).
		expect(back.textContent).toContain('[event_detail_back]');
	});
});

// #101 review fix (F3) — every OTHER optional header field is {#if}-guarded; the
// type badge was the lone exception, so an event carrying no `event_type`
// rendered a bare bordered pill with nothing in it.
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

// #101 review fix (F1) — `loadEventDetail` defaults a missing `start_datetime`
// to '' and the header formatted it unguarded, so `Intl.DateTimeFormat.format`
// threw `RangeError: Invalid time value` DURING TEMPLATE RENDER. That throw is
// unreachable from the load's try/catch, so the page did not even degrade to its
// load-error surface: nothing of the header mounted at all. Entu's `mandatory`
// is a UI hint, not enforced, so a timeless event is representable data.
describe('/event/[id] — event with no start_datetime (renderable-invalid data)', () => {
	it('still renders the whole header; the time line is simply absent (no RangeError mid-render)', async () => {
		const { container } = renderEventPage({ event: eventEntity({ start_datetime: [] }) });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		// The header is WHOLE — everything except the one field with no data.
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
		// …and this is NOT the load-error surface: the load succeeded.
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

// #101 review fix (F2) — duration was the lone unguarded optional header field:
// an event with no duration on itself AND none on its series (loadEventDetail
// defaults to 0) showed a literal "0 min" and a degenerate "19:00–19:00".
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

// #101 review fix (F3) — the badge printed the raw Entu `event_type` string, the
// only user-visible string on this page that never passed through paraglide (an
// Estonian user read "REHEARSAL").
describe('/event/[id] — type badge is translated', () => {
	it('routes a KNOWN event_type through paraglide, not the raw Entu string', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		// The paraglide stub renders keys as `[key]` — seeing the key proves the
		// string went through the message layer rather than straight from Entu.
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
		const en = JSON.parse(readFileSync(resolve('messages/en.json'), 'utf8')) as Record<
			string,
			string
		>;
		const typeKeys = Object.keys(en).filter((k) => k.startsWith('event_type_'));
		expect(typeKeys.length).toBe(8); // the v4E schema's eight known event types
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(
				readFileSync(resolve(`messages/${locale}.json`), 'utf8')
			) as Record<string, string>;
			expect(
				typeKeys.filter((k) => !(k in messages)),
				`${locale}.json is missing event_type keys`
			).toEqual([]);
			expect(
				typeKeys.filter((k) => k in messages && messages[k].trim() === ''),
				`${locale}.json has empty event_type values`
			).toEqual([]);
			expect(
				'event_detail_not_in_collective' in messages,
				`${locale}.json is missing event_detail_not_in_collective`
			).toBe(true);
		}
	});
});

// #101 review fix (F4) — the agenda supplies each event's DATE through its
// day-group headers, which this page does not inherit: a bookmarked or shared
// /event/<id> showed "19:00–20:30" with no indication of WHICH DAY.
describe('/event/[id] — the date', () => {
	it('shows the Tallinn-zoned weekday + date alongside the time', async () => {
		const { container } = renderEventPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-date"]')).not.toBeNull();
		});
		// 2026-09-01T16:00Z is Tuesday 1 September in Europe/Tallinn. The formatter
		// is locale-aware (undefined locale, same as AgendaList's headerFmt), so
		// assert on the parts, not on one locale's word order.
		const date = container.querySelector('[data-testid="event-detail-date"]')!.textContent ?? '';
		expect(date).toMatch(/Tuesday/i);
		expect(date).toMatch(/September/i);
		expect(date).toContain('1');
		// …and it lives inside the time line, which still carries both ends.
		const time = container.querySelector('[data-testid="event-detail-time"]')!.textContent ?? '';
		expect(time).toContain('19:00');
		expect(time).toContain('20:30');
	});
});

// #101 review fix (F5) — the load effect depends on the selected collective, so
// switching collectives with a detail page open refetches the SAME id against
// the new db, where it 403/404s. The page offered a Retry button that could
// never succeed.
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
		setAuthedWithPolyphony();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-not-available"]')).not.toBeNull();
		});
		// Retry is the one action that cannot possibly help here.
		expect(container.querySelector('[data-testid="event-detail-retry"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-load-error"]')).toBeNull();
		// The back link — the action that DOES help — is still there.
		expect(container.querySelector('[data-testid="event-detail-back"]')).not.toBeNull();
	});

	it('still offers Retry for a genuinely transient failure (network throw)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('network down');
			})
		);
		pageStub.params = { id: 'ev1' };
		pageStub.url = new URL('http://localhost/event/ev1');
		setAuthedWithPolyphony();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-retry"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="event-detail-not-available"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — #101 TE.1 RED)
// (*MVOX:Josquin* — #101 TE.1 review fixes F1/F3)
// (*MVOX:Josquin* — #101 TE.1 review round 2, F1–F5)
