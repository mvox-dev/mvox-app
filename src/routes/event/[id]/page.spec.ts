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
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #102 review fix (F3) — the page now derives "this event is over" from the
// clock (a past event's RSVP is read-only, same boundary the agenda partitions
// on), so "now" has to be PINNED: otherwise this suite would start failing on
// 2026-09-01, when the fixture event slides into the past. Only `Date` is
// faked — setTimeout/setInterval stay real, so testing-library's waitFor keeps
// polling normally.
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

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
import { loadEventDetail, EventDetailLoadError, type EventDetail } from '$lib/events/eventDetail';
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
		// #102 TE.2 — capacity is part of the default fixture (a rehearsal hall
		// seats 20); `_editor` deliberately is NOT: rights props live in the private
		// bucket, so the DEFAULT viewer reads this event the way a plain member does
		// (no `_editor` visible at all). Editor-view tests opt in explicitly.
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
			conductorNames: ['Mihkel Putrinš', 'Alice Smith'],
			// #102 TE.2 — the contract grew: capacity (event.capacity, null when
			// unset) plus ownerIds/editorIds (the `_owner`/`_editor` refs VISIBLE to
			// this caller — private-bucket, so a non-granted reader gets []).
			capacity: 20,
			ownerIds: [],
			editorIds: []
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
	vi.useRealTimers();
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

// ═════════════════════════════════════════════════════════════════════════════
// #102 TE.2 (RED) — RSVP control + rights-gated tally + capacity on the detail
// page. Parent: #81 (Event detail 1.0). Maps to epic ACs AC-3/AC-4/AC-5/AC-9.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/lib/events/eventDetail.ts — EventDetail gains two fields:
//     capacity: number | null;   // event.capacity, null when unset (0 ≠ unset)
//     editorIds: string[];       // `_editor` refs VISIBLE to this caller.
//                                // Rights props live in the private bucket, so
//                                // a non-granted reader sees NONE — [] is both
//                                // "no editors" and "not allowed to know".
//
//   src/routes/event/[id]/+page.svelte — an RSVP section,
//   data-testid="event-detail-rsvp", holding:
//     • the SAME RsvpControl component the agenda rows use (rsvp-control /
//       rsvp-btn-{going,not_going,maybe,late} / rsvp-msg-line), seeded from the
//       SAME read primitives the agenda uses — findMyMemberId + listMyRsvps
//       (rsvpData) — so both surfaces read/write ONE rsvp entity per event.
//       A status change on an event with an existing rsvp goes through the
//       update path against THAT entity id (entity/{rsvpId}) — never a second
//       create (which would fork the answer into two entities, AC-3's failure
//       mode).
//     • the tally — data-testid="event-detail-tally", with per-status counts in
//       event-detail-tally-{going,not_going,maybe,late} — sourced from the
//       domain-tier listAllRsvpsForEvent read (attendanceData, the #82 widen
//       built exactly for conductor reads). Rendered ONLY when the viewer's
//       person id is in editorIds ("_editor on event" gate — #102 spec). The
//       epic offers formula props (`rsvp_going_count`) as an alternative
//       source; this RED pins the count-the-rsvps road because it works against
//       today's live schema with no new formula prop-defs.
//     • capacity — data-testid="event-detail-capacity", "N / M capacity" where
//       N = going count, M = event.capacity. SAME `_editor` gate as the tally;
//       absent entirely when capacity is null.
//
// Assertions match on DATA (counts, ids, pressed state), never on translated
// sentences — same posture as the header tests above (full-fallback paraglide
// proxy). Per-status tally counts get their own testids so the words around
// each number stay the translators' business.

/** The TE.2 EventDetail shape — an intersection so this spec typechecks BEFORE
 *  GREEN lands the fields (and stays a no-op after). */
type EventDetailTe2 = EventDetail & {
	capacity: number | null;
	ownerIds: string[];
	editorIds: string[];
};

/** An event whose `_editor` list the viewer CAN see and IS in — the tally gate's
 *  positive case. */
