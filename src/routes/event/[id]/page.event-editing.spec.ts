// @vitest-environment happy-dom
//
// #104 TE.4 (RED) — inline event editing on the detail page. Parent: #81
// (Event detail 1.0). A rights-holder (`_owner` OR `_editor` on the EVENT —
// the same one-rule gate the tally runs, manageRightsFrom) edits the header
// fields in place: tap a pencil, the field becomes an input, blur/Enter
// confirms with an immediate optimistic write, Escape cancels, a failed write
// reverts with an inline error. Per-tap immediate writes, same posture as
// attendanceData (no "save all" payload anywhere in the contract).
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/lib/events/eventFieldEdit.ts (new)
//     export type EditableEventField =
//       'name' | 'start_datetime' | 'duration_minutes' | 'location' | 'description';
//     export async function updateEventField(
//       cfg: { db: string; token: string },
//       eventId: string,
//       field: EditableEventField,
//       value: string | number,
//       fetchImpl?: typeof fetch
//     ): Promise<void>;
//
//     Replace semantics per the pinned Entu wire contract — POST APPENDS to
//     implicitly multi-valued props, so a naive POST would leave the OLD value
//     standing beside the new one:
//       1. GET entity/{eventId}?props={field} → the existing value ids (FIRST,
//          so the deletes can only ever target PRE-EXISTING ids);
//       2. POST entity/{eventId} with exactly ONE new value;
//       3. DELETE property/{valueId} for EVERY id from step 1 (not just the
//          first — corrupted double-values must not survive as phantoms).
//     POST BEFORE DELETE (#91 review F5, the house rule repertoireActions and
//     sectionActions run): with DELETE first, a POST that fails leaves the
//     property EMPTY server-side while the page reverts the header to the old
//     value — the UI would misrepresent server state, and eventDetail would
//     fall the field back to the parent series default (or '') next load.
//     Wire value key by field type: name/location/description → `string`;
//     start_datetime → `datetime` (ISO instant, UTC); duration_minutes →
//     `number` (a NUMBER on the wire, never a numeric string).
//     Non-2xx anywhere → throw (fail loud, no silent success).
//
//   src/routes/event/[id]/+page.svelte — inline editing on the header:
//     • event-edit-btn-{field} — a pencil <button> per editable field (the
//       five above), rendered ONLY when manageRightsFrom(detail.ownerIds,
//       detail.editorIds, personId) === 'editor' — the SAME event-rights rule
//       the tally gate runs (ownership subsumes editing; rights props live in
//       the private bucket, so a plain member reads NO rights lists at all).
//       An EMPTY optional field (e.g. no description) still gets its button
//       for a rights-holder — otherwise the field could never be SET inline.
//     • tap → event-edit-input-{field}, seeded with the CURRENT value:
//         name / location        → <input type="text">
//         start_datetime         → #207 rule 5: a composite under this same
//                                  testid (on a wrapper) — a native
//                                  <input type="date"> at -date plus the
//                                  TimeSelect -hour/-minute selects (24h
//                                  default, 5-min steps by construction; -ampm
//                                  only in AM/PM preference mode). Seeded with
//                                  the TALLINN wall-clock value the header
//                                  itself displays (never raw UTC — the user
//                                  edits the time she sees). Commit = focus
//                                  leaving the WHOLE composite (focusout with
//                                  an outside/absent relatedTarget); moving
//                                  between the composite's own parts is not a
//                                  commit. A PARTIAL composite (date without
//                                  time or vice versa) reads as EMPTY — it
//                                  must never produce a malformed string.
//         duration_minutes       → #243: the number input is GONE. The field
//                                  keeps its duration_minutes IDENTITY (testids,
//                                  wire, eventFieldEdit.ts all unchanged) but
//                                  its EDITOR is now an END composite — the
//                                  same rule-5 shape as start_datetime, under
//                                  this same testid on a wrapper: -date native
//                                  input + TimeSelect -hour/-minute. SEEDED
//                                  with start + duration projected to Tallinn
//                                  wall clock (Done-when 6: existing events
//                                  with only a duration derive their end — no
//                                  migration, no backfill). Commit derives
//                                  minutes = (utc(end) − utc(start)), each
//                                  endpoint converted INDEPENDENTLY (DST-safe:
//                                  real elapsed minutes, never wall-clock
//                                  arithmetic), and writes duration_minutes
//                                  ONLY — an end edit never touches
//                                  start_datetime, and NO end prop of any
//                                  spelling ever reaches the wire (schema
//                                  settled on the issue: event =
//                                  start_datetime + duration_minutes). An end
//                                  at or before the start writes NOTHING and
//                                  surfaces event_end_before_start in the
//                                  existing event-edit-error-duration_minutes
//                                  slot; a cleared end cancels (a literal 0
//                                  would mask a series-inherited duration).
//         description            → <textarea> (multiline)
//       Every edit input carries its OWN accessible name (aria-label, the same
//       per-field key the pencil uses): the pencil <button> is UNMOUNTED the
//       moment the input appears, so its label cannot name the textbox.
//     • blur confirms; Enter ALSO confirms on single-line inputs (but NOT in
//       the textarea, where Enter inserts a newline). Confirm = optimistic
//       local value (the header updates immediately) + updateEventField fired
//       at once; on success the optimistic value simply stands (the written
//       value IS authoritative — no forced re-read required).
//       start_datetime converts the Tallinn wall-clock input back to the UTC
//       instant before writing.
//     • Escape cancels: edit mode closes, the original value is restored,
//       NOTHING is written. A blur WITHOUT a change cancels identically (#104:
//       "Cancel: Escape or blur without change") — critical because name,
//       duration_minutes, location and description may be INHERITED from the
//       parent event_series, and writing the displayed value back would
//       materialise the series default as a permanent event-level override.
//       A blur on an empty/unparseable start_datetime, or on a cleared or
//       negative duration, likewise writes nothing (and must never throw).
//     • a FAILED write reverts the display to the pre-edit value and shows an
//       inline error, event-edit-error-{field}; a later successful edit of
//       the same field clears it.
//     • NON-editable header surfaces get no pencil at all: event_type,
//       capacity, conductors (conductor resolution is #77's season/event
//       merge — not a single prop to inline-edit).
//
// Assertions match on DATA (values, wire bodies, testids), never translated
// sentences — same posture as page.spec.ts (full-fallback paraglide proxy).
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — the page derives read-only
// state from the clock for past events, and this suite must not start behaving
// differently when real time passes the fixture. Only Date is faked; timers
// stay real so waitFor polls normally. (Same hygiene as page.spec.ts.)
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
import {
	HOURS_24,
	MINUTES_5,
	commitDateTime,
	fillDateTime,
	fillTime,
	optionValues,
	readDateTime
} from '$lib/testing/timeControls';
// The TE.4 contract module — does not exist yet; GREEN creates it.
import { updateEventField, type EditableEventField } from '$lib/events/eventFieldEdit';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const cfg = { db: 'polyphony', token: 'jwt' };

