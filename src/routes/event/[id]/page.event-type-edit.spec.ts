// @vitest-environment happy-dom
//
// #245 (RED) — `event_type` becomes the SIXTH inline-editable field on the
// event detail page. From live pilot testing (Joosep): an event mis-filed as a
// rehearsal must be changeable to a concert without delete-and-recreate.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/lib/events/eventFieldEdit.ts
//     • 'event_type' joins the EditableEventField union. NO new write
//       machinery: the write goes through the existing updateEventField →
//       replaceEntityProperty path, and wireProp's `default:` branch already
//       produces the correct `{ type: 'event_type', string }` wire value.
//
//   src/routes/event/[id]/+page.svelte
//     • For a rights-holder (the SAME owner-OR-editor gate the other five
//       fields run — do not widen it) the type badge becomes an editable
//       field in the #205/#157 idiom: the whole field area is the activator —
//       a native <button> (Tab-reachable by default, standing rule 4/4b),
//       data-testid="event-edit-btn-event_type", label as an sr-only CHILD
//       (never aria-label — it would silence the value), aria-hidden ✎ glyph,
//       the badge span riding INSIDE the button so the #211 color survives.
//     • Activation swaps in a NATIVE <select> (standing rule 1),
//       data-testid="event-edit-input-event_type", carrying its own
//       aria-label (the button is unmounted the moment the select appears),
//       seeded with the CURRENT type. Its options are THE SAME option source
//       the create forms use (#199): CANONICAL_EVENT_TYPES rendered through
//       eventTypeLabel — the eight canonical types, localized, in schema
//       order. NOT a second hand-typed list.
//     • Enter and blur save; Escape reverts without a write; a blur WITHOUT a
//       change writes nothing (opening the editor must never rewrite the
//       displayed value). Choosing an option does NOT save by itself —
//       change updates the draft only, so Escape after a change still
//       reverts cleanly.
//     • After a successful save the badge re-renders with the NEW type's
//       #211 color and localized label, without a reload (optimistic or
//       re-read — same posture as the other five fields).
//     • A failed write reverts the badge and shows the same inline error
//       surface the other fields use: event-edit-error-event_type.
//     • Series child: the write targets THIS event's id only — event_type is
//       deliberately non-inherited (#194/#202) and a type change must never
//       touch the parent series or any sibling.
//     • Empty event_type: the existing guard stays — no bare empty pill for
//       anyone. A rights-holder still gets the edit button (empty → set,
//       exactly like the empty-description case the other fields pin), the
//       fresh-open select reads as EMPTY ('' — never a silently preselected
//       'rehearsal'), and blurring it untouched writes nothing.
//     • A non-editor keeps today's display-only badge: no button, no select.
//
// Assertions match on DATA (values, wire bodies, testids), never translated
// sentences — same posture as page.event-editing.spec.ts (full-fallback
// paraglide proxy). Fixtures and wire stub mirror that suite's.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — same hygiene as the
// sibling suites: only Date is faked, timers stay real for waitFor.
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
// The union member is the contract: this import + the literal below fail
// `pnpm check` until GREEN adds 'event_type' to EditableEventField.
import { updateEventField, type EditableEventField } from '$lib/events/eventFieldEdit';
// #199 — the ONE canonical option source the create forms already render.
// Importing it here (instead of retyping eight strings) is deliberate: the
// select's options are asserted against THIS list, so a second hand-typed
// list in the page could only pass by coinciding with it exactly.
import { CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
// #211 — the badge color contract the re-render must satisfy.
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
import { authStore } from '$lib/auth/session';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const cfg = { db: 'polyphony', token: 'jwt' };

// 'event_type' must be assignable to the union — a type-level pin that makes
// `pnpm check` RED until eventFieldEdit.ts grows the member.
const FIELD: EditableEventField = 'event_type';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures ────────────────────────────────────────────────────────────
// Same event as page.event-editing.spec.ts: a SERIES CHILD (parent series1),
// event_type 'rehearsal' with a per-value _id the replace choreography must
// delete.

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

function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return eventEntity({ _editor: [{ reference: 'p-viewer' }], ...over });
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
		// The series carries its OWN event_type-shaped default the child must
		// never write to (and never read — #194/#202 non-inheritance).
		event_type: [{ _id: 'val-series-type-1', string: 'rehearsal' }],
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
};

