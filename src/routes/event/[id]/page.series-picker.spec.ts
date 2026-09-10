// @vitest-environment happy-dom
//
// #304 RED — the event page's SERIES PICKER: choose the event's series, or
// remove it from one, with the consequence visible BEFORE it is committed.
//
// WHY THIS IS NOT A METADATA EDIT: an event inherits up to FOUR fields from
// its parent series whenever it carries no value of its own — name,
// duration_minutes → durationMinutes, default_location → location,
// default_description → description (eventDetail.ts's `??` merge). Picking a
// different series can rewrite four things on screen at once; unassigning a
// series child leaves it NAMELESS by design (#132 — series children carry no
// own name). The picker must say so before the write, and only when true.
//
// THE INHERITANCE TEST IS RAW PRESENCE, NEVER TRUTHINESS: the merge fires only
// when `event.<prop>?.[0]` is absent (array missing/empty). A stored `''` or
// `0` BLOCKS inheritance while displaying blank — so the on-screen "inherited
// fields" list must replicate the raw-array test. Pinned below: an event with
// a STORED empty-string name inherits NOTHING and gets no ceremony.
//
// RIGHTS — the SPIKE's live gate finding (polyphony ledger
// probe-304-parent-rights-gate-live-2026-09-10T05-11-52-413Z.json), shaped by
// Gama's ruling comment 5613471404 on #304 (the OWNER-GATED branch):
//   - UNASSIGN is a DELETE of the series `_parent` value and that DELETE is
//     OWNER-gated (editor → 403 "User not in _owner property"; the same
//     editor deleted a plain property value fine — the gate is `_parent`-
//     specific). REASSIGN (atomic-overwrite POST) is editor-reachable.
//   - So: the "Ei kuulu sarja" option renders ONLY on resolved owner tier —
//     ABSENT for a confirmed non-owner, never disabled — AND a visible
//     rights-note renders for a confirmed non-owner on a series event
//     (#301's precedent is absent PLUS a note: a missing option inside an
//     otherwise-normal dropdown is invisible without one).
//   - The note renders only when ACTIONABLE: confirmed non-owner tier AND the
//     event currently belongs to a series. Loading renders neither the
//     option nor the note — an unresolved tier is not a positive claim.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/lib/events/eventDetail.ts — the EventDetail contract GROWS:
//     seriesId: string | null       — the event's event_series parent
//                                     (computed today at :200 and discarded);
//                                     null when standalone (seasonId's rule:
//                                     '' would read as a real id).
//     inheritedFields: Array<'name'|'durationMinutes'|'location'|'description'>
//                                   — the fields THIS event ACTUALLY inherits:
//                                     event raw array absent/empty AND the
//                                     series supplies a value. Display order
//                                     pinned: name, durationMinutes, location,
//                                     description.
//
//   src/routes/event/[id]/+page.svelte — the picker (rights-holders only,
//   manageRightsFrom — the page's ONE rights rule; plain members see nothing):
//     event-series-select        native <select>, label (label[for]) carrying
//                                event_detail_series_label; options = the
//                                none-option (value '', text
//                                event_detail_series_none — the
//                                event-create-series convention) + every
//                                series of THIS event's SEASON (season-scoped
//                                — a cross-season series would move the event
//                                between seasons); current series preselected.
//     event-series-inherited     names the inherited fields, one marker per
//                                field: event-series-inherited-name /
//                                -duration / -location / -description —
//                                ONLY the ones this event actually inherits.
//     event-series-confirm       the consequence block: appears BEFORE any
//                                write when (and only when) ≥1 field is
//                                inherited and the selection changed;
//                                reassign → what the fields will BECOME (the
//                                new series' values); unassign → which
//                                fields clear, name-goes-empty named
//                                (event_detail_series_unassign_name_empty).
//                                event-series-confirm-apply commits,
//                                event-series-confirm-cancel restores the
//                                previous selection and writes NOTHING.
//     event-series-rights-note   the non-owner explanation (see RIGHTS above).
//     event-series-status        #289: SUCCESS announced server-confirmed —
//                                never optimistic; the page then shows the
//                                NEW values with no stale inherited text.
//     event-series-error         #289: a FAILED write says so and leaves the
//                                PREVIOUS series selected.
//   The write path touches ONLY the `_parent` series value (see
//   eventSeriesActions.spec.ts for the wire contract) — never the four field
//   props, never the season's value id.
//
// Assertions match on DATA (values, wire bodies, testids) and `[key]` stubs,
// never translated sentences — page.spec.ts's full-fallback paraglide posture.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — same hygiene as
// page.spec.ts: only Date is faked, timers stay real so waitFor polls.
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
import { loadEventDetail } from '$lib/events/eventDetail';
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
// Same event as page.spec.ts, with per-value `_id`s on the `_parent` values —
// the write path targets VALUE ids, so the fixtures must carry them (the
// SPIKE's fixture-owner-read shape).

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		description: [{ _id: 'val-desc-1', string: 'Come 15 minutes early for warm-ups.' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [
			{ _id: 'pv-org', reference: 'org1', entity_type: 'organization' },
			{ _id: 'pv-season', reference: 'season1', entity_type: 'season' },
			{ _id: 'pv-series', reference: 'series1', entity_type: 'event_series' }
		],
		...over
	};
}