const EDITABLE_FIELDS: EditableEventField[] = [
	'name',
	'start_datetime',
	'duration_minutes',
	'location',
	'description'
];

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures ─────────────────────────────────────────────────────────────
// Same event as page.spec.ts (2026-09-01T16:00Z = 19:00 Europe/Tallinn, EEST
// UTC+3), with per-value `_id`s on every editable prop — the edit lookup needs
// value ids to DELETE (replace semantics).

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
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		...over
	};
}

/** The rights-holder's view: the viewer IS in the event's `_editor` list. */
function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
}

/** Ownership subsumes editing — `_owner` without `_editor` must gate open too. */
function ownerOnlyEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _owner: [{ reference: 'p-viewer' }], ...over });
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

const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	]
};

type EditWireOpts = {
	/** How many edit POSTs against entity/ev1 fail with a 500 before the wire
	 *  recovers. Default 0 (all succeed). */
	failEditPosts?: number;
	/** Hold every edit POST open until release() — the optimistic-window probe. */
	holdEditPost?: boolean;
};

/**
 * The TE.4 wire: the same liberal read stub page.spec.ts uses (serves the
 * fixtures whether the impl reads by id or by query), PLUS the edit write
 * choreography — property DELETEs succeed, and a POST against entity/ev1 is
 * APPLIED to the in-memory event (each posted prop replaces that field
 * wholesale, which is exactly what delete-then-post semantics produce). So a
 * GREEN that chooses to re-read after a write sees the NEW value, and one that
 * keeps the optimistic value locally passes identically: the tests pin the
 * CONTRACT, not one reconcile choreography.
 */