function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}

/** #102 review fix (F1) — the OTHER positive case: the viewer holds `_owner`
 *  and is NOT in `_editor`. Ownership subsumes editing everywhere else in the
 *  app (manageRightsFrom, repertoireActions.spec.ts:594). */
function ownerOnlyEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _owner: [{ reference: 'p-viewer' }], ...over });
}

/**
 * The 15 domain-visible rsvps for ev1: 12 going (the viewer's own rsvp-77 among
 * them), 2 not_going, 1 maybe, 0 late — the tally fixture. Shape matches what
 * listAllRsvpsForEvent's props=member,status read returns.
 */
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

/**
 * The TE.1 wire stub, extended with the RSVP routes: the viewer's active member
 * row, her OWN rsvp list (`_parent.reference=p-viewer` — the agenda's seeding
 * read), the all-rsvps-for-event read (`event.reference=ev1` — the tally
 * source), and the update path against rsvp-77 (GET → property DELETEs → POST).
 * Same liberal posture as entuFetchStub: it serves every road so the tests pin
 * the CONTRACT, not one fetch choreography.
 */
function rsvpWireStub(fixtures: Fixtures = {}, opts: { myRsvp?: boolean } = {}) {
	const base = entuFetchStub(fixtures);
	const myRsvp = opts.myRsvp ?? true;
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/')) return json({ deleted: true });
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') return json({});
			// updateRsvpStatus's lookup: current status value-id, event ref, sentinel.
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

/** Same render choreography, but with a caller-supplied wire — the review-fix
 *  cases need stubs that stall one route or mutate between reads. */
function renderWithFetch(fetchStub: ReturnType<typeof vi.fn>) {
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

/** All four status buttons, in render order. */
function rsvpButtons(container: HTMLElement): HTMLButtonElement[] {
	return ['going', 'not_going', 'maybe', 'late'].map(
		(s) => container.querySelector(`[data-testid="rsvp-btn-${s}"]`) as HTMLButtonElement
	);
}

// ── data layer: capacity + editorIds on EventDetail ───────────────────────────

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
		// null ≠ 0: an explicit capacity of 0 would be a (weird but representable)
		// real value, and 0 must not be conflated with "unset" by the hide-gate.
		expect(detail.capacity).toBeNull();
		expect(detail.ownerIds).toEqual([]);
		expect(detail.editorIds).toEqual([]);
	});

	// #102 review fix (F1) — the rights read was `_editor`-only, a SECOND, narrower
	// rights rule than the one the rest of the app runs (owner OR editor). Both
	// tiers are read now, kept as separate lists so the caller can hand them to
	// `manageRightsFrom` verbatim.
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
		// …and `_owner` was actually ASKED FOR over the wire — an unrequested prop
		// comes back absent, which would read as "no owners" for every caller.
		const eventUrl = fetchImpl.mock.calls
			.map((c) => String(c[0]))
			.find((u) => u.includes('/entity/ev1'));
		expect(eventUrl).toContain('_owner');
	});
});

// ── page: the RSVP control (same component, same entity as the agenda) ────────

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
		// The msg line is RsvpControl's own internal (reserved hint/error space) —
		// its presence pins REUSE of the component, not a lookalike button row.
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
		// Membership was RESOLVED for this viewer, not assumed.
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.includes('_type.string=member') && u.includes('p-viewer'))).toBe(
			true
		);
	});

	it("seeds the control from the viewer's EXISTING rsvp — the same entity the agenda row owns", async () => {
		const { container, fetchStub } = renderRsvpPage();
		// rsvp-77 (going) came back from listMyRsvps → the going button is pressed.
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		// …and it was read through the agenda's own primitive: the singer's rsvps
		// under her OWN person (`_parent.reference`), not some detail-page-only read.
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(
			urls.some((u) => u.includes('_type.string=rsvp') && u.includes('_parent.reference=p-viewer'))
		).toBe(true);
	});

	it('a status change WRITES to that same rsvp entity (update rsvp-77) — never a second create', async () => {
		const { container, fetchStub } = renderRsvpPage();
		// Wait for BOTH: the seeded pressed state (so `existing` is the real rsvp,
		// not null) and an enabled button (member resolved, nothing in flight).
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
			// EVERY write targets the EXISTING entity. A create would POST the bare
			// `entity` collection and fork the viewer's answer into two rsvps — the
			// agenda row and this page would then disagree forever.
			for (const c of posts) expect(String(c[0])).toContain('/entity/rsvp-77');
		});
	});
});