/** Owner view — ownership subsumes editing (manageRightsFrom). */
function ownerEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _owner: [{ reference: 'p-viewer' }], ...over });
}
/** Editor-not-owner view — the gated tier of the SPIKE's asymmetry. */
function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}
/** The four inheritable props raw-ABSENT — the event inherits all four. */
const INHERITING = {
	name: undefined,
	duration_minutes: undefined,
	location: undefined,
	description: undefined
};
/** Standalone: season parent only — no series value to unassign. */
const STANDALONE_PARENTS = [
	{ _id: 'pv-org', reference: 'org1', entity_type: 'organization' },
	{ _id: 'pv-season', reference: 'season1', entity_type: 'season' }
];

function seasonEntity() {
	return {
		_id: 'season1',
		name: [{ string: '2026/27' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: []
	};
}
function series1Entity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		duration_minutes: [{ number: 120 }],
		default_location: [{ string: 'Church Hall' }],
		default_description: [{ string: 'Series default note.' }]
	};
}
function series2Entity() {
	return {
		_id: 'series2',
		name: [{ string: 'Wednesday Series' }],
		duration_minutes: [{ number: 75 }],
		default_location: [{ string: 'Chapel' }],
		default_description: [{ string: 'Bring scores.' }]
	};
}
/** The OTHER collective's fixtures — the mid-write-switch race. */
function credeEventEntity() {
	return {
		_id: 'ev1',
		name: [{ _id: 'cval-name', string: 'Crede Event' }],
		event_type: [{ _id: 'cval-type', string: 'rehearsal' }],
		start_datetime: [{ _id: 'cval-start', datetime: '2026-09-02T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'cval-dur', number: 60 }],
		location: [{ _id: 'cval-loc', string: 'Crede Hall' }],
		_parent: [{ _id: 'cv-season', reference: 'cseason', entity_type: 'season' }],
		_owner: [{ reference: 'p-crede' }]
	};
}

type WireOpts = {
	/** How many write POSTs against entity/ev1 fail with a 500 before the wire
	 *  recovers. Default 0. */
	failWritePosts?: number;
	/** Hold every write POST open until release() — the mid-write-switch probe. */
	holdWritePost?: boolean;
	/** Hold the polyphony event GET open — the "loading claims nothing" probe. */
	holdEventGet?: boolean;
};

/**
 * The #304 wire: page.spec.ts's liberal read stub (fixtures served whether the
 * impl reads by id or by query) + the series write choreography — a `_parent`
 * POST/DELETE is APPLIED to the in-memory event, so a GREEN that re-reads
 * after the write sees the NEW parent (and its inheritance), and one that
 * re-derives locally passes identically. Routes by db segment: `/crede/`
 * serves the OTHER collective (no series at all).
 */
function seriesWireStub(eventOver?: Record<string, unknown>, opts: WireOpts = {}) {
	const event: Record<string, unknown> = eventOver ?? ownerEvent();
	const season = seasonEntity();
	const series1 = series1Entity();
	const series2 = series2Entity();
	const credeEvent = credeEventEntity();
	let failsLeft = opts.failWritePosts ?? 0;
	let newValueN = 0;
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';

		if (url.includes('/crede/')) {
			if (url.includes('/entity/ev1')) return json({ entity: credeEvent });
			if (url.includes('/entity/cseason')) return json({ entity: { _id: 'cseason' } });
			if (url.includes('_type.string=event')) {
				// event AND event_series queries both: crede has NO series.
				return url.includes('event_series')
					? json({ entities: [] })
					: json({ entities: [credeEvent] });
			}
			return json({ entities: [] });
		}

		if (method === 'DELETE' && url.includes('/property/')) {
			const valueId = url.split('/property/')[1]?.split('?')[0] ?? '';
			event._parent = (event._parent as Array<{ _id: string }>).filter(
				(v) => v._id !== valueId
			);
			return json({ deleted: true });
		}
		if (method === 'POST' && url.includes('/entity/ev1')) {
			if (opts.holdWritePost) await gate;
			if (failsLeft > 0) {
				failsLeft -= 1;
				return json({ message: 'boom' }, 500);
			}
			const entries = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			for (const entry of entries) {
				if (entry.type === '_parent') {
					const list = (event._parent as Array<{ _id: string }>).filter(
						(v) => v._id !== entry._id
					);
					const ref = String(entry.reference);
					list.push({
						_id: `pv-new-${++newValueN}`,
						reference: ref,
						entity_type: ref.startsWith('series') ? 'event_series' : 'season'
					} as { _id: string });
					event._parent = list;
				} else {
					const { type, _id: _discard, ...valueParts } = entry;
					void _discard;
					event[String(type)] = [{ _id: `val-${String(type)}-new`, ...valueParts }];
				}
			}
			return json({});
		}
		if (url.includes('/entity/ev1')) {
			if (opts.holdEventGet) await gate;
			return json({ entity: event });
		}
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series1 });
		if (url.includes('/entity/series2')) return json({ entity: series2 });
		if (url.includes('_type.string=profile')) return json({ entities: [] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series1, series2] });
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
	return { stub, release: () => release() };
}