function editWireStub(eventOver?: Record<string, unknown>, opts: EditWireOpts = {}) {
	const event: Record<string, unknown> = eventOver ?? eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	let failsLeft = opts.failEditPosts ?? 0;
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') {
			if (opts.holdEditPost) await gate;
			if (failsLeft > 0) {
				failsLeft -= 1;
				return json({ message: 'boom' }, 500);
			}
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
		if (url.includes('_type.string=profile')) {
			for (const [personId, list] of Object.entries(PROFILES)) {
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
	return { stub, release: () => release() };
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

function renderEditPage(eventOver?: Record<string, unknown>, opts: EditWireOpts = {}) {
	const { stub, release } = editWireStub(eventOver, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
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

/** Tap the field's pencil and hand back the input it becomes. */
async function beginEdit(
	container: HTMLElement,
	field: EditableEventField
): Promise<HTMLInputElement | HTMLTextAreaElement> {
	await waitFor(() => {
		expect(
			container.querySelector(`[data-testid="event-edit-btn-${field}"]`),
			`event-edit-btn-${field} missing`
		).not.toBeNull();
	});
	await fireEvent.click(container.querySelector(`[data-testid="event-edit-btn-${field}"]`)!);
	return await waitFor(() => {
		const el = container.querySelector(`[data-testid="event-edit-input-${field}"]`);
		expect(el, `event-edit-input-${field} missing after tapping edit`).not.toBeNull();
		return el as HTMLInputElement | HTMLTextAreaElement;
	});
}

// ═════════════════════════════════════════════════════════════════════════════
// data layer: updateEventField — replace-semantics single-field write
// ═════════════════════════════════════════════════════════════════════════════

/** A minimal wire for the data-layer tests: ONE entity, one field's existing
 *  value ids, and switches to fail each leg of the choreography. */
function fieldWireStub(
	field: string,
	existing: Array<Record<string, unknown>>,
	opts: { failPost?: boolean; failLookup?: boolean } = {}
) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST')
			return opts.failPost ? json({ message: 'boom' }, 500) : json({});
		if (url.includes('/entity/ev1'))
			return opts.failLookup ? json({}, 500) : json({ entity: { _id: 'ev1', [field]: existing } });
		return json({ entities: [] });
	});
}

describe('updateEventField — replace semantics (GET value-ids → POST the new value → DELETE each old)', () => {
	it('replaces an existing string value: posts exactly one new value BEFORE deleting the old value id', async () => {
		const fetchImpl = fieldWireStub('name', [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }]);
		await updateEventField(cfg, 'ev1', 'name', 'Autumn Sing', fetchImpl as unknown as typeof fetch);

		const calls = fetchImpl.mock.calls.map((c) => ({
			url: String(c[0]),
			method: (c[1] as RequestInit | undefined)?.method ?? 'GET',
			body: (c[1] as RequestInit | undefined)?.body
		}));
		// The lookup asked for the field it is about to replace.
		const lookup = calls.find((c) => c.method === 'GET' && c.url.includes('/entity/ev1'));
		expect(lookup, 'no lookup GET of the event').not.toBeUndefined();
		expect(lookup!.url).toContain('props=');
		expect(lookup!.url).toContain('name');
		// The old value was deleted — POST appends, so skipping this leaves BOTH
		// values on the entity (the pinned Entu multi-value trap).
		const deleteIdx = calls.findIndex(
			(c) => c.method === 'DELETE' && c.url.includes('/property/val-name-1')
		);
		expect(deleteIdx, 'old value id was never deleted').toBeGreaterThan(-1);
		const postIdx = calls.findIndex((c) => c.method === 'POST' && c.url.includes('/entity/ev1'));
		expect(postIdx, 'no POST of the new value').toBeGreaterThan(-1);
		// POST BEFORE DELETE (#91 review F5, mirrored from repertoireActions):
		// with DELETE first, a failed POST leaves the property EMPTY and the
		// event silently falls back to the series default on the next load.
		expect(postIdx, 'the new value must land before the old one is deleted').toBeLessThan(
			deleteIdx
		);
		// Exactly ONE new value, exactly this shape.
		expect(JSON.parse(String(calls[postIdx].body))).toEqual([
			{ type: 'name', string: 'Autumn Sing' }
		]);
	});

	it('deletes EVERY existing value id, not just the first (a leftover value survives as a phantom)', async () => {
		const fetchImpl = fieldWireStub('location', [
			{ _id: 'val-loc-1', string: 'Rehearsal Hall' },
			{ _id: 'val-loc-2', string: 'Old Hall' }
		]);
		await updateEventField(cfg, 'ev1', 'location', 'Song Festival Grounds', fetchImpl as unknown as typeof fetch);
		const methods = fetchImpl.mock.calls.map(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') as string
		);
		const deletedIds = fetchImpl.mock.calls
			.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'DELETE')
			.map((c) => String(c[0]));
		expect(deletedIds.some((u) => u.includes('val-loc-1'))).toBe(true);
		expect(deletedIds.some((u) => u.includes('val-loc-2'))).toBe(true);
		// …and EVERY one of them after the POST — the ids came from the GET, so a
		// delete can never take the value just written.
		expect(methods.indexOf('POST')).toBeLessThan(methods.indexOf('DELETE'));
	});

	it('a failed POST leaves the OLD value standing — no delete is issued at all', async () => {
		const fetchImpl = fieldWireStub('name', [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }], {
			failPost: true
		});
		await expect(
			updateEventField(cfg, 'ev1', 'name', 'Autumn Sing', fetchImpl as unknown as typeof fetch)
		).rejects.toThrow();
		const deletes = fetchImpl.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'DELETE'
		);
		expect(deletes, 'a failed write must never empty the property').toEqual([]);
	});

	it('a field with NO existing value skips the deletes entirely and just POSTs', async () => {
		const fetchImpl = fieldWireStub('description', []);
		await updateEventField(cfg, 'ev1', 'description', 'New note.', fetchImpl as unknown as typeof fetch);
		const deletes = fetchImpl.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'DELETE'
		);
		expect(deletes).toEqual([]);
		const posts = fetchImpl.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(posts).toHaveLength(1);
		expect(postedProps(posts[0])).toEqual([{ type: 'description', string: 'New note.' }]);
	});

	it('start_datetime writes a `datetime` value; duration_minutes writes a `number` — typed, never a numeric string', async () => {
		const dtFetch = fieldWireStub('start_datetime', [
			{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }
		]);
		await updateEventField(
			cfg,
			'ev1',
			'start_datetime',
			'2026-09-02T17:00:00.000Z',
			dtFetch as unknown as typeof fetch
		);
		const dtPost = dtFetch.mock.calls.find(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(postedProps(dtPost!)).toEqual([
			{ type: 'start_datetime', datetime: '2026-09-02T17:00:00.000Z' }
		]);

		const numFetch = fieldWireStub('duration_minutes', [{ _id: 'val-dur-1', number: 90 }]);
		await updateEventField(cfg, 'ev1', 'duration_minutes', 120, numFetch as unknown as typeof fetch);
		const numPost = numFetch.mock.calls.find(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		const numProps = postedProps(numPost!);
		expect(numProps).toEqual([{ type: 'duration_minutes', number: 120 }]);
		expect(typeof numProps[0].number, 'wire number must be a JSON number').toBe('number');
	});

	it('throws on a failed POST and on a failed lookup — fail loud, never a silent no-op', async () => {
		const failPost = fieldWireStub('name', [{ _id: 'val-name-1', string: 'x' }], {
			failPost: true
		});
		await expect(
			updateEventField(cfg, 'ev1', 'name', 'New', failPost as unknown as typeof fetch)
		).rejects.toThrow();

		const failLookup = fieldWireStub('name', [], { failLookup: true });
		await expect(
			updateEventField(cfg, 'ev1', 'name', 'New', failLookup as unknown as typeof fetch)
		).rejects.toThrow();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: edit buttons are rights-gated (integration — the real route, real data
// layer, only the wire stubbed)
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — edit buttons, gated on the event-rights rule (owner OR editor)', () => {
	it('an _editor sees a pencil on ALL five editable header fields — and on nothing else', async () => {
		const { container } = renderEditPage(editorEvent());
		await waitFor(() => {
			for (const field of EDITABLE_FIELDS) {
				expect(
					container.querySelector(`[data-testid="event-edit-btn-${field}"]`),
					`event-edit-btn-${field} missing`
				).not.toBeNull();
			}
		});
		for (const field of EDITABLE_FIELDS) {
			const btn = container.querySelector(`[data-testid="event-edit-btn-${field}"]`)!;
			expect(btn.tagName, `event-edit-btn-${field} must be a real button`).toBe('BUTTON');
		}
		// EXACTLY the editable set, no stray pencil on any non-editable surface —
		// #245 adds event_type as the sixth (its own contract lives in
		// page.event-type-edit.spec.ts).
		expect(container.querySelectorAll('[data-testid^="event-edit-btn-"]')).toHaveLength(6);
	});

	it('a plain member (no rights visible — the private-bucket default) sees NO edit buttons at all', async () => {
		const { container } = renderEditPage(); // default fixture: no _owner/_editor
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelectorAll('[data-testid^="event-edit-btn-"]')).toHaveLength(0);
	});

	it('an _editor list WITHOUT the viewer reveals nothing — membership of the list, not presence of the prop', async () => {
		const { container } = renderEditPage(eventEntity({ _editor: [{ reference: 'p-other' }] }));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelectorAll('[data-testid^="event-edit-btn-"]')).toHaveLength(0);
	});

	it('an _owner who is NOT in _editor gets the pencils too — ownership subsumes editing (one rule, not two)', async () => {
		const { container } = renderEditPage(ownerOnlyEvent());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-name"]')).not.toBeNull();
		});
		// #245 — five original fields + event_type.
		expect(container.querySelectorAll('[data-testid^="event-edit-btn-"]')).toHaveLength(6);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: tap → the field becomes the right kind of input, seeded with the
// current value
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — tap edit → input, per field type', () => {
	it('name → a text input seeded with the current name', async () => {
		const { container } = renderEditPage(editorEvent());
		const input = await beginEdit(container, 'name');
		expect(input.tagName).toBe('INPUT');
		expect((input as HTMLInputElement).type).toBe('text');
		expect(input.value).toBe('Tuesday Rehearsal');
	});

	it('start_datetime → #207 composite (date input + 24h hour/minute selects) seeded with the TALLINN wall-clock the header displays (19:00, not 16:00 UTC)', async () => {
		const { container } = renderEditPage(editorEvent());
		const wrapper = await beginEdit(container, 'start_datetime');
		// #207 rule 5 — the surface testid now sits on a WRAPPER, not a native
		// datetime-local input (whose time half renders per browser locale).
		expect(wrapper.tagName).not.toBe('INPUT');
		const date = container.querySelector(
			'[data-testid="event-edit-input-start_datetime-date"]'
		) as HTMLInputElement;
		expect(date, 'native date input (picker stays, Gama ruling)').not.toBeNull();
		expect(date.type).toBe('date');
		expect(date.value).toBe('2026-09-01');
		const hour = container.querySelector(
			'[data-testid="event-edit-input-start_datetime-hour"]'
		) as HTMLSelectElement;
		const minute = container.querySelector(
			'[data-testid="event-edit-input-start_datetime-minute"]'
		) as HTMLSelectElement;
		expect(hour.tagName).toBe('SELECT');
		expect(minute.tagName).toBe('SELECT');
		expect(optionValues(hour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(minute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(
			container.querySelector('[data-testid="event-edit-input-start_datetime-ampm"]'),
			'24h is the default mode'
		).toBeNull();
		// 2026-09-01T16:00Z = 19:00 Europe/Tallinn (EEST). The user edits the time
		// she sees on this very page — never the raw UTC instant.
		expect(readDateTime(container, 'event-edit-input-start_datetime')).toBe('2026-09-01T19:00');
	});

	it('duration_minutes → #243: an END composite seeded with start + duration as Tallinn wall clock (19:00 + 90 min → 20:30, Done-when 6)', async () => {
		const { container } = renderEditPage(editorEvent());
		const wrapper = await beginEdit(container, 'duration_minutes');
		// The editor is the SAME composite shape as start_datetime — never a
		// number input, never a hand-rolled second time control (Done-when 7).
		expect(wrapper.tagName).not.toBe('INPUT');
		const date = container.querySelector(
			'[data-testid="event-edit-input-duration_minutes-date"]'
		) as HTMLInputElement;
		expect(date, 'native end date input (picker stays)').not.toBeNull();
		expect(date.type).toBe('date');
		const hour = container.querySelector(
			'[data-testid="event-edit-input-duration_minutes-hour"]'
		) as HTMLSelectElement;
		const minute = container.querySelector(
			'[data-testid="event-edit-input-duration_minutes-minute"]'
		) as HTMLSelectElement;
		expect(hour.tagName).toBe('SELECT');
		expect(minute.tagName).toBe('SELECT');
		expect(optionValues(hour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(minute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(
			container.querySelector('[data-testid="event-edit-input-duration_minutes-ampm"]'),
			'24h is the default mode'
		).toBeNull();
		// 2026-09-01T16:00Z (19:00 EEST) + 90 min → the END the header displays.
		expect(readDateTime(container, 'event-edit-input-duration_minutes')).toBe('2026-09-01T20:30');
	});

	it('#243 seed round-trips across the October fall-back: start 10:00 EEST + 1800 min → end 2026-10-25T15:00 wall clock (not 16:00)', async () => {
		const { container } = renderEditPage(
			editorEvent({
				start_datetime: [{ _id: 'val-start-1', datetime: '2026-10-24T07:00:00.000Z' }],
				duration_minutes: [{ _id: 'val-dur-1', number: 1800 }]
			})
		);
		await beginEdit(container, 'duration_minutes');
		// 1800 REAL minutes from 2026-10-24T07:00Z is 2026-10-25T13:00Z, which the
		// fallen-back clock (EET, UTC+2) reads as 15:00 — wall-clock arithmetic
		// (10:00 + 30h = 16:00) would show the viewer an end an hour late.
		expect(readDateTime(container, 'event-edit-input-duration_minutes')).toBe('2026-10-25T15:00');
	});

	it('location → a text input; description → a TEXTAREA (multiline), both seeded', async () => {
		const { container } = renderEditPage(editorEvent());
		const location = await beginEdit(container, 'location');
		expect(location.tagName).toBe('INPUT');
		expect(location.value).toBe('Rehearsal Hall');

		const description = await beginEdit(container, 'description');
		expect(description.tagName).toBe('TEXTAREA');
		expect(description.value).toBe('Come 15 minutes early for warm-ups.');
	});

	it('an event with NO description still offers the pencil to a rights-holder — an empty field must be settable inline', async () => {
		// No description on the event AND none inherited from the series would hide
		// the display element entirely; the EDIT affordance must not vanish with it.
		const { container } = renderEditPage(editorEvent({ description: undefined }));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-description"]')).not.toBeNull();
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: confirm → immediate optimistic write; Escape cancels; failure reverts
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — confirm writes optimistically and reconciles', () => {
	it('blur confirms: the header shows the new name IMMEDIATELY (write still in flight), and keeps it once the write lands', async () => {
		const { container, fetchStub, release } = renderEditPage(editorEvent(), {
			holdEditPost: true
		});
		const input = await beginEdit(container, 'name');
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(input);

		// OPTIMISTIC: the POST is held open, yet the header already shows the new
		// value — and no error surface, this is not a failure.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Autumn Sing'
			);
		});
		expect(container.querySelector('[data-testid="event-edit-error-name"]')).toBeNull();
		// …and the write really is in flight (per-tap immediate, no "save" step).
		await waitFor(() => {
			expect(editPosts(fetchStub).length).toBeGreaterThan(0);
		});

		// RECONCILE: the write settles; the value stands, still no error.
		release();
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Autumn Sing'
		);
		expect(container.querySelector('[data-testid="event-edit-error-name"]')).toBeNull();
		// Edit mode closed — back to the display, not a lingering input.
		expect(container.querySelector('[data-testid="event-edit-input-name"]')).toBeNull();
	});

	it('Enter confirms a single-line input (same write as blur)', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const input = await beginEdit(container, 'name');
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([{ type: 'name', string: 'Autumn Sing' }]);
		});
	});

	it('Enter does NOT confirm the description textarea — it is a newline there, not a submit', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const textarea = await beginEdit(container, 'description');
		await fireEvent.keyDown(textarea, { key: 'Enter' });
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		// Still editing.
		expect(container.querySelector('[data-testid="event-edit-input-description"]')).not.toBeNull();
	});

	it('location: blur writes the string and the header updates', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const input = await beginEdit(container, 'location');
		await fireEvent.input(input, { target: { value: 'Song Festival Grounds' } });
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-location"]')?.textContent
			).toContain('Song Festival Grounds');
		});
		const posts = editPosts(fetchStub);
		expect(posts.length).toBeGreaterThan(0);
		expect(postedProps(posts[0])).toEqual([
			{ type: 'location', string: 'Song Festival Grounds' }
		]);
	});

	it('description: blur writes the MULTILINE string intact and the header shows it', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const textarea = await beginEdit(container, 'description');
		await fireEvent.input(textarea, { target: { value: 'Bring black folders.\nDoors at 18:30.' } });
		await fireEvent.blur(textarea);
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([
				{ type: 'description', string: 'Bring black folders.\nDoors at 18:30.' }
			]);
		});
		const desc = container.querySelector('[data-testid="event-detail-description"]');
		expect(desc?.textContent).toContain('Bring black folders.');
		expect(desc?.textContent).toContain('Doors at 18:30.');
	});

	it('duration_minutes: #243 — committing an END of 21:00 writes a NUMBER (120, not "120"), duration_minutes ONLY, and the duration line updates', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'duration_minutes');
		// 19:00 start, end moved 20:30 → 21:00 the same day = 120 minutes.
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-09-01', '21:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			const props = postedProps(posts[0]);
			expect(props).toEqual([{ type: 'duration_minutes', number: 120 }]);
			expect(typeof props[0].number).toBe('number');
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-duration"]')?.textContent
			).toContain('120');
		});
		// WIRE DISCIPLINE (full shape of everything written): editing the end
		// writes duration_minutes and NOTHING else — start_datetime untouched, no
		// end prop of any spelling invented.
		await new Promise((r) => setTimeout(r, 30));
		const allProps = editPosts(fetchStub).flatMap((c) => postedProps(c));
		expect(allProps).toEqual([{ type: 'duration_minutes', number: 120 }]);
	});

	it('#243 — a MULTI-DAY end across the October fall-back writes the real elapsed minutes: 10:00 EEST → next-day 15:00 EET = 1800, not 1740', async () => {
		const { container, fetchStub } = renderEditPage(
			editorEvent({
				start_datetime: [{ _id: 'val-start-1', datetime: '2026-10-24T07:00:00.000Z' }]
			})
		);
		await beginEdit(container, 'duration_minutes');
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-10-25', '15:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([{ type: 'duration_minutes', number: 1800 }]);
		});
	});

	it('#243 — across the March spring-forward: 10:00 EET → next-day 15:00 EEST = 1680, not 1740', async () => {
		const { container, fetchStub } = renderEditPage(
			editorEvent({
				start_datetime: [{ _id: 'val-start-1', datetime: '2026-03-28T08:00:00.000Z' }]
			})
		);
		await beginEdit(container, 'duration_minutes');
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-03-29', '15:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([{ type: 'duration_minutes', number: 1680 }]);
		});
	});

	it('start_datetime: the Tallinn wall-clock input converts back to the UTC INSTANT on the wire, and the time line follows', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'start_datetime');
		// The user picks 20:00 the next day, Tallinn time (EEST, UTC+3 in
		// September) — the instant is therefore 17:00Z.
		await fillDateTime(container, 'event-edit-input-start_datetime', '2026-09-02', '20:00');
		await commitDateTime(container, 'event-edit-input-start_datetime');
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			const props = postedProps(posts[0]);
			expect(props).toHaveLength(1);
			expect(props[0].type).toBe('start_datetime');
			// Pin the INSTANT, not one serialisation ('Z' vs '+03:00' both name it).
			expect(new Date(String(props[0].datetime)).getTime()).toBe(
				new Date('2026-09-02T17:00:00.000Z').getTime()
			);
		});
		// The header re-renders off the new value: 20:00 start, +90 min → 21:30.
		await waitFor(() => {
			const time = container.querySelector('[data-testid="event-detail-time"]')?.textContent ?? '';
			expect(time).toContain('20:00');
			expect(time).toContain('21:30');
		});
	});
});

