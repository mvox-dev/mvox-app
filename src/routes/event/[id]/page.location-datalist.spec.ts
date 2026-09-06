// @vitest-environment happy-dom
//
// #248 RED — event-edit-input-location on the DETAIL route suggests previously
// used venues via a native <datalist>, fed by a LAZY fetch (PO ruling, option
// c): this route holds no location corpus in memory (loadEventDetail reads ONE
// event + its parents — confirmed by research-248 and Gama's on-issue
// correction), so the suggestion corpus is fetched — but ONLY on the FIRST
// focus of the location edit input, NEVER on page load.
//
// Integration: the real event/[id]/+page.svelte against a stubbed global fetch
// — the same liberal wire harness page.event-editing.spec.ts uses, extended
// with a corpus route.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   THE LAZY PIN (all three legs asserted)
//     - NO location-corpus request during page load/render — none at all
//       before the field is focused.
//     - the FIRST focus of event-edit-input-location fires EXACTLY ONE corpus
//       request (single-flight: the mount-autofocus plus an explicit focus
//       still total one request).
//     - a SECOND focus (cancel the edit, reopen it) does NOT re-fetch.
//
//   THE CORPUS REQUEST
//     - collective-scoped event location values through the existing entu list
//       shape: a GET against `entity?` with `_type.string=event` (the shape
//       every existing event list helper emits — Path C: entuFetch/wrapper
//       helpers only, no bespoke endpoint). Its projection includes
//       `location` (smallest projection available — the corpus needs nothing
//       else from each row).
//     - values de-duplicated client-side, blanks dropped; ORDERING IS NOT
//       PINNED (engineering's call, stated in the report) — assertions
//       compare SORTED copies.
//
//   FAILURE = SILENCE
//     - a failed corpus fetch yields NO suggestions and NO error surface: the
//       input stays a plain free-text control and the edit/save path works
//       exactly as before. Suggestions never block editing.
//
//   FREE TEXT OUTRANKS EVERYTHING
//     - a brand-new venue types straight through and saves byte-identical:
//       the write POST carries [{ type: 'location', string: <exactly as
//       typed> }] — the pre-#248 wire shape, unchanged.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — same hygiene as
// page.event-editing.spec.ts. Only Date is faked; timers stay real.
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

/** Suggestion-mismatching free-text venue — unicode-bearing on purpose: the
 *  wire pin is BYTE-IDENTICAL. Never appears in any corpus fixture. */
const NEW_VENUE = 'Ürgoru laululava — sissepääs B!';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures (same event family as page.event-editing.spec.ts) ──────────

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		description: [{ _id: 'val-desc-1', string: 'Come 15 minutes early.' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		_editor: [{ reference: 'p-viewer' }],
		...over
	};
}

function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: [{ reference: 'p-mihkel' }]
	};
}

function seriesEntity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }],
		default_location: [{ string: 'Church Hall' }],
		default_description: [{ string: 'Series default note.' }]
	};
}

/** The collective's other events — the corpus the lazy fetch returns. Own
 *  locations only (no series parents: no per-row inheritance side reads),
 *  with a duplicate, a blank and an absent location so dedup + blank-drop are
 *  observable. 'Rehearsal Hall' (the current event's own value) is IN the
 *  corpus, as it would be on the real wire. */
function corpusEntities() {
	const mk = (id: string, location: string | null, dt: string) => ({
		_id: id,
		name: [{ string: `Event ${id}` }],
		start_datetime: [{ datetime: dt }],
		...(location === null ? {} : { location: [{ _id: `val-loc-${id}`, string: location }] }),
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' }
		]
	});
	return [
		mk('evA', 'Hopneri Maja', '2026-09-08T16:00:00.000Z'),
		mk('evB', 'Estonia Hall', '2026-09-15T16:00:00.000Z'),
		mk('evC', 'Hopneri Maja', '2026-09-22T16:00:00.000Z'),
		mk('evD', 'Rehearsal Hall', '2026-09-29T16:00:00.000Z'),
		mk('evE', '', '2026-10-06T16:00:00.000Z'),
		mk('evF', null, '2026-10-13T16:00:00.000Z')
	];
}