function setAuthed(withCrede = false) {
	authStore.set({
		status: 'authenticated',
		personIdByDb: withCrede
			? { polyphony: 'p-viewer', crede: 'p-crede' }
			: { polyphony: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: withCrede
			? [
					{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' },
					{ db: 'crede', name: 'Crede', personId: 'p-crede' }
				]
			: [{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function renderSeriesPage(
	eventOver?: Record<string, unknown>,
	opts: WireOpts = {},
	withCrede = false
) {
	const { stub, release } = seriesWireStub(eventOver, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(withCrede);
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, release };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q<T extends Element = HTMLElement>(container: HTMLElement, testid: string): T | null {
	return container.querySelector<T>(`[data-testid="${testid}"]`);
}
async function waitSelect(container: HTMLElement): Promise<HTMLSelectElement> {
	await waitFor(() => {
		expect(q(container, 'event-series-select')).not.toBeNull();
	});
	return q<HTMLSelectElement>(container, 'event-series-select')!;
}
function optionTexts(select: HTMLSelectElement): string[] {
	return Array.from(select.options).map((o) => o.textContent ?? '');
}
function writeCalls(stub: ReturnType<typeof vi.fn>) {
	return stub.mock.calls
		.map((c) => ({
			url: String(c[0]),
			method: ((c[1] as RequestInit | undefined)?.method ?? 'GET') as string,
			body: (c[1] as RequestInit | undefined)?.body
		}))
		.filter((c) => c.method === 'POST' || c.method === 'DELETE');
}
function parentPosts(stub: ReturnType<typeof vi.fn>) {
	return writeCalls(stub)
		.filter((c) => c.method === 'POST' && c.url.includes('/entity/ev1'))
		.map((c) => JSON.parse(String(c.body)) as Array<Record<string, unknown>>);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — data layer: seriesId + inheritedFields join the EventDetail contract
// ═════════════════════════════════════════════════════════════════════════════

describe('#304 loadEventDetail — seriesId joins the contract (computed today, discarded today)', () => {
	it('carries the event_series parent id', async () => {
		const { stub } = seriesWireStub(eventEntity());
		const detail = await loadEventDetail(cfg, 'ev1', stub as unknown as typeof fetch);
		expect(detail.seriesId).toBe('series1');
	});

	it('null (seasonId’s rule — never "") when the event is standalone', async () => {
		const { stub } = seriesWireStub(eventEntity({ _parent: STANDALONE_PARENTS }));
		const detail = await loadEventDetail(cfg, 'ev1', stub as unknown as typeof fetch);
		expect(detail.seriesId).toBeNull();
	});
});

describe('#304 loadEventDetail — inheritedFields: the RAW-PRESENCE test, never displayed truthiness', () => {
	it('an event with own values for all four inherits NOTHING', async () => {
		const { stub } = seriesWireStub(eventEntity());
		const detail = await loadEventDetail(cfg, 'ev1', stub as unknown as typeof fetch);
		expect(detail.inheritedFields).toEqual([]);
	});

	it('all four raw-absent → all four inherited, display order pinned', async () => {
		const { stub } = seriesWireStub(eventEntity(INHERITING));
		const detail = await loadEventDetail(cfg, 'ev1', stub as unknown as typeof fetch);
		expect(detail.inheritedFields).toEqual(['name', 'durationMinutes', 'location', 'description']);
	});

	it('a STORED "" name and a STORED 0 duration BLOCK inheritance — they are real values that merely display blank', async () => {
		const { stub } = seriesWireStub(
			eventEntity({
				name: [{ _id: 'val-name-1', string: '' }],
				duration_minutes: [{ _id: 'val-dur-1', number: 0 }],
				location: undefined,
				description: undefined
			})
		);
		const detail = await loadEventDetail(cfg, 'ev1', stub as unknown as typeof fetch);
		expect(detail.inheritedFields).toEqual(['location', 'description']);
	});

	it('a field the SERIES does not supply is not "inherited" — nothing actually comes from the series', async () => {
		const { stub } = seriesWireStub(
			eventEntity({ location: undefined, description: undefined })
		);
		// series1 supplies default_location but the test needs a series WITHOUT
		// default_description — rewire the series read only.
		const inner = stub;
		const wrapped = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/entity/series1')) {
				return json({
					entity: {
						_id: 'series1',
						name: [{ string: 'Tuesday Series' }],
						duration_minutes: [{ number: 120 }],
						default_location: [{ string: 'Church Hall' }]
						// no default_description
					}
				});
			}
			return inner(input, init);
		});
		const detail = await loadEventDetail(cfg, 'ev1', wrapped as unknown as typeof fetch);
		expect(detail.inheritedFields).toEqual(['location']);
	});

	it('a standalone event inherits nothing', async () => {
		const { stub } = seriesWireStub(
			eventEntity({ ...INHERITING, _parent: STANDALONE_PARENTS })
		);
		const detail = await loadEventDetail(cfg, 'ev1', stub as unknown as typeof fetch);
		expect(detail.inheritedFields).toEqual([]);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — the control: native, labelled, season-scoped, current preselected
//     (integration: rendered by the ACTUAL page route)
// ═════════════════════════════════════════════════════════════════════════════

describe('#304 — the series select on the event page (owner view)', () => {
	it('renders a NATIVE <select data-testid="event-series-select"> with a real <label for>', async () => {
		const { container } = renderSeriesPage(ownerEvent());
		const select = await waitSelect(container);
		expect(select.tagName).toBe('SELECT');
		expect(select.id).not.toBe('');
		const label = container.querySelector(`label[for="${select.id}"]`);
		expect(label).not.toBeNull();
		expect(label!.textContent).toContain('[event_detail_series_label]');
	});

	it('options = the none-option + every series of THIS season, current series preselected', async () => {
		const { container } = renderSeriesPage(ownerEvent());
		const select = await waitSelect(container);
		const texts = optionTexts(select);
		expect(texts.some((t) => t.includes('[event_detail_series_none]'))).toBe(true);
		expect(texts.some((t) => t.includes('Tuesday Series'))).toBe(true);
		expect(texts.some((t) => t.includes('Wednesday Series'))).toBe(true);
		// Current series preselected — option values are series ids, '' = none
		// (the event-create-series convention).
		expect(select.value).toBe('series1');
	});

	it('the options come from a SEASON-SCOPED series query — a cross-season series would move the event between seasons', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent());
		await waitSelect(container);
		const seriesQueries = fetchStub.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('_type.string=event_series'));
		expect(seriesQueries.length).toBeGreaterThan(0);
		expect(seriesQueries.every((u) => u.includes('_parent.reference=season1'))).toBe(true);
	});

	it('a STANDALONE event preselects the none-option (a real state, not a placeholder prompt)', async () => {
		const { container } = renderSeriesPage(ownerEvent({ _parent: STANDALONE_PARENTS }));
		const select = await waitSelect(container);
		expect(select.value).toBe('');
		expect(select.selectedOptions[0]?.textContent ?? '').toContain('[event_detail_series_none]');
	});

	it('a plain member (no rights visible) gets NO picker and NO note at all', async () => {
		const { container } = renderSeriesPage(eventEntity());
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
		});
		expect(q(container, 'event-series-select')).toBeNull();
		expect(q(container, 'event-series-rights-note')).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — rights asymmetry (SPIKE: owner-gated DELETE; ruling 5613471404)
// ═════════════════════════════════════════════════════════════════════════════

describe('#304 — unassign is OWNER-gated: option absent below owner tier, PLUS the note', () => {
	it('owner on a series event → the none-option is offered, no rights-note', async () => {
		const { container } = renderSeriesPage(ownerEvent());
		const select = await waitSelect(container);
		expect(optionTexts(select).some((t) => t.includes('[event_detail_series_none]'))).toBe(true);
		expect(q(container, 'event-series-rights-note')).toBeNull();
	});

	it('editor-NOT-owner on a series event → none-option ABSENT (not disabled) AND the rights-note renders', async () => {
		const { container } = renderSeriesPage(editorEvent());
		const select = await waitSelect(container);
		// ABSENT, not disabled: no option carries the none text, no option
		// carries the '' value.
		expect(optionTexts(select).some((t) => t.includes('[event_detail_series_none]'))).toBe(false);
		expect(Array.from(select.options).some((o) => o.value === '')).toBe(false);
		// …and the missing option is EXPLAINED — a hole inside a normal-looking
		// dropdown is invisible without a note (#301's precedent: absent + note).
		const note = q(container, 'event-series-rights-note');
		expect(note).not.toBeNull();
		expect(note!.textContent).toContain('[event_detail_series_rights_note]');
		// The reassign half stays uniform: every season series is still offered.
		expect(optionTexts(select).some((t) => t.includes('Tuesday Series'))).toBe(true);
		expect(optionTexts(select).some((t) => t.includes('Wednesday Series'))).toBe(true);
	});

	it('editor-NOT-owner on a STANDALONE event → NO note (nothing to unassign — the note would be noise) and the none state still shows', async () => {
		const { container } = renderSeriesPage(editorEvent({ _parent: STANDALONE_PARENTS }));
		const select = await waitSelect(container);
		expect(q(container, 'event-series-rights-note')).toBeNull();
		// The none-option here is the CURRENT STATE, not the gated operation —
		// withholding it would misrepresent the event.
		expect(select.value).toBe('');
		expect(select.selectedOptions[0]?.textContent ?? '').toContain('[event_detail_series_none]');
	});

	it('while the event read is still in flight, NEITHER the select NOR the note renders — loading is not a positive claim', async () => {
		const { container } = renderSeriesPage(editorEvent(), { holdEventGet: true });
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		expect(q(container, 'event-series-select')).toBeNull();
		expect(q(container, 'event-series-rights-note')).toBeNull();
	});

	it('editor-NOT-owner can still REASSIGN (the editor-reachable half): selecting another series writes the atomic overwrite', async () => {
		const { container, fetchStub } = renderSeriesPage(editorEvent());
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: 'series2' } });
		await waitFor(() => {
			expect(parentPosts(fetchStub).length).toBeGreaterThan(0);
		});
		expect(parentPosts(fetchStub)[0]).toEqual([
			{ _id: 'pv-series', type: '_parent', reference: 'series2' }
		]);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — the inherited fields are NAMED on screen — raw presence, never truthiness
// ═════════════════════════════════════════════════════════════════════════════

describe('#304 — the on-screen inherited-fields list (owner view)', () => {
	it('an event inheriting all four names all four', async () => {
		const { container } = renderSeriesPage(ownerEvent(INHERITING));
		await waitSelect(container);
		expect(q(container, 'event-series-inherited-name')).not.toBeNull();
		expect(q(container, 'event-series-inherited-duration')).not.toBeNull();
		expect(q(container, 'event-series-inherited-location')).not.toBeNull();
		expect(q(container, 'event-series-inherited-description')).not.toBeNull();
	});

	it('an event with all four own values names NONE', async () => {
		const { container } = renderSeriesPage(ownerEvent());
		await waitSelect(container);
		expect(q(container, 'event-series-inherited-name')).toBeNull();
		expect(q(container, 'event-series-inherited-duration')).toBeNull();
		expect(q(container, 'event-series-inherited-location')).toBeNull();
		expect(q(container, 'event-series-inherited-description')).toBeNull();
	});

	it('partial inheritance lists ONLY the actually-inherited fields', async () => {
		const { container } = renderSeriesPage(
			ownerEvent({ duration_minutes: undefined, location: undefined })
		);
		await waitSelect(container);
		expect(q(container, 'event-series-inherited-name')).toBeNull();
		expect(q(container, 'event-series-inherited-duration')).not.toBeNull();
		expect(q(container, 'event-series-inherited-location')).not.toBeNull();
		expect(q(container, 'event-series-inherited-description')).toBeNull();
	});

	it('a STORED "" name inherits NOTHING on screen — the raw-array test, not the displayed blank', async () => {
		const { container } = renderSeriesPage(
			ownerEvent({ name: [{ _id: 'val-name-1', string: '' }] })
		);
		const select = await waitSelect(container);
		expect(q(container, 'event-series-inherited-name')).toBeNull();
		expect(q(container, 'event-series-inherited-duration')).toBeNull();
		expect(q(container, 'event-series-inherited-location')).toBeNull();
		expect(q(container, 'event-series-inherited-description')).toBeNull();
		// …and therefore NO ceremony either (pinned properly in block 5, but the
		// causal pair belongs together: no inheritance → nothing to confirm).
		await fireEvent.change(select, { target: { value: 'series2' } });
		expect(q(container, 'event-series-confirm')).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — the consequence is visible BEFORE the write; the safe case pays nothing
// ═════════════════════════════════════════════════════════════════════════════

describe('#304 — consequence preview and confirmation (owner view)', () => {
	it('REASSIGN with inherited fields: the confirm block shows what they will BECOME (the new series’ values) — and NOTHING is written yet', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent(INHERITING));
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: 'series2' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm')).not.toBeNull();
		});
		const confirm = q(container, 'event-series-confirm')!;
		// The NEW series' values, as data — name, duration, location, description.
		expect(confirm.textContent).toContain('Wednesday Series');
		expect(confirm.textContent).toContain('75');
		expect(confirm.textContent).toContain('Chapel');
		expect(confirm.textContent).toContain('Bring scores.');
		expect(writeCalls(fetchStub)).toEqual([]);
	});

	it('UNASSIGN with inherited fields: the confirm block names which fields CLEAR, and that the name ends EMPTY (#132 — series children carry no own name)', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent(INHERITING));
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: '' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm')).not.toBeNull();
		});
		const confirm = q(container, 'event-series-confirm')!;
		expect(confirm.textContent).toContain('[event_detail_series_field_name]');
		expect(confirm.textContent).toContain('[event_detail_series_field_duration]');
		expect(confirm.textContent).toContain('[event_detail_series_field_location]');
		expect(confirm.textContent).toContain('[event_detail_series_field_description]');
		expect(confirm.textContent).toContain('[event_detail_series_unassign_name_empty]');
		expect(writeCalls(fetchStub)).toEqual([]);
	});

	it('UNASSIGN with PARTIAL inheritance names only the fields that actually clear — no name warning when the name is the event’s own', async () => {
		const { container } = renderSeriesPage(
			ownerEvent({ duration_minutes: undefined, location: undefined })
		);
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: '' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm')).not.toBeNull();
		});
		const confirm = q(container, 'event-series-confirm')!;
		expect(confirm.textContent).toContain('[event_detail_series_field_duration]');
		expect(confirm.textContent).toContain('[event_detail_series_field_location]');
		expect(confirm.textContent).not.toContain('[event_detail_series_field_name]');
		expect(confirm.textContent).not.toContain('[event_detail_series_field_description]');
		expect(confirm.textContent).not.toContain('[event_detail_series_unassign_name_empty]');
	});

	it('CANCEL restores the previous selection and writes NOTHING', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent(INHERITING));
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: 'series2' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm-cancel')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-series-confirm-cancel')!);
		await waitFor(() => {
			expect(q(container, 'event-series-confirm')).toBeNull();
		});
		expect((q<HTMLSelectElement>(container, 'event-series-select'))!.value).toBe('series1');
		expect(writeCalls(fetchStub)).toEqual([]);
	});

	it('an event inheriting NOTHING changes series with NO confirmation step — the picker just works', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent());
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: 'series2' } });
		// No ceremony…
		expect(q(container, 'event-series-confirm')).toBeNull();
		// …the write just happens, atomically targeting the series value id.
		await waitFor(() => {
			expect(parentPosts(fetchStub).length).toBeGreaterThan(0);
		});
		expect(parentPosts(fetchStub)[0]).toEqual([
			{ _id: 'pv-series', type: '_parent', reference: 'series2' }
		]);
		expect(q(container, 'event-series-confirm')).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — the write itself: wire safety + #289's truthful-state rule