describe('/event/[id] — Escape cancels the edit', () => {
	it('Escape closes the input, restores the original value, and writes NOTHING — even after typing', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const input = await beginEdit(container, 'name');
		await fireEvent.input(input, { target: { value: 'Should Never Land' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-name"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
		// The pencil is back — the field is editable again.
		expect(container.querySelector('[data-testid="event-edit-btn-name"]')).not.toBeNull();
		// Let any write Escape COULD have started settle before asserting none did.
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('#207 review F3 — Escape from INSIDE the start_datetime composite cancels: the gesture lives on the real controls, not on the role="group" wrapper', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'start_datetime');
		// Change the time, then Escape from the minute <select> itself — a
		// non-interactive role="group" must not own key listeners, so every
		// control inside carries the gesture and the event originates there.
		await fillTime(container, 'event-edit-input-start_datetime', '20:00');
		const minute = container.querySelector(
			'[data-testid="event-edit-input-start_datetime-minute"]'
		) as HTMLSelectElement;
		await fireEvent.keyDown(minute, { key: 'Escape' });

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-edit-input-start_datetime"]')
			).toBeNull();
		});
		expect(container.querySelector('[data-testid="event-edit-btn-start_datetime"]')).not.toBeNull();
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});
});

describe('/event/[id] — a blur WITHOUT a change cancels, exactly like Escape', () => {
	it('tapping a pencil and blurring without typing writes NOTHING and closes the editor', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const input = await beginEdit(container, 'name');
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-name"]')).toBeNull();
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
	});

	it('an INHERITED field is not materialised as an event-level override by an idle pencil tap', async () => {
		// No own `location`; the displayed 'Church Hall' comes from the parent
		// event_series' `default_location`. Writing it back would sever
		// inheritance — a later change to the series default would never reach
		// this event again.
		const { container, fetchStub } = renderEditPage(editorEvent({ location: undefined }));
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-location"]')?.textContent
			).toContain('Church Hall');
		});
		const input = await beginEdit(container, 'location');
		expect(input.value).toBe('Church Hall');
		await fireEvent.blur(input);
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub), 'an unchanged blur must not write the inherited value').toEqual(
			[]
		);
	});

	it('an unchanged start_datetime blur writes nothing — the instant, not the string, is what compares', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'start_datetime');
		expect(readDateTime(container, 'event-edit-input-start_datetime')).toBe('2026-09-01T19:00');
		await commitDateTime(container, 'event-edit-input-start_datetime');
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('#207 legacy minute: a stored :03 start renders with 03 as a selected EXTRA option — never silently snapped to the 5-minute grid', async () => {
		// 2026-09-01T16:03Z = 19:03 Europe/Tallinn — pre-#207 data was written
		// at 1-minute resolution and must keep rendering exactly.
		const { container, fetchStub } = renderEditPage(
			editorEvent({
				start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:03:00.000Z' }]
			})
		);
		await beginEdit(container, 'start_datetime');
		const minute = container.querySelector(
			'[data-testid="event-edit-input-start_datetime-minute"]'
		) as HTMLSelectElement;
		expect(optionValues(minute), "the exact legacy minute is an option").toContain('03');
		expect(minute.value).toBe('03');
		expect(readDateTime(container, 'event-edit-input-start_datetime')).toBe('2026-09-01T19:03');

		// Re-saving WITHOUT a change writes nothing — display-only, the value
		// is never rewritten by merely opening the editor.
		await commitDateTime(container, 'event-edit-input-start_datetime');
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('#207 legacy minute: saving a DIFFERENT field on a :03 event never touches start_datetime', async () => {
		const { container, fetchStub } = renderEditPage(
			editorEvent({
				start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:03:00.000Z' }]
			})
		);
		const input = await beginEdit(container, 'name');
		await fireEvent.input(input, { target: { value: 'Renamed rehearsal' } });
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(editPosts(fetchStub).length).toBeGreaterThan(0);
		});
		await new Promise((r) => setTimeout(r, 30));
		// FULL shape of everything written: the name, and ONLY the name.
		const allProps = editPosts(fetchStub).flatMap((c) => postedProps(c));
		expect(allProps).toEqual([{ type: 'name', string: 'Renamed rehearsal' }]);
	});
});