// ── page: rights-gated tally + capacity ───────────────────────────────────────

describe('/event/[id] — tally + capacity, gated on `_editor` (event) containing the viewer', () => {
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
		// 0 is a COUNT, not an absence — the late bucket renders its zero.
		expect(count('late')!.textContent).toContain('0');
	});

	it('a plain member sees the control but NO tally and NO capacity (default fixture: _editor invisible)', async () => {
		const { container } = renderRsvpPage();
		// Settle past the async seeding (pressed state proves the rsvp reads have
		// resolved) before asserting the ABSENCE of the gated surfaces.
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		expect(container.querySelector('[data-testid="event-detail-tally"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).toBeNull();
	});

	it('an _editor list WITHOUT the viewer does not reveal the tally — membership of the list, not presence of the prop', async () => {
		const { container } = renderRsvpPage({
			event: eventEntity({ _editor: [{ reference: 'p-other' }] })
		});
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		expect(container.querySelector('[data-testid="event-detail-tally"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).toBeNull();
	});

	it('capacity renders as going-count / capacity alongside the tally when event.capacity is set', async () => {
		const { container } = renderRsvpPage({ event: editorEvent() }); // default capacity: 20
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-capacity"]')).not.toBeNull();
		});
		const cap = container.querySelector('[data-testid="event-detail-capacity"]')!.textContent ?? '';
		// DATA, not sentence: 12 going of 20 seats. The wording/order around the
		// numbers belongs to the translators.
		expect(cap).toContain('12');
		expect(cap).toContain('20');
		// …and the tally is right there with it, same gate.
		expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
	});

	it('capacity is hidden when the event has none — the tally still renders', async () => {
		const { container } = renderRsvpPage({ event: editorEvent({ capacity: undefined }) });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).toBeNull();
	});

	// #102 review fix (F1) — the gate read `_editor` only, a narrower rule than the
	// one the agenda runs for the SAME entity (routes/+page.svelte:284 →
	// manageRightsFrom(item.owners, item.editors, personId)). An owner-only
	// conductor got the programme-management controls on her agenda row and no
	// tally at all on this page: two surfaces disagreeing about one event.
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

	it('an `_owner` list WITHOUT the viewer still reveals nothing (membership of the list, not presence of the prop)', async () => {
		const { container } = renderRsvpPage({
			event: eventEntity({ _owner: [{ reference: 'p-other' }] })
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		expect(container.querySelector('[data-testid="event-detail-tally"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-detail-capacity"]')).toBeNull();
	});

	it('integration: the RSVP section holds the control AND the gated tally + capacity together (editor view)', async () => {
		const { container } = renderRsvpPage({ event: editorEvent() });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		});
		const section = container.querySelector('[data-testid="event-detail-rsvp"]')!;
		// One SECTION, all three surfaces inside it — not a control here and a
		// tally floating elsewhere on the page.
		expect(section.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="event-detail-tally"]')).not.toBeNull();
		expect(section.querySelector('[data-testid="event-detail-capacity"]')).not.toBeNull();
	});
});

// ── #102 review fixes: the RSVP control's disable reasons + tally freshness ───

