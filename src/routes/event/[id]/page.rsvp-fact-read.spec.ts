// @vitest-environment happy-dom
//
// #329 RED (event-page half, site (a)) — RSVP reads the FACT.
//
// The ruling: a negative derived from a truncated read is not a fact — get
// the fact or say you don't have it, never print the negative. Truncation
// poisons negatives, never positives.
//
// Pre-#329, this page seeded the viewer's own answer for THIS event from the
// person-LIFETIME `listMyRsvps` read (limit=500 — a reachable cap for a
// weekly-rehearsal member of ten years): an answer past the cap rendered
// "not answered" for an event she DID answer — a false claim about her own
// state. Ruled fix: read the fact directly — the scoped one-row query
//
//   entity?_type.string=rsvp&_parent.reference=<personId>
//     &event.reference=<eventId>&props=status&limit=1
//
// (wire-shape precedent: findMyMemberId, rsvpData.ts:45-51; unit contract:
// rsvpData.fact-read.spec.ts). No unknown state on this surface — the scoped
// read cannot truncate her answer away, so its empty result IS the fact.
//
// INTEGRATION posture (page.spec.ts family): the REAL page + REAL data layer,
// only global fetch stubbed at the wire. The lifetime road is SERVED —
// truncated, WITHOUT this event's rsvp — so an implementation still deriving
// the answer from it fails visibly, not by 404.
//
// The lifetime read's other consumer (the agenda, routes/+page.svelte — row
// seeding + its own partial notice) is out of this page's scope and pinned
// unchanged in page.edition-unknown.spec.ts.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — page.spec.ts hygiene:
// only Date is faked, timers stay real so waitFor keeps polling.
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

// Full-fallback paraglide mock — every key renders `[key {params}]`.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

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
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── fixtures ──────────────────────────────────────────────────────────────────

function eventEntity() {
	return {
		_id: 'ev1',
		name: [{ string: 'Tuesday Rehearsal' }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ number: 90 }],
		location: [{ string: 'Rehearsal Hall' }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' }
		]
	};
}

function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }]
	};
}

/** The viewer's OWN rsvp for ev1 — the fact the scoped read must surface. */
const MY_RSVP_ROW = { _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] };

/** A person-LIFETIME read that came back TRUNCATED and does NOT contain the
 *  ev1 answer: two old-event rows on the wire, `count` far above them. Any
 *  implementation still deriving this event's answer from THIS body reads
 *  "not answered" — the false negative under test. */
function truncatedLifetimeBody() {
	return {
		count: 600,
		entities: [
			{ _id: 'rsvp-old-1', event: [{ reference: 'ev-old-1' }], status: [{ string: 'going' }] },
			{ _id: 'rsvp-old-2', event: [{ reference: 'ev-old-2' }], status: [{ string: 'maybe' }] }
		]
	};
}

type WireOpts = {
	/** What the SCOPED one-row read answers. Default: the ev1 answer exists. */
	scopedEntities?: unknown[];
	/** Explicit server `count` on the scoped body (0 = confirmed empty). */
	scopedCount?: number;
};

function wireStub(opts: WireOpts = {}) {
	const scopedEntities = opts.scopedEntities ?? [MY_RSVP_ROW];
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
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
		if (url.includes('/entity/ev1')) return json({ entity: eventEntity() });
		if (url.includes('/entity/season1')) return json({ entity: seasonEntity() });
		if (url.includes('_type.string=member') && url.includes('person.reference=p-viewer'))
			return json({ entities: [{ _id: 'member-1' }] });
		if (url.includes('_type.string=rsvp')) {
			if (url.includes('_parent.reference=p-viewer') && url.includes('event.reference=ev1')) {
				// The SCOPED fact read.
				return json(
					opts.scopedCount === undefined
						? { entities: scopedEntities }
						: { count: opts.scopedCount, entities: scopedEntities }
				);
			}
			if (url.includes('_parent.reference=p-viewer')) {
				// The person-LIFETIME road — truncated, ev1's answer past the cap.
				return json(truncatedLifetimeBody());
			}
			return json({ entities: [] });
		}
		return json({ entities: [] });
	});
}