describe('/event/[id] — degenerate drafts cancel instead of throwing or writing junk', () => {
	it('a TIMELESS event: the pencil opens an empty picker, and blurring it neither throws nor writes', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent({ start_datetime: undefined }));
		await beginEdit(container, 'start_datetime');
		expect(readDateTime(container, 'event-edit-input-start_datetime')).toBe('');
		await commitDateTime(container, 'event-edit-input-start_datetime');
		// The editor closed (an uncaught RangeError out of the blur handler would
		// strand the input open) and nothing was written.
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-edit-input-start_datetime"]'),
				'the empty picker must close on blur, not strand the page in edit mode'
			).toBeNull();
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('a timeless event can still HAVE a start set inline — the empty picker is not a dead end', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent({ start_datetime: undefined }));
		await beginEdit(container, 'start_datetime');
		await fillDateTime(container, 'event-edit-input-start_datetime', '2026-09-02', '20:00');
		await commitDateTime(container, 'event-edit-input-start_datetime');
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			const props = postedProps(posts[0]);
			expect(props[0].type).toBe('start_datetime');
			expect(new Date(String(props[0].datetime)).getTime()).toBe(
				new Date('2026-09-02T17:00:00.000Z').getTime()
			);
		});
	});

	it('CLEARING an existing datetime and blurring writes nothing (there is no "unset the start" gesture here)', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'start_datetime');
		// #207 — clearing the DATE part leaves a PARTIAL composite (time still
		// selected): it must read as empty and never emit a malformed string.
		await fireEvent.input(
			container.querySelector('[data-testid="event-edit-input-start_datetime-date"]')!,
			{ target: { value: '' } }
		);
		expect(readDateTime(container, 'event-edit-input-start_datetime')).toBe('');
		await commitDateTime(container, 'event-edit-input-start_datetime');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-start_datetime"]')).toBeNull();
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		// The original start still stands.
		expect(container.querySelector('[data-testid="event-detail-time"]')?.textContent).toContain(
			'19:00'
		);
	});

	it('#243 — a CLEARED end (date part emptied → partial composite) writes nothing: a literal 0 would MASK the series-inherited duration, not restore it', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'duration_minutes');
		await fireEvent.input(
			container.querySelector('[data-testid="event-edit-input-duration_minutes-date"]')!,
			{ target: { value: '' } }
		);
		expect(readDateTime(container, 'event-edit-input-duration_minutes')).toBe('');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-edit-input-duration_minutes"]')
			).toBeNull();
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		expect(
			container.querySelector('[data-testid="event-detail-duration"]')?.textContent
		).toContain('90');
	});

	it('#243 — an UNCHANGED end commit writes nothing (the seeded projection is not a change): an idle pencil tap must not materialise anything', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'duration_minutes');
		expect(readDateTime(container, 'event-edit-input-duration_minutes')).toBe('2026-09-01T20:30');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('#243 — Escape from inside the end composite reverts: editor closes, nothing written, the 90-minute display stands (#207 review F3 gesture placement)', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'duration_minutes');
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-09-02', '15:00');
		const date = container.querySelector(
			'[data-testid="event-edit-input-duration_minutes-date"]'
		) as HTMLInputElement;
		await fireEvent.keyDown(date, { key: 'Escape' });
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-edit-input-duration_minutes"]')
			).toBeNull();
		});
		expect(
			container.querySelector('[data-testid="event-edit-btn-duration_minutes"]')
		).not.toBeNull();
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		expect(
			container.querySelector('[data-testid="event-detail-duration"]')?.textContent
		).toContain('90');
	});

	it('#243 — an end AT the start writes nothing and says WHY: event_end_before_start in the existing error slot (fail loudly, not a silent no-op)', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'duration_minutes');
		// End == start (19:00 on the same day) — the rule is end <= start on
		// DATETIMES; the date-flavoured copy of season/series/convert would be
		// wrong here, hence the one new shared key.
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-09-01', '19:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-edit-error-duration_minutes"]')
			).not.toBeNull();
		});
		expect(
			container
				.querySelector('[data-testid="event-edit-error-duration_minutes"]')
				?.textContent?.trim()
		).toBe('[event_end_before_start]');
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		// The display never budged.
		expect(
			container.querySelector('[data-testid="event-detail-duration"]')?.textContent
		).toContain('90');
	});

	it('#243 — an end BEFORE the start (earlier same day) is refused identically, and reopening the pencil clears the range error', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'duration_minutes');
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-09-01', '18:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-edit-error-duration_minutes"]')
			).not.toBeNull();
		});
		expect(editPosts(fetchStub)).toEqual([]);

		// Reopening clears the stale refusal — the next commit re-decides.
		await beginEdit(container, 'duration_minutes');
		expect(
			container.querySelector('[data-testid="event-edit-error-duration_minutes"]')
		).toBeNull();
	});

	it('#243 — a TIMELESS event (no start) has an inert end editor: it opens, commits nothing, never throws', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent({ start_datetime: undefined }));
		await beginEdit(container, 'duration_minutes');
		await fillDateTime(container, 'event-edit-input-duration_minutes', '2026-09-02', '15:00');
		await commitDateTime(container, 'event-edit-input-duration_minutes');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-edit-input-duration_minutes"]'),
				'the editor must close, not strand the page in edit mode'
			).toBeNull();
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});
});