// F2 — the control was interactive while membership was still unresolved. The
// member lookup only STARTS after the event read resolves (and may fail, which
// parks the state back in 'loading' for good), so there is a real window where a
// tap reaches applyRsvpChange with a null memberId — which THROWS on the create
// path, reverts, and shows `rsvp_save_failed` to a genuine active member. The
// agenda never had this: its rows map `membership === 'loading'` into `pending`.
describe('/event/[id] — RSVP control while membership is still unresolved (#102 review F2)', () => {
	/** The member query never settles; every other route serves normally. */
	function stallingMemberWire(opts: { myRsvp?: boolean } = {}) {
		const base = rsvpWireStub({}, opts);
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('_type.string=member')) return new Promise<Response>(() => {});
			return base(input, init);
		});
	}

	it('keeps all four buttons DISABLED — and shows no non-member hint (unresolved ≠ non-member)', async () => {
		const { container } = renderWithFetch(stallingMemberWire());
		// The event read and the viewer's own rsvp read HAVE resolved (pressed
		// state proves it) — only membership is outstanding.
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
		});
		for (const btn of rsvpButtons(container)) expect(btn.disabled).toBe(true);
		// Silent disable: a lookup in flight is not a verdict about this person.
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
		expect(container.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
	});

	// The exact reported failure: a viewer with NO existing rsvp taps before the
	// member query returns. `existing` is null and `memberId` is null, so the
	// create path throws ('applyRsvpChange: cannot create without a memberId'),
	// the queue reverts, and an active member is shown `rsvp_save_failed`.
	it('a first tap by a viewer with no existing rsvp records NOTHING — and shows no save-failed error', async () => {
		const { container, fetchStub } = renderWithFetch(stallingMemberWire({ myRsvp: false }));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-control"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-going"]')!);
		// Let any write the tap COULD have started settle (real timers — only Date
		// is faked), so this is not merely a same-tick snapshot.
		await new Promise((r) => setTimeout(r, 30));

		const posts = fetchStub.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(posts).toEqual([]);
		expect(container.querySelector('[data-testid="rsvp-save-failed"]')).toBeNull();
		// …and the control did not fake a pressed state either.
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('false');
	});
});