function setAuthed() {
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

function renderPage(opts: WireOpts = {}) {
	const fetchStub = wireStub(opts);
	vi.stubGlobal('fetch', fetchStub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	const rendered = render(Page);
	return { ...rendered, fetchStub };
}

/** The exact query string the fact read must carry (unit-pinned too). */
const SCOPED_QUERY =
	'_type.string=rsvp&_parent.reference=p-viewer&event.reference=ev1&props=status&limit=1';

function rsvpQueries(fetchStub: ReturnType<typeof wireStub>): string[] {
	return fetchStub.mock.calls
		.map((c) => String(c[0]))
		.filter((u) => u.includes('_type.string=rsvp') && u.includes('_parent.reference='));
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/event/[id] — the own-answer state comes from the scoped FACT read (#329)', () => {
	it('(a) her answer EXISTS: shown even though the lifetime read truncated it away — and the wire saw the exact scoped query', async () => {
		const { container, fetchStub } = renderPage();
		// The rendered state: going pressed — the fact, not the derived negative.
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		// The wire call, full query-string toEqual — never fragment-contains.
		expect(
			fetchStub.mock.calls.map((c) => String(c[0])).some((u) => u.split('?')[1] === SCOPED_QUERY)
		).toBe(true);
	});

	it('(b) genuinely NO answer: the scoped read confirms empty and "not answered" stands', async () => {
		const { container, fetchStub } = renderPage({ scopedEntities: [], scopedCount: 0 });
		// The fact read actually happened…
		await waitFor(() => {
			expect(
				fetchStub.mock.calls
					.map((c) => String(c[0]))
					.some((u) => u.split('?')[1] === SCOPED_QUERY)
			).toBe(true);
		});
		// …and the control renders unanswered — all four unpressed, no fabricated
		// status. (This absence is a FACT: the scoped read has no cap to fall past.)
		await waitFor(() => {
			for (const status of ['going', 'not_going', 'maybe', 'late']) {
				expect(
					container
						.querySelector(`[data-testid="rsvp-btn-${status}"]`)
						?.getAttribute('aria-pressed'),
					`rsvp-btn-${status}`
				).toBe('false');
			}
		});
	});

	it('the person-LIFETIME read no longer decides this page: every own-rsvp query is event-scoped', async () => {
		const { container, fetchStub } = renderPage();
		await waitFor(() => {
			expect(
				container
					.querySelector('[data-testid="rsvp-btn-going"]')
					?.getAttribute('aria-pressed')
			).toBe('true');
		});
		const queries = rsvpQueries(fetchStub);
		expect(queries.length).toBeGreaterThan(0);
		// No un-scoped (lifetime) own-rsvp read left on this page — its remaining
		// consumer is the agenda (routes/+page.svelte), pinned separately.
		for (const url of queries) {
			expect(url, `own-rsvp query without an event scope: ${url}`).toContain(
				'event.reference=ev1'
			);
		}
	});

	it('a status change writes to the entity the FACT read returned — update rsvp-77, never a create', async () => {
		const { container, fetchStub } = renderPage();
		await waitFor(() => {
			const btn = container.querySelector(
				'[data-testid="rsvp-btn-going"]'
			) as HTMLButtonElement | null;
			expect(btn?.getAttribute('aria-pressed')).toBe('true');
			expect(btn?.disabled).toBe(false);
		});
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);
		await waitFor(() => {
			const posts = fetchStub.mock.calls.filter(
				([url, init]) =>
					String(url).includes('/entity/rsvp-77') &&
					(init as RequestInit | undefined)?.method === 'POST'
			);
			expect(
				posts.some(([, init]) =>
					String((init as RequestInit).body).includes('"string":"not_going"')
				)
			).toBe(true);
		});
	});
});

// (*MVOX:Tallis* — #329 RED)