describe('/event/[id] — every edit input carries its own accessible name', () => {
	it('the input is labelled, not just the pencil it replaces (the button is unmounted the moment the input appears)', async () => {
		for (const field of EDITABLE_FIELDS) {
			const { container } = renderEditPage(editorEvent());
			const input = await beginEdit(container, field);
			// The pencil that named the affordance is gone…
			expect(container.querySelector(`[data-testid="event-edit-btn-${field}"]`)).toBeNull();
			// …so the textbox has to name itself.
			const label = input.getAttribute('aria-label') ?? input.getAttribute('aria-labelledby');
			expect(label, `event-edit-input-${field} has no accessible name`).toBeTruthy();
			expect(label).toContain(`event_edit_${field}_aria_label`);
			cleanup();
		}
	});

	it('the pencil glyph itself is decorative — the button’s accessible name is the label plus the value it wraps (#157)', async () => {
		const { container } = renderEditPage(editorEvent());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-name"]')).not.toBeNull();
		});
		for (const field of EDITABLE_FIELDS) {
			const btn = container.querySelector(`[data-testid="event-edit-btn-${field}"]`)!;
			// #157 — since the button wraps the value, the label is an sr-only CHILD:
			// an `aria-label` here would override name-from-contents and the value
			// would never be announced.
			expect(btn.getAttribute('aria-label')).toBeNull();
			expect(btn.querySelector('.sr-only')?.textContent).toContain(
				`event_edit_${field}_aria_label`
			);
			const glyph = [...btn.querySelectorAll('*')].find((el) =>
				(el.textContent ?? '').includes('✎')
			);
			expect(glyph?.getAttribute('aria-hidden'), `${field} pencil glyph is not hidden`).toBe(
				'true'
			);
		}
	});
});