/** Deduped, blank-dropped, SORTED for comparison only — datalist ordering is
 *  engineering's call, not pinned. */
const EXPECTED_SET = ['Estonia Hall', 'Hopneri Maja', 'Rehearsal Hall'];

/** A location-corpus request: a LIST query (`entity?`) for events. The
 *  boundary in the regex keeps `_type.string=event_series` (and the
 *  `name.string=event_series` type-resolve read) from matching. */
function isCorpusUrl(url: string): boolean {
	return url.includes('entity?') && /[?&]_type\.string=event(?:&|$)/.test(url);
}

type WireOpts = {
	/** Corpus requests answer 500 — the silent-degrade probe. */
	failCorpus?: boolean;
};

/** The event-editing liberal wire, extended with the corpus route (checked
 *  FIRST — everything else is byte-for-byte the sibling suite's shape). Edit
 *  POSTs are applied to the in-memory event so optimistic and re-read GREENs
 *  pass identically. */
function wireStub(opts: WireOpts = {}) {
	const event: Record<string, unknown> = eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	const corpusUrls: string[] = [];
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && isCorpusUrl(url)) {
			corpusUrls.push(url);
			return opts.failCorpus ? json({ message: 'boom' }, 500) : json({ entities: corpusEntities() });
		}
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') {
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			for (const prop of props) {
				const { type, ...valueParts } = prop;
				event[String(type)] = [{ _id: `val-${String(type)}-new`, ...valueParts }];
			}
			return json({});
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=profile')) return json({ entities: [] });
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		return json({ entities: [] });
	});
	return { stub, corpusUrls };
}

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

function renderDetail(opts: WireOpts = {}) {
	const { stub, corpusUrls } = wireStub(opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, corpusUrls };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

/** Lets anything already queued — a request that WOULD have fired — land
 *  before asserting that it did not. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Wait until the detail header is up (the location line rendered). */
async function detailReady(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="event-detail-location"]')).not.toBeNull();
	});
}

/** Tap the location pencil and hand back the edit input (mount-autofocused). */
async function beginLocationEdit(container: HTMLElement): Promise<HTMLInputElement> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="event-edit-btn-location"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-location"]')!);
	return await waitFor(() => {
		const el = container.querySelector('[data-testid="event-edit-input-location"]');
		expect(el, 'event-edit-input-location missing after tapping edit').not.toBeNull();
		return el as HTMLInputElement;
	});
}

/** Resolve the input's `list=` target inside the rendered document. */
function resolveDatalist(input: HTMLInputElement): HTMLElement {
	const listId = input.getAttribute('list');
	expect(listId, 'event-edit-input-location must carry list=').toBeTruthy();
	const dl = document.querySelector(`datalist[id="${listId}"]`);
	expect(dl, `<datalist id="${listId}"> must exist in the page`).not.toBeNull();
	return dl as HTMLElement;
}

function optionSet(dl: HTMLElement): string[] {
	return [...dl.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value).sort();
}