/** Same liberal read stub + applied-write choreography as the sibling suite:
 *  a POST against entity/ev1 REPLACES each posted field on the in-memory
 *  event, so an impl that re-reads after a write and one that keeps the
 *  optimistic value pass identically. */
function editWireStub(eventOver?: Record<string, unknown>, opts: EditWireOpts = {}) {
	const event: Record<string, unknown> = eventOver ?? eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	let failsLeft = opts.failEditPosts ?? 0;
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') {
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
	return { stub };
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
	const { stub } = editWireStub(eventOver, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub };
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

/** Every write POST the page issued against ANY entity. */
function allPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls.filter(
		(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
	);
}

/** Write POSTs against the event entity specifically. */
function editPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return allPosts(fetchStub).filter((c) => String(c[0]).includes('/entity/ev1'));
}

function postedProps(call: unknown[]): Array<Record<string, unknown>> {
	return JSON.parse(String((call[1] as RequestInit).body)) as Array<Record<string, unknown>>;
}

function deletedPropertyUrls(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls
		.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'DELETE')
		.map((c) => String(c[0]));
}

/** Tap the type field's activator and hand back the select it becomes. */
async function beginTypeEdit(container: HTMLElement): Promise<HTMLSelectElement> {
	await waitFor(() => {
		expect(
			container.querySelector('[data-testid="event-edit-btn-event_type"]'),
			'event-edit-btn-event_type missing'
		).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-event_type"]')!);
	return await waitFor(() => {
		const el = container.querySelector('[data-testid="event-edit-input-event_type"]');
		expect(el, 'event-edit-input-event_type missing after tapping the badge').not.toBeNull();
		return el as HTMLSelectElement;
	});
}

function expectClasses(el: Element, classes: string) {
	for (const cls of classes.split(' ').filter(Boolean)) {
		expect([...el.classList], `expected class ${cls} on ${el.getAttribute('data-testid')}`).toContain(
			cls
		);
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// data layer: 'event_type' rides the EXISTING updateEventField path
// ═════════════════════════════════════════════════════════════════════════════

function fieldWireStub(existing: Array<Record<string, unknown>>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/ev1') && method === 'POST') return json({});
		if (url.includes('/entity/ev1'))
			return json({ entity: { _id: 'ev1', event_type: existing } });
		return json({ entities: [] });
	});
}

describe("updateEventField('event_type') — the existing replace choreography, no new machinery", () => {
	it('replaces the existing type ATOMICALLY (#264): lookup asks for event_type, then ONE POST whose entry carries the old value id — no DELETE round-trip', async () => {
		const fetchImpl = fieldWireStub([{ _id: 'val-type-1', string: 'rehearsal' }]);
		await updateEventField(cfg, 'ev1', FIELD, 'concert', fetchImpl as unknown as typeof fetch);

		const calls = fetchImpl.mock.calls.map((c) => ({
			url: String(c[0]),
			method: (c[1] as RequestInit | undefined)?.method ?? 'GET',
			body: (c[1] as RequestInit | undefined)?.body
		}));
		const lookup = calls.find((c) => c.method === 'GET' && c.url.includes('/entity/ev1'));
		expect(lookup, 'no lookup GET of the event').not.toBeUndefined();
		expect(lookup!.url).toContain('props=');
		expect(lookup!.url).toContain('event_type');
		const postIdx = calls.findIndex((c) => c.method === 'POST' && c.url.includes('/entity/ev1'));
		expect(postIdx, 'no POST of the new value').toBeGreaterThan(-1);
		// FULL wire shape: the old id + a `string` value — the same default:
		// branch the other string fields use, atomically replacing val-type-1.
		expect(JSON.parse(String(calls[postIdx].body))).toEqual([
			{ _id: 'val-type-1', type: 'event_type', string: 'concert' }
		]);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('a type set from EMPTY skips the deletes and just POSTs the one value', async () => {
		const fetchImpl = fieldWireStub([]);
		await updateEventField(cfg, 'ev1', FIELD, 'concert', fetchImpl as unknown as typeof fetch);
		expect(deletedPropertyUrls(fetchImpl)).toEqual([]);
		const posts = fetchImpl.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(posts).toHaveLength(1);
		expect(postedProps(posts[0])).toEqual([{ type: 'event_type', string: 'concert' }]);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: the badge is an editable field for a rights-holder — display-only for
// everyone else (integration: the real route, real data layer, stubbed wire)
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — the type badge gains the #205 whole-field activator, rights-gated', () => {
	it('an _editor gets event-edit-btn-event_type: a real Tab-reachable <button> wrapping the colored badge, sr-only label, aria-hidden glyph', async () => {
		const { container } = renderEditPage(editorEvent());
		const btn = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-btn-event_type"]');
			expect(el, 'event-edit-btn-event_type missing for an _editor').not.toBeNull();
			return el as HTMLButtonElement;
		});
		// Standing rule 4/4b — a NATIVE button, in the keyboard tab order.
		expect(btn.tagName).toBe('BUTTON');
		expect(btn.getAttribute('tabindex')).not.toBe('-1');
		// #157 idiom — label as sr-only CHILD, never aria-label (it would silence
		// the badge value the button now wraps).
		expect(btn.getAttribute('aria-label')).toBeNull();
		expect(btn.querySelector('.sr-only')?.textContent).toContain(
			'event_edit_event_type_aria_label'
		);
		const glyph = [...btn.querySelectorAll('span')].find((el) =>
			(el.textContent ?? '').includes('✎')
		);
		expect(glyph, 'pencil glyph span missing').not.toBeUndefined();
		expect(glyph!.getAttribute('aria-hidden')).toBe('true');
		// The badge itself rides INSIDE the activator — #211 color and localized
		// label intact.
		const badge = container.querySelector('[data-testid="event-detail-type"]');
		expect(badge, 'the colored badge must survive inside the button').not.toBeNull();
		expect(btn.contains(badge!), 'the badge is the button content (whole-field target)').toBe(
			true
		);
		expectClasses(badge!, eventTypeBadgeClass('rehearsal'));
		expect(badge!.textContent).toContain('[event_type_rehearsal]');
	});

	it('the editable header now counts SIX whole-field activators — the five plus event_type', async () => {
		const { container } = renderEditPage(editorEvent());
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-event_type"]')).not.toBeNull();
		});
		const testids = [...container.querySelectorAll('[data-testid^="event-edit-btn-"]')].map((el) =>
			el.getAttribute('data-testid')
		);
		expect(testids.sort()).toEqual(
			[
				'event-edit-btn-name',
				'event-edit-btn-start_datetime',
				'event-edit-btn-duration_minutes',
				'event-edit-btn-location',
				'event-edit-btn-description',
				'event-edit-btn-event_type'
			].sort()
		);
	});

	it('a non-editor keeps the display-only badge: colored, labelled, and NOT inside any button', async () => {
		const { container } = renderEditPage(); // default fixture: no rights visible
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass('rehearsal'));
		expect(badge.textContent).toContain('[event_type_rehearsal]');
		expect(container.querySelector('[data-testid="event-edit-btn-event_type"]')).toBeNull();
		expect(badge.closest('button'), 'display-only means no activator around the badge').toBeNull();
		expect(container.querySelector('[data-testid="event-edit-input-event_type"]')).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: activation → the create forms' native select, same option source
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — tapping the badge opens the #199 canonical native <select>', () => {
	it('a native SELECT, self-labelled, seeded with the current type, listing EXACTLY the eight canonical types in schema order via eventTypeLabel', async () => {
		const { container } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		// Standing rule 1 — native control, no custom widget.
		expect(select.tagName).toBe('SELECT');
		// The activator is unmounted, so the select names itself.
		expect(container.querySelector('[data-testid="event-edit-btn-event_type"]')).toBeNull();
		expect(select.getAttribute('aria-label')).toContain('event_edit_event_type_aria_label');
		// Seeded with the CURRENT value.
		expect(select.value).toBe('rehearsal');
		// #199 — SAME option source as create: values are CANONICAL_EVENT_TYPES
		// (schema order, no free text), labels route through eventTypeLabel →
		// paraglide (the proxy renders the message keys).
		const options = [...select.querySelectorAll('option')];
		expect(options.map((o) => o.value).filter((v) => v !== '')).toEqual([
			...CANONICAL_EVENT_TYPES
		]);
		for (const type of CANONICAL_EVENT_TYPES) {
			const opt = options.find((o) => o.value === type)!;
			expect(opt.textContent).toContain(`[event_type_${type}]`);
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: save / cancel gestures + the #211 re-render
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — Enter and blur save; the badge re-renders in the new color without a reload', () => {
	it('blur after choosing concert: ONE full-shape write to THIS event, and the badge flips to concert label + concert #211 classes', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'concert' } });
		await fireEvent.blur(select);

		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			// The db path proves the page threaded the SELECTED collective's cfg
			// through the real data layer — not a hardcoded db, not a bypass.
			expect(String(posts[0][0])).toContain('/polyphony/');
			expect(String(posts[0][0])).toContain('/entity/ev1');
			expect(postedProps(posts[0])).toEqual([
				{ _id: 'val-type-1', type: 'event_type', string: 'concert' }
			]);
		});
		// FULL shape of everything written anywhere: exactly this one prop.
		const allProps = editPosts(fetchStub).flatMap((c) => postedProps(c));
		expect(allProps).toEqual([{ _id: 'val-type-1', type: 'event_type', string: 'concert' }]);

		// The badge re-renders in place — new label, new #211 color, old color
		// gone, editor closed. No navigation, no reload.
		await waitFor(() => {
			const badge = container.querySelector('[data-testid="event-detail-type"]');
			expect(badge).not.toBeNull();
			expect(badge!.textContent).toContain('[event_type_concert]');
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expectClasses(badge, eventTypeBadgeClass('concert'));
		expect([...badge.classList]).not.toContain('text-type-rehearsal');
		expect(container.querySelector('[data-testid="event-edit-input-event_type"]')).toBeNull();
		expect(gotoMock, 'no navigation — the badge updates in place').not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="event-edit-error-event_type"]')).toBeNull();
	});

	it('Enter confirms too — same single full-shape write', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'festival' } });
		await fireEvent.keyDown(select, { key: 'Enter' });
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([
				{ _id: 'val-type-1', type: 'event_type', string: 'festival' }
			]);
		});
		expect(editPosts(fetchStub), 'exactly ONE write per confirm').toHaveLength(1);
	});

	it('Escape AFTER choosing a different type reverts: no write, badge unchanged, activator back — so choosing an option must not save by itself', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'concert' } });
		await fireEvent.keyDown(select, { key: 'Escape' });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-event_type"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="event-edit-btn-event_type"]')).not.toBeNull();
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expect(badge.textContent).toContain('[event_type_rehearsal]');
		expectClasses(badge, eventTypeBadgeClass('rehearsal'));
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('a blur WITHOUT a change cancels — opening the editor never rewrites the displayed type', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		await fireEvent.blur(select);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-input-event_type"]')).toBeNull();
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		expect(container.querySelector('[data-testid="event-detail-type"]')!.textContent).toContain(
			'[event_type_rehearsal]'
		);
	});

	it('a failed write reverts the badge to the old type and shows event-edit-error-event_type — same error surface as the other five', async () => {
		const { container } = renderEditPage(editorEvent(), { failEditPosts: Infinity });
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'concert' } });
		await fireEvent.blur(select);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-error-event_type"]')).not.toBeNull();
		});
		const badge = container.querySelector('[data-testid="event-detail-type"]')!;
		expect(badge.textContent).toContain('[event_type_rehearsal]');
		expect(badge.textContent).not.toContain('[event_type_concert]');
		expectClasses(badge, eventTypeBadgeClass('rehearsal'));
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: series child — the write targets THIS event only (#194/#202)
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — changing a series child’s type touches that event alone', () => {
	it('every POST targets /entity/ev1 and every DELETE targets the child’s OWN value id — the parent series is never written', async () => {
		// The fixture event is a child of series1, which carries its own
		// event_type value (val-series-type-1). Non-inheritance (#194/#202) means
		// the child's type change is entirely local.
		const { container, fetchStub } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'concert' } });
		await fireEvent.blur(select);
		await waitFor(() => {
			expect(editPosts(fetchStub).length).toBeGreaterThan(0);
		});
		await new Promise((r) => setTimeout(r, 30));

		// ALL entity writes, anywhere on the wire, hit the child and only the child.
		for (const call of allPosts(fetchStub)) {
			expect(String(call[0]), 'a write escaped to another entity').toContain('/entity/ev1');
		}
		expect(
			allPosts(fetchStub).some((c) => String(c[0]).includes('series1')),
			'the parent series must never be written'
		).toBe(false);
		// #264 — the atomic overwrite replaced the CHILD's old value id inside
		// the POST body (no property DELETE goes out at all); the series' own
		// event_type value is never named anywhere on the wire.
		expect(deletedPropertyUrls(fetchStub)).toEqual([]);
		const postBodies = editPosts(fetchStub).map((c) =>
			JSON.parse(String((c[1] as RequestInit).body))
		);
		expect(
			postBodies.some((body: Array<{ _id?: string }>) =>
				body.some((entry) => entry._id === 'val-type-1')
			),
			"the child's own old value id must ride the overwrite POST"
		).toBe(true);
		expect(JSON.stringify(postBodies)).not.toContain('val-series-type-1');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// page: empty event_type — the guard survives, and empty → set works