// F3 — the agenda renders a PAST event's control read-only ("there is nothing
// left to answer", AgendaList.svelte: `pending={true}` on Recent rows), and those
// same rows link straight to this page, which had no past check at all: a singer
// could re-answer a finished rehearsal — possibly after attendance was recorded.
describe('/event/[id] — a past event is read-only (#102 review F3)', () => {
	/** Yesterday, relative to the pinned NOW — past by the SAME boundary the
	 *  agenda partitions on (`recentEvents`: start instant < now). */
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
		// Same silent-disable posture the agenda uses — no misleading non-member hint.
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

// F4 — the viewer's own rsvp is one of the rows the tally counts, and the
// capacity line reads `tally.going`: changing her own answer left both stale
// until a reload.
describe('/event/[id] — the tally refreshes after the editor changes her OWN rsvp (#102 review F4)', () => {
	/** The all-rsvps read reflects rsvp-77's CURRENT status: 'going' until the
	 *  update POST lands, 'maybe' after — i.e. what Entu would serve. */
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
			if (url.includes('_type.string=rsvp') && url.includes('event.reference=ev1')) {
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
		// The capacity line is derived from the SAME counts — it must not lag.
		expect(c.querySelector('[data-testid="event-detail-capacity"]')!.textContent).toContain('11');
	});

	it('a plain member issues NO cross-person tally read at all, before or after her own change', async () => {
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
		expect(urls.some((u) => u.includes('event.reference=ev1'))).toBe(false);
	});
});

// ── #102 review round 2 ──────────────────────────────────────────────────────

// F1 — the queue's callbacks are PER-EVENT so a late one cannot land on the
// wrong state (rsvpChangeQueue.ts: the #15 root cause was a whole-map write
// clobbering another event). This page collapses them into scalars, and ignored
// both the callback's `eventId` and the load `generation`: a write started
// before a collective switch (same id, different db) reconciled onto the page
// that had since reloaded — seeding a pressed status the new collective has no
// rsvp for, whose id then got REWRITTEN by the next tap.
describe('/event/[id] — a write that settles after a collective switch never lands (#102 review round 2, F1)', () => {
	/** Both dbs serve ev1; only `polyphony` has the viewer's rsvp-77. The update
	 *  POST is held open until `release()`, so it settles AFTER the switch. */
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
			personIdByDb: { polyphony: 'p-viewer', vox: 'p-viewer' },
			expMs: Date.now() + 100_000
		});
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' },
				{ db: 'vox', name: 'Vox', personId: 'p-viewer' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');
		return { ...render(Page), fetchStub };
	}

	it('the stale reconcile does not seed the control — and the next tap never rewrites the OTHER db rsvp entity', async () => {
		const { fetchStub, release } = switchedCollectiveWire();
		const { container } = renderWithTwoCollectives(fetchStub);

		// polyphony: the viewer's rsvp-77 seeds 'going', and the control is live.
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
			).toBe('true');
			const maybe = container.querySelector('[data-testid="rsvp-btn-maybe"]') as HTMLButtonElement;
			expect(maybe.disabled).toBe(false);
		});
		// Tap 'maybe' — the update against rsvp-77 is now in flight (held open).
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-maybe"]')!);

		// …and while it is in flight, the collective switches. ev1 exists in `vox`
		// too, with NO rsvp for this viewer: nothing may be pressed.
		selectedCollectiveDbStore.set('vox');
		await waitFor(() => {
			const going = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement;
			expect(going.disabled).toBe(false);
			for (const btn of rsvpButtons(container))
				expect(btn.getAttribute('aria-pressed')).toBe('false');
		});

		// The polyphony write settles now, onto a page showing the vox load.
		release();
		await new Promise((r) => setTimeout(r, 30));
		for (const btn of rsvpButtons(container))
			expect(btn.getAttribute('aria-pressed'), 'a superseded write seeded the control').toBe(
				'false'
			);

		// The reported consequence: with a stale rsvpId seeded, the NEXT tap issues
		// an update against that id in the WRONG db — rewriting the previous
		// collective's answer and recording nothing here.
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-going"]')!);
		await new Promise((r) => setTimeout(r, 30));
		const urls = fetchStub.mock.calls.map((c) => String(c[0]));
		expect(
			urls.filter((u) => u.includes('rsvp-77')).every((u) => u.includes('/polyphony/')),
			'rsvp-77 was touched in the vox db'
		).toBe(true);
	});
});

// F2 — `isEditor && tally` renders a failed tally read exactly like a plain
// member's view: a conductor read "nobody answered / I have no rights" instead
// of "the counts failed to load", with nothing logged and no way back short of
// a reload. Absence is the clean negative; a fetch failure is not (the rule
// repertoireActions.resolveManageRights states out loud).
describe('/event/[id] — a FAILED tally read is surfaced, not silently collapsed (#102 review round 2, F2)', () => {
	/** The cross-person tally read 500s `failTimes` times, then recovers. */
	function failingTallyWire(failTimes = Number.POSITIVE_INFINITY) {
		const base = rsvpWireStub({ event: editorEvent() });
		let left = failTimes;
		return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('_type.string=rsvp') && url.includes('event.reference=ev1') && left > 0) {
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
		// The counts are DROPPED, not left standing as if current.
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

	it('a plain member is never shown the error line — she issues no tally read at all', async () => {
		const { container } = renderRsvpPage(); // default fixture: no rights visible
		await waitFor(() => {
			const maybe = container.querySelector('[data-testid="rsvp-btn-maybe"]') as HTMLButtonElement;
			expect(maybe.disabled).toBe(false);
		});
		expect(container.querySelector('[data-testid="event-detail-tally-error"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — #101 TE.1 RED)
// (*MVOX:Josquin* — #101 TE.1 review fixes F1/F3)
// (*MVOX:Josquin* — #101 TE.1 review round 2, F1–F5)
// (*MVOX:Tallis* — #102 TE.2 RED)
// (*MVOX:Josquin* — #102 TE.2 review round 2, F1/F2)