// ═════════════════════════════════════════════════════════════════════════════

describe('#304 — the committed write (owner view)', () => {
	it('REASSIGN apply: ONE atomic-overwrite POST pairing the OLD series value id with the new reference; the season value id in NO write; the four field props NEVER written', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent(INHERITING));
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: 'series2' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm-apply')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-series-confirm-apply')!);
		await waitFor(() => {
			expect(parentPosts(fetchStub).length).toBeGreaterThan(0);
		});
		expect(parentPosts(fetchStub)).toEqual([
			[{ _id: 'pv-series', type: '_parent', reference: 'series2' }]
		]);
		const writes = writeCalls(fetchStub);
		// Season safety: pv-season appears in no write URL and no write body.
		expect(writes.some((c) => c.url.includes('pv-season'))).toBe(false);
		expect(writes.some((c) => String(c.body ?? '').includes('pv-season'))).toBe(false);
		// No silent copying: no write touches the four inheritable props.
		for (const post of parentPosts(fetchStub)) {
			for (const entry of post) expect(entry.type).toBe('_parent');
		}
		expect(writes.some((c) => c.method === 'DELETE')).toBe(false);
	});

	it('REASSIGN success is SERVER-CONFIRMED and announced; the page shows the NEW series’ values with no stale inherited text', async () => {
		const { container } = renderSeriesPage(ownerEvent(INHERITING));
		const select = await waitSelect(container);
		// Before: series1's inheritance on screen.
		expect(q(container, 'event-detail-location')?.textContent).toContain('Church Hall');
		await fireEvent.change(select, { target: { value: 'series2' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm-apply')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-series-confirm-apply')!);
		await waitFor(() => {
			const status = q(container, 'event-series-status');
			expect(status).not.toBeNull();
			expect(status!.textContent).toContain('[event_detail_series_saved]');
		});
		await waitFor(() => {
			expect(q(container, 'event-detail-location')?.textContent ?? '').toContain('Chapel');
		});
		expect(q(container, 'event-detail-location')?.textContent ?? '').not.toContain('Church Hall');
		expect((q<HTMLSelectElement>(container, 'event-series-select'))!.value).toBe('series2');
	});

	it('UNASSIGN apply: ONE DELETE of the series value id, no POST, season untouched; the cleared field leaves the screen', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent({ location: undefined }));
		const select = await waitSelect(container);
		expect(q(container, 'event-detail-location')?.textContent).toContain('Church Hall');
		await fireEvent.change(select, { target: { value: '' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm-apply')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-series-confirm-apply')!);
		await waitFor(() => {
			expect(writeCalls(fetchStub).some((c) => c.method === 'DELETE')).toBe(true);
		});
		const dels = writeCalls(fetchStub).filter((c) => c.method === 'DELETE');
		expect(dels).toHaveLength(1);
		expect(dels[0].url).toContain('/property/pv-series');
		expect(parentPosts(fetchStub)).toEqual([]);
		await waitFor(() => {
			const status = q(container, 'event-series-status');
			expect(status).not.toBeNull();
		});
		// No stale inherited text: 'Church Hall' came from the series and the
		// series is gone.
		expect(q(container, 'event-detail-location')?.textContent ?? '').not.toContain('Church Hall');
		expect((q<HTMLSelectElement>(container, 'event-series-select'))!.value).toBe('');
	});

	it('a FAILED write says what did not happen and leaves the PREVIOUS series selected — nothing on screen pretends', async () => {
		const { container, fetchStub } = renderSeriesPage(ownerEvent(INHERITING), {
			failWritePosts: 1
		});
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: 'series2' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm-apply')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-series-confirm-apply')!);
		await waitFor(() => {
			const error = q(container, 'event-series-error');
			expect(error).not.toBeNull();
			expect(error!.textContent).toContain('[event_detail_series_save_error]');
		});
		expect((q<HTMLSelectElement>(container, 'event-series-select'))!.value).toBe('series1');
		expect(q(container, 'event-series-status')).toBeNull();
		// The page still shows the OLD series' inheritance — the write did not land.
		expect(q(container, 'event-detail-location')?.textContent ?? '').toContain('Church Hall');
	});

	it('a write resolving AFTER a collective switch must NOT land into the other collective’s view (the page’s generation-guard idiom)', async () => {
		const { container, fetchStub, release } = renderSeriesPage(
			ownerEvent(INHERITING),
			{ holdWritePost: true },
			true
		);
		const select = await waitSelect(container);
		await fireEvent.change(select, { target: { value: 'series2' } });
		await waitFor(() => {
			expect(q(container, 'event-series-confirm-apply')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'event-series-confirm-apply')!);
		// The write is in flight (held) — deterministic setup.
		await waitFor(() => {
			expect(parentPosts(fetchStub).length).toBeGreaterThan(0);
		});

		// Switch collectives — crede's SAME event id resolves to a different
		// event with NO series at all.
		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Event');
		});

		// NOW settle the held write. If the resolution is not generation-guarded
		// it announces success into crede's view / repaints stale series data.
		release();
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(q(container, 'event-series-status')).toBeNull();
		expect(q(container, 'event-detail-name')?.textContent).toContain('Crede Event');
		const credeSelect = q<HTMLSelectElement>(container, 'event-series-select');
		if (credeSelect) {
			const values = Array.from(credeSelect.options).map((o) => o.value);
			expect(values).not.toContain('series1');
			expect(values).not.toContain('series2');
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 — i18n keys exist in all four locales (en/et/lv/uk), none empty
// ═════════════════════════════════════════════════════════════════════════════

describe('#304 — i18n keys exist in all four locales, none empty', () => {
	// The proposed key set — `event_detail_` prefix so the page's existing
	// locale-completeness guard (page.i18n-a11y.spec.ts:349) covers them for
	// free. Comenius authors the actual copy in GREEN; this pins presence.
	const KEYS = [
		'event_detail_series_label',
		'event_detail_series_none',
		'event_detail_series_inherited_label',
		'event_detail_series_field_name',
		'event_detail_series_field_duration',
		'event_detail_series_field_location',
		'event_detail_series_field_description',
		'event_detail_series_unassign_name_empty',
		'event_detail_series_confirm_apply',
		'event_detail_series_confirm_cancel',
		'event_detail_series_saved',
		'event_detail_series_save_error',
		'event_detail_series_rights_note'
	];

	for (const locale of ['en', 'et', 'lv', 'uk']) {
		it(`${locale}.json carries every event_detail_series_* key, non-empty`, () => {
			const messages = JSON.parse(
				readFileSync(resolve(`messages/${locale}.json`), 'utf8')
			) as MessageFile;
			expect(
				KEYS.filter((k) => !(k in messages)),
				`${locale}.json is missing series-picker keys`
			).toEqual([]);
			expect(
				KEYS.filter((k) => isMessageEmpty(messages[k])),
				`${locale}.json has empty series-picker keys`
			).toEqual([]);
		});
	}
});

// (*MVOX:Tallis* — #304 RED: event page series picker)