// ═════════════════════════════════════════════════════════════════════════════

describe('/event/[id] — an event with no event_type', () => {
	it('a non-editor sees NO pill at all — the existing empty-guard stands', async () => {
		const { container } = renderEditPage(eventEntity({ event_type: [] }));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
				'Tuesday Rehearsal'
			);
		});
		expect(container.querySelector('[data-testid="event-detail-type"]')).toBeNull();
		expect(container.querySelector('[data-testid="event-edit-btn-event_type"]')).toBeNull();
	});

	it('an _editor still gets the activator (empty → set, like the empty-description case) — but no bare pill inside it', async () => {
		const { container } = renderEditPage(editorEvent({ event_type: [] }));
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-edit-btn-event_type"]')).not.toBeNull();
		});
		// The empty-guard survives the restructure: an empty type renders NO pill
		// for anyone, editor included.
		expect(container.querySelector('[data-testid="event-detail-type"]')).toBeNull();
	});

	it('the fresh-open select reads as EMPTY — blurring it untouched writes nothing (no silently preselected rehearsal)', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent({ event_type: [] }));
		const select = await beginTypeEdit(container);
		// The canonical eight are all offered; the current (empty) selection is
		// representable, so merely opening + blurring cannot manufacture a type.
		expect(select.value).toBe('');
		expect([...select.querySelectorAll('option')].map((o) => o.value).filter((v) => v !== '')).toEqual(
			[...CANONICAL_EVENT_TYPES]
		);
		await fireEvent.blur(select);
		await new Promise((r) => setTimeout(r, 30));
		expect(editPosts(fetchStub)).toEqual([]);
		expect(container.querySelector('[data-testid="event-detail-type"]')).toBeNull();
	});

	it('an _editor can SET a type from empty: pick concert, blur → one full-shape write, badge appears in concert color', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent({ event_type: [] }));
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'concert' } });
		await fireEvent.blur(select);
		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(postedProps(posts[0])).toEqual([{ type: 'event_type', string: 'concert' }]);
		});
		// No pre-existing value → the replace choreography had nothing to delete.
		expect(deletedPropertyUrls(fetchStub)).toEqual([]);
		await waitFor(() => {
			const badge = container.querySelector('[data-testid="event-detail-type"]');
			expect(badge, 'the badge appears once a type exists').not.toBeNull();
			expect(badge!.textContent).toContain('[event_type_concert]');
		});
		expectClasses(
			container.querySelector('[data-testid="event-detail-type"]')!,
			eventTypeBadgeClass('concert')
		);
	});
});

// (*MVOX:Tallis*)