/** Every write POST the page issued against the event entity. */
function editPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls.filter(
		(c) =>
			((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST' &&
			String(c[0]).includes('/entity/ev1')
	);
}

function postedProps(call: unknown[]): Array<Record<string, unknown>> {
	return JSON.parse(String((call[1] as RequestInit).body)) as Array<Record<string, unknown>>;
}

// ═════════════════════════════════════════════════════════════════════════════
// the lazy pin — never on load, once on first focus, never again
// ═════════════════════════════════════════════════════════════════════════════

describe('#248 — detail-route location suggestions load LAZILY (PO ruling c)', () => {
	it('page load/render fires NO corpus request; the FIRST focus fires exactly ONE, whose projection includes location; the datalist then offers the deduped set', async () => {
		const { container, corpusUrls } = renderDetail();
		await detailReady(container);
		await flush();
		// The lazy pin's first leg: nothing during load/render.
		expect(corpusUrls).toEqual([]);

		const input = await beginLocationEdit(container);
		// Mount-autofocus + an explicit focus: still ONE request (single-flight).
		await fireEvent.focus(input);
		await waitFor(() => {
			expect(corpusUrls.length).toBeGreaterThan(0);
		});
		await flush();
		expect(corpusUrls).toHaveLength(1);
		// Smallest projection available — the corpus read asks for location.
		expect(corpusUrls[0]).toContain('props=');
		expect(corpusUrls[0]).toContain('location');

		// list= wired to a real datalist carrying the deduped, blank-dropped
		// set — SORTED comparison only; ordering is engineering's call.
		await waitFor(() => {
			expect(optionSet(resolveDatalist(input))).toEqual(EXPECTED_SET);
		});
	});

	it('a SECOND focus does not re-fetch: cancel the edit, reopen, focus again — still exactly one corpus request, suggestions still offered', async () => {
		const { container, corpusUrls } = renderDetail();
		await detailReady(container);
		const first = await beginLocationEdit(container);
		await fireEvent.focus(first);
		await waitFor(() => {
			expect(corpusUrls).toHaveLength(1);
		});

		// Escape cancels the edit (writes nothing) and unmounts the input.
		await fireEvent.keyDown(first, { key: 'Escape' });
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});

		const second = await beginLocationEdit(container);
		await fireEvent.focus(second);
		await flush();
		expect(corpusUrls).toHaveLength(1);
		await waitFor(() => {
			expect(optionSet(resolveDatalist(second))).toEqual(EXPECTED_SET);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// failure = silence — suggestions never block editing
// ═════════════════════════════════════════════════════════════════════════════

describe('#248 — corpus fetch failure degrades silently', () => {
	it('a 500 corpus answer surfaces NO error and NO suggestions; the input stays plain free text and the save path is untouched (byte-identical write)', async () => {
		const { container, fetchStub, corpusUrls } = renderDetail({ failCorpus: true });
		await detailReady(container);
		const input = await beginLocationEdit(container);
		await fireEvent.focus(input);
		await waitFor(() => {
			expect(corpusUrls.length).toBeGreaterThan(0);
		});
		await flush();

		// Silence: no error surface of any kind for the failed corpus read.
		expect(container.querySelector('[data-testid="event-edit-error-location"]')).toBeNull();
		// No suggestions: whatever datalist the input points at (if any) offers
		// no options — and a missing list= is equally acceptable here.
		const listId = input.getAttribute('list');
		if (listId) {
			const dl = document.querySelector(`datalist[id="${listId}"]`);
			if (dl) expect(optionSet(dl as HTMLElement)).toEqual([]);
		}

		// Editing works exactly as before: the new venue saves byte-identical.
		await fireEvent.input(input, { target: { value: NEW_VENUE } });
		await fireEvent.blur(input);
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([
				{ _id: 'val-loc-1', type: 'location', string: NEW_VENUE }
			]);
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-location"]')?.textContent
			).toContain(NEW_VENUE);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// FREE TEXT outranks everything — with suggestions PRESENT
// ═════════════════════════════════════════════════════════════════════════════

describe('#248 — a brand-new venue saves exactly as typed even with suggestions loaded', () => {
	it('suggestion-mismatching input → ONE write POST, [{type: location, string: <byte-identical>}] — the pre-#248 wire shape, no extra writes, no warning', async () => {
		const { container, fetchStub } = renderDetail();
		await detailReady(container);
		const input = await beginLocationEdit(container);
		await fireEvent.focus(input);
		await waitFor(() => {
			expect(optionSet(resolveDatalist(input))).toEqual(EXPECTED_SET);
		});

		// The input imposes no constraint: free text, no pattern, not required.
		expect(input.required).toBe(false);
		expect(input.getAttribute('pattern')).toBeNull();
		expect(input.getAttribute('maxlength')).toBeNull();

		await fireEvent.input(input, { target: { value: NEW_VENUE } });
		// Typing a never-seen venue raises nothing.
		expect(container.querySelector('[data-testid="event-edit-error-location"]')).toBeNull();
		await fireEvent.blur(input);

		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts).toHaveLength(1);
			expect(postedProps(posts[0])).toEqual([
				{ _id: 'val-loc-1', type: 'location', string: NEW_VENUE }
			]);
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-location"]')?.textContent
			).toContain(NEW_VENUE);
		});
		expect(container.querySelector('[data-testid="event-edit-error-location"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