describe('/event/[id] — a failed write reverts with an inline error', () => {
	it('server 500 → the header reverts to the pre-edit value and event-edit-error-name renders', async () => {
		const { container } = renderEditPage(editorEvent(), { failEditPosts: Infinity });
		const input = await beginEdit(container, 'name');
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(input);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-error-name"]')).not.toBeNull();
		});
		// REVERTED — the optimistic value must not stand as if it were saved.
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).not.toContain(
			'Autumn Sing'
		);
	});

	it('a later SUCCESSFUL edit of the same field clears the error and lands the value', async () => {
		const { container } = renderEditPage(editorEvent(), { failEditPosts: 1 });
		// First attempt fails…
		const first = await beginEdit(container, 'name');
		await fireEvent.input(first, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(first);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-error-name"]')).not.toBeNull();
		});
		// …the retry succeeds (the wire recovered).
		const second = await beginEdit(container, 'name');
		await fireEvent.input(second, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(second);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Autumn Sing'
			);
		});
		expect(container.querySelector('[data-testid="event-edit-error-name"]')).toBeNull();
	});
});

describe('/event/[id] — a field with a write still in flight cannot be edited again', () => {
	it('the pencil is disabled while its write is open, and a second edit of the same field reaches the wire NOT AT ALL', async () => {
		// Why this matters (review F1): `updateEventField` is GET-then-POST-then-
		// DELETE. Two overlapping writes on one field both GET the same existing
		// value id, both POST (leaving TWO values on the entity), and the losing
		// DELETE 404s — an inline error over a value the server accepted.
		const { container, fetchStub, release } = renderEditPage(editorEvent(), {
			holdEditPost: true
		});
		const input = await beginEdit(container, 'name');
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(input);

		// The write is open (the stub holds the POST) and the pencil is back —
		// disabled, because this field is mid-write.
		await waitFor(() => {
			expect(editPosts(fetchStub).length).toBe(1);
		});
		const pencil = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-btn-name"]');
			expect(el).not.toBeNull();
			return el as HTMLButtonElement;
		});
		expect(pencil.disabled, 'the pencil must be disabled while its write is in flight').toBe(true);

		// …and a tap that beats the re-render is refused too: no second input, so
		// no second confirm, so no second write.
		await fireEvent.click(pencil);
		await new Promise((r) => setTimeout(r, 30));
		expect(container.querySelector('[data-testid="event-edit-input-name"]')).toBeNull();
		expect(editPosts(fetchStub).length, 'exactly ONE write per confirm').toBe(1);

		// Once it settles the field is editable again — this is a per-write gate,
		// not a one-shot lockout.
		release();
		await waitFor(() => {
			expect(
				(container.querySelector('[data-testid="event-edit-btn-name"]') as HTMLButtonElement)
					.disabled
			).toBe(false);
		});
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Autumn Sing'
		);
	});
});

describe('/event/[id] — clearing a text field cancels (there is no "unset" gesture in TE.4)', () => {
	it('an INHERITED description cleared to empty writes nothing — an empty string would MASK the series default, not restore it', async () => {
		// No own `description`; the displayed text comes from the parent series'
		// `default_description`. `eventDetail` reads the event's own value with
		// `??`, and '' is not nullish — writing it would sever inheritance for good.
		const { container, fetchStub } = renderEditPage(editorEvent({ description: undefined }));
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-detail-description"]')?.textContent
			).toContain('Series default note.');
		});
		const textarea = await beginEdit(container, 'description');
		await fireEvent.input(textarea, { target: { value: '' } });
		await fireEvent.blur(textarea);
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub), 'no `string: ""` may reach the wire').toEqual([]);
		expect(
			container.querySelector('[data-testid="event-detail-description"]')?.textContent
		).toContain('Series default note.');
	});

	it("a cleared location writes nothing either — the documented clear is an empty-LIST POST, not an empty value", async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const input = await beginEdit(container, 'location');
		await fireEvent.input(input, { target: { value: '   ' } });
		await fireEvent.blur(input);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-location"]')).toBeNull();
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		expect(container.querySelector('[data-testid="event-detail-location"]')?.textContent).toContain(
			'Rehearsal Hall'
		);
	});
});

describe('/event/[id] — DST transition days convert to the RIGHT instant', () => {
	it('spring forward (29 Mar): 01:30 Tallinn is 23:30Z the day before, not 22:30Z', async () => {
		// The naive single-pass conversion reads the offset at the wall clock
		// re-read AS UTC — which on a transition day sits on the WRONG side of the
		// changeover, writing an instant an hour off from what the editor picked.
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'start_datetime');
		await fillDateTime(container, 'event-edit-input-start_datetime', '2026-03-29', '01:30');
		await commitDateTime(container, 'event-edit-input-start_datetime');
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			const props = postedProps(posts[0]);
			expect(props[0].type).toBe('start_datetime');
			expect(new Date(String(props[0].datetime)).getTime()).toBe(
				new Date('2026-03-28T23:30:00.000Z').getTime()
			);
		});
		// …and the header renders back exactly the wall clock she typed.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-time"]')?.textContent).toContain(
				'01:30'
			);
		});
	});

	it('fall back (25 Oct): 02:30 Tallinn is 23:30Z the day before, not 00:30Z', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		await beginEdit(container, 'start_datetime');
		await fillDateTime(container, 'event-edit-input-start_datetime', '2026-10-25', '02:30');
		await commitDateTime(container, 'event-edit-input-start_datetime');
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			const props = postedProps(posts[0]);
			expect(new Date(String(props[0].datetime)).getTime()).toBe(
				new Date('2026-10-24T23:30:00.000Z').getTime()
			);
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-time"]')?.textContent).toContain(
				'02:30'
			);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: non-editable fields + the explicit end-to-end integration pin
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — non-editable header surfaces get no pencil', () => {
	// #245 supersedes the original event_type pin here: the type badge is now
	// the SIXTH editable field (contract in page.event-type-edit.spec.ts).
	it('capacity and the conductor line have NO edit buttons, even for an _editor', async () => {
		const { container } = renderEditPage(editorEvent());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-name"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-edit-btn-capacity"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-edit-btn-conductor"]')).toBeNull();
		// The exhaustive form of the same claim: only the six editable fields.
		const testids = [...container.querySelectorAll('[data-testid^="event-edit-btn-"]')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(testids.sort()).toEqual(
			[...EDITABLE_FIELDS.map((f) => `event-edit-btn-${f}`), 'event-edit-btn-event_type'].sort()
		);
	});
});

describe('/event/[id] — integration: the edit surface is wired to the REAL page route and the REAL wire', () => {
	it('an _editor completes a name edit on the rendered route and the write reaches Entu for THIS event in the SELECTED collective', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const input = await beginEdit(container, 'name');
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(input);
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			// The db path proves the page threaded the SELECTED collective's cfg into
			// updateEventField — not a hardcoded db, not a bypassed data layer.
			expect(String(posts[0][0])).toContain('/polyphony/');
			expect(String(posts[0][0])).toContain('/entity/ev1');
			expect(postedProps(posts[0])).toEqual([{ type: 'name', string: 'Autumn Sing' }]);
		});
	});
});

// (*MVOX:Tallis*)
