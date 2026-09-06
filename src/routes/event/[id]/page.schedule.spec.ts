// @vitest-environment happy-dom
//
// #262 RED — the event detail page's schedule section (surface A of the PO
// contract: issue #262, Gama 05:30 v1 shape + 11:11 agenda amendment).
//
// INTEGRATION posture: the REAL page (+page.svelte) with the REAL data layer
// running — only the global fetch is stubbed at the wire (same harness family
// as page.spec.ts / page.event-editing.spec.ts). This is what forces GREEN to
// actually wire the schedule data layer into the route.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/routes/event/[id]/+page.svelte grows a schedule section:
//     • event-detail-schedule — its OWN container, NEVER inside
//       [data-testid="event-detail-time"]: page.spec.ts pins exact-count
//       regexes on that element's textContent (match(/19:00/g).toHaveLength(1)
//       at :637 and the AM/PM twin at :2414), and the natural 'kontsert' item
//       shares the event's start time. Placement within the page hierarchy is
//       engineering's call (near the event's own date/time block, PO
//       directional) — these specs assert presence + content, not position.
//     • rows chronological (datetime asc, name tie-break — NO ordinal, #246),
//       each showing name + time; time rendered via the ONE legal combo
//       formatTime(tallinnHHMM(new Date(iso)), $timeFormatStore)
//       (timeFormat.no-hardcoded-render.spec.ts allowlist fence).
//     • visibility follows the Works precedent (showWorksSection,
//       +page.svelte:1086): rows.length > 0 || isEditor. Member + zero items
//       → NO section; editor + zero items → section with the add affordance.
//     • members get ZERO edit affordances; parent-event editors (the page's
//       existing isEditor derivation — manageRightsFrom over
//       detail.ownerIds/editorIds) get add/edit/remove:
//         event-schedule-add            → opens the in-place add form:
//           event-schedule-add-name     — native <input type="text">, named by
//                                         a visible <label for> (#239/#249
//                                         single-name rule: NO redundant
//                                         same-key aria-label on the input)
//           event-schedule-add-datetime — the rule-5 composite: -date native
//                                         input + TimeSelect -hour/-minute
//                                         (the app's ONE time-entry composite)
//           event-schedule-add-submit   — POSTs the create
//         event-schedule-edit-{id}      → pencil pattern: a TAB-reachable
//                                         whole-field activator <button>
//                                         (standing rule 4/4b); opens
//           event-schedule-edit-name-{id} (seeded) +
//           event-schedule-edit-datetime-{id} (seeded Tallinn wall clock)
//         event-schedule-remove-{id}    → #238 shape: TrashIcon.svelte inside
//                                         the trigger (aria-hidden svg,
//                                         accessible name on the BUTTON, red
//                                         tint, NOT the older × glyph), armed
//                                         into -confirm-{id} / -cancel-{id}
//   Wire (the real producer, driven end-to-end):
//     fetch  = entity?_type.string=schedule_item&_parent.reference=<eventId>
//              &props=name,datetime&limit=500      (never a raw type id)
//     create = POST entity, five props incl. the MANDATORY explicit
//              `_sharing: domain`; datetime = UTC ISO via tallinnLocalToUtcIso
//     edit   = replaceEntityProperty choreography (GET → POST-new → DELETE-old)
//     remove = DELETE entity/{itemId}
//     NO ordinal reads or writes anywhere.
//   The schedule fetch attaches inside loadForSelected's flow under the page's
//   hand-rolled generation guard (+page.svelte:141/287/304) — pinned by a
//   deterministically ordered race spec below.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2026-09-01) — same hygiene as
// page.spec.ts: only Date is faked, timers stay real for waitFor.
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
import { HOURS_24, MINUTES_5, optionValues, fillDateTime, commitDateTime, readDateTime } from '$lib/testing/timeControls';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures ─────────────────────────────────────────────────────────────
// Event 2026-09-01T16:00Z = 19:00 Europe/Tallinn (EEST, UTC+3); +90 → 20:30.

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
		...over
	};
}

/** The rights-holder's view: the viewer IS in the event's `_editor` list. */
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
		duration_minutes: [{ number: 120 }]
	};
}

const PROFILES: Record<string, unknown[]> = {
	'p-mihkel': [
		{ _id: 'prof-m', name: [{ string: 'Mihkel Putrinš' }], _sharing: [{ string: 'domain' }] }
	]
};

function scheduleEntity(id: string, name: string, iso: string) {
	return {
		_id: id,
		name: [{ _id: `val-${id}-name`, string: name }],
		datetime: [{ _id: `val-${id}-dt`, datetime: iso }]
	};
}

/** The concert-day commission itself: kogunemine / proov / kontsert — and the
 *  'kontsert' item deliberately SHARES the event's own 19:00 start, the exact
 *  shape that would break page.spec.ts's exact-count pins if the schedule
 *  rendered inside event-detail-time. */
function defaultScheduleEntities() {
	return [
		scheduleEntity('si2', 'proov', '2026-09-01T15:00:00.000Z'), // 18:00 Tallinn
		scheduleEntity('si1', 'kogunemine', '2026-09-01T14:30:00.000Z'), // 17:30 Tallinn
		scheduleEntity('si3', 'kontsert', '2026-09-01T16:00:00.000Z') // 19:00 Tallinn
	];
}

type WireOpts = {
	event?: Record<string, unknown>;
	schedule?: Array<Record<string, unknown>>;
	/** Hold the FIRST schedule list GET open until release(entities) — the
	 *  deterministic race probe. Later schedule GETs answer immediately. */
	holdFirstScheduleGet?: boolean;
	/** #262 review F1 — refuse the ITEM-scoped writes (the replace-choreography
	 *  POST and the entity DELETE) with a 500, leaving the create POST alone.
	 *  This is the shape that used to roll the row back in silence. */
	failItemWrites?: boolean;
};

/**
 * The liberal read stub of the page.spec family, plus the schedule wire:
 * list GET, type-def resolution, create POST, replace choreography, entity
 * DELETE. Everything is recorded on the returned vi.fn for wire assertions.
 */
function scheduleWireStub(opts: WireOpts = {}) {
	const event = opts.event ?? eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	let schedule: Array<Record<string, unknown>> = opts.schedule ?? defaultScheduleEntities();
	let scheduleGets = 0;
	let releaseStale: (entities: Array<Record<string, unknown>>) => void = () => {};
	const staleGate = new Promise<Array<Record<string, unknown>>>((r) => {
		releaseStale = r;
	});
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (method === 'DELETE' && url.includes('/entity/')) {
			if (opts.failItemWrites) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			schedule = schedule.filter((s) => s._id !== id);
			return json({ deleted: true });
		}
		if (url.includes('name.string=schedule_item')) {
			return json({ entities: [{ _id: 'type-schedule-item' }] });
		}
		if (url.includes('_type.string=schedule_item')) {
			scheduleGets += 1;
			if (opts.holdFirstScheduleGet && scheduleGets === 1) {
				const entities = await staleGate;
				return json({ entities });
			}
			return json({ entities: schedule });
		}
		if (method === 'POST' && /\/entity(\?|$)/.test(url)) {
			// A create — apply it so a GREEN that refetches sees the new item.
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			const name = props.find((p) => p.type === 'name');
			const datetime = props.find((p) => p.type === 'datetime');
			schedule = [
				...schedule,
				scheduleEntity('si-new', String(name?.string ?? ''), String(datetime?.datetime ?? ''))
			];
			return json({ _id: 'si-new' });
		}
		if (method === 'POST' && url.includes('/entity/')) {
			if (opts.failItemWrites) return json({ error: 'nope' }, 500);
			// A replace-choreography POST against one item — apply wholesale.
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			const props = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
			schedule = schedule.map((s) => {
				if (s._id !== id) return s;
				const next = { ...s };
				for (const prop of props) {
					const { type, ...valueParts } = prop;
					next[String(type)] = [{ _id: `val-${id}-${String(type)}-new`, ...valueParts }];
				}
				return next;
			});
			return json({});
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/si')) {
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			return json({ entity: schedule.find((s) => s._id === id) ?? {} });
		}
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
	return { stub, releaseStale };
}

function setAuthed(dbs: string[] = ['polyphony']) {
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((db) => [db, 'p-viewer'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'p-viewer' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0]);
}

function renderSchedulePage(opts: WireOpts = {}, dbs: string[] = ['polyphony']) {
	const { stub, releaseStale } = scheduleWireStub(opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, releaseStale };
}

async function waitReady(container: HTMLElement) {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="event-detail-name"]')?.textContent).toContain(
			'Tuesday Rehearsal'
		);
	});
}

function scheduleSection(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="event-detail-schedule"]');
}

afterEach(async () => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	const { timeFormatStore } = await import('$lib/preferences/timeFormat');
	timeFormatStore.set('24h');
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 — the section: own container, never inside event-detail-time
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — schedule section on the event detail page (member view)', () => {
	it('renders the schedule in its OWN container, chronological, name + time per row', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		const text = scheduleSection(container)!.textContent ?? '';
		expect(text).toContain('kogunemine');
		expect(text).toContain('proov');
		expect(text).toContain('kontsert');
		// 24h default rendering via the shared formatTime combo — Tallinn wall clock.
		expect(text).toContain('17:30');
		expect(text).toContain('18:00');
		expect(text).toContain('19:00');
		// Chronological: datetime ascending, regardless of wire order.
		expect(text.indexOf('kogunemine')).toBeLessThan(text.indexOf('proov'));
		expect(text.indexOf('proov')).toBeLessThan(text.indexOf('kontsert'));
	});

	it("does NOT render inside event-detail-time — the 'kontsert' item shares the event's 19:00 and the exact-count pins (page.spec.ts:637/:2414) must keep holding", async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		const timeEl = container.querySelector('[data-testid="event-detail-time"]');
		expect(timeEl).not.toBeNull();
		// The schedule is no descendant of the time line…
		expect(timeEl!.contains(scheduleSection(container))).toBe(false);
		// …so the event's own time line still says 19:00 exactly ONCE, even with
		// a 19:00 'kontsert' schedule item on screen.
		expect((timeEl!.textContent ?? '').match(/19:00/g)).toHaveLength(1);
	});

	it('two items sharing a datetime order by NAME (the #246 tie-break — no ordinal exists to consult)', async () => {
		const { container } = renderSchedulePage({
			schedule: [
				scheduleEntity('si-b', 'b-proov', '2026-09-01T15:00:00.000Z'),
				scheduleEntity('si-a', 'a-kogunemine', '2026-09-01T15:00:00.000Z')
			]
		});
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		const text = scheduleSection(container)!.textContent ?? '';
		expect(text.indexOf('a-kogunemine')).toBeLessThan(text.indexOf('b-proov'));
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — time rendering follows the #207/#220 preference (the ONE legal renderer)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — schedule times follow the AM/PM preference', () => {
	it("'ampm': 17:30 renders as '5:30 PM', 19:00 as '7:00 PM' — no 24h leftovers in the section", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		const text = scheduleSection(container)!.textContent ?? '';
		expect(text).toContain('5:30 PM');
		expect(text).toContain('7:00 PM');
		expect(text).not.toContain('17:30');
		expect(text).not.toContain('19:00');
	});

	it("'24h' (the unset default): 24h clock digits, no AM/PM suffix anywhere in the section", async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		const text = scheduleSection(container)!.textContent ?? '';
		expect(text).toContain('17:30');
		expect(text).not.toMatch(/\b(AM|PM)\b/);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — visibility + rights (the Works precedent; members read, editors write)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — visibility and edit affordances', () => {
	it('a member SEES the list and gets ZERO edit affordances', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-schedule-add"]')).toBeNull();
		for (const id of ['si1', 'si2', 'si3']) {
			expect(container.querySelector(`[data-testid="event-schedule-edit-${id}"]`)).toBeNull();
			expect(container.querySelector(`[data-testid="event-schedule-remove-${id}"]`)).toBeNull();
		}
	});

	it('member + zero items → the section is ABSENT (never an empty placeholder)', async () => {
		// Positive control first (RED trips here): with items, the section exists…
		const withItems = renderSchedulePage();
		await waitReady(withItems.container);
		await waitFor(() => {
			expect(scheduleSection(withItems.container)).not.toBeNull();
		});
		cleanup();
		vi.unstubAllGlobals();
		// …with zero items and no rights, it is gone entirely.
		const { container } = renderSchedulePage({ schedule: [] });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-detail-rsvp"]')).not.toBeNull();
		});
		expect(scheduleSection(container)).toBeNull();
	});

	it('editor + zero items → the section renders WITH the add affordance (the showWorksSection rule)', async () => {
		const { container } = renderSchedulePage({ event: editorEvent(), schedule: [] });
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="event-schedule-add"]')).not.toBeNull();
	});

	it('an event editor gets add, edit and remove affordances on each row', async () => {
		const { container } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-add"]')).not.toBeNull();
		});
		for (const id of ['si1', 'si2', 'si3']) {
			expect(container.querySelector(`[data-testid="event-schedule-edit-${id}"]`)).not.toBeNull();
			expect(
				container.querySelector(`[data-testid="event-schedule-remove-${id}"]`)
			).not.toBeNull();
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — the wire read (real producer, pinned URL shape)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — schedule read wire', () => {
	it('fetches by TYPE NAME + parent ref + name,datetime props + limit 500 — never a raw type id, never ordinal', async () => {
		const { container, fetchStub } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		const scheduleUrls = fetchStub.mock.calls
			.map((c) => String(c[0]))
			.filter((u) => u.includes('_type.string=schedule_item'));
		expect(scheduleUrls.length).toBeGreaterThan(0);
		for (const url of scheduleUrls) {
			expect(url).toContain(
				'_type.string=schedule_item&_parent.reference=ev1&props=name,datetime&limit=500'
			);
			expect(url).not.toContain('_type.reference');
			expect(url).not.toMatch(/6a9cce/);
			expect(url).not.toContain('ordinal');
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — editor CRUD: add (in-place form, visible labels, TimeSelect, full wire)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — add flow (in-situ family, #239/#249 single-name rule)', () => {
	async function openAddForm(container: HTMLElement) {
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-add"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-add"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-add-name"]')).not.toBeNull();
		});
	}

	it('name entry is a native text input named by a VISIBLE <label for> — no redundant same-key aria-label', async () => {
		const { container } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await openAddForm(container);
		const input = container.querySelector(
			'[data-testid="event-schedule-add-name"]'
		) as HTMLInputElement;
		expect(input.tagName).toBe('INPUT');
		expect(input.getAttribute('type')).toBe('text');
		// #239/#249 — ONE name source: the visible label, associated via for/id.
		expect(input.id).not.toBe('');
		const label = [...container.querySelectorAll('label')].find(
			(l) => l.getAttribute('for') === input.id
		);
		expect(label, 'a visible <label for> must name the name input').not.toBeUndefined();
		expect(label!.textContent).toContain('[event_schedule_name_label]');
		expect(input.getAttribute('aria-label')).toBeNull();
	});

	it('time entry is the TimeSelect composite (native selects, 24h hours, 5-minute steps by construction) plus a native date input, under a visible datetime label', async () => {
		const { container } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await openAddForm(container);
		const date = container.querySelector('[data-testid="event-schedule-add-datetime-date"]');
		expect(date).not.toBeNull();
		expect(date!.tagName).toBe('INPUT');
		expect(date!.getAttribute('type')).toBe('date');
		const hour = container.querySelector('[data-testid="event-schedule-add-datetime-hour"]');
		const minute = container.querySelector('[data-testid="event-schedule-add-datetime-minute"]');
		expect(hour).not.toBeNull();
		expect(minute).not.toBeNull();
		expect(hour!.tagName).toBe('SELECT');
		expect(minute!.tagName).toBe('SELECT');
		expect(optionValues(hour)).toEqual(expect.arrayContaining(HOURS_24));
		expect(optionValues(minute)).toEqual(expect.arrayContaining(MINUTES_5));
		expect(container.textContent).toContain('[event_schedule_datetime_label]');
	});

	// #262 review F2 — the visible label and the group's accessible name were the
	// SAME key emitted twice ("Date & time" from the group, then "Date & time"
	// again from the span beside it). The house single-name rule (#205 F1 / #249):
	// ONE name source per control group.
	it('the datetime group is named ONCE — by the visible label via aria-labelledby, never a same-key aria-label beside it', async () => {
		const { container } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await openAddForm(container);
		const group = container.querySelector('[data-testid="event-schedule-add-datetime"]')!;
		expect(group.getAttribute('role')).toBe('group');
		expect(
			group.getAttribute('aria-label'),
			'a visible same-key label already names this group'
		).toBeNull();
		const labelledby = group.getAttribute('aria-labelledby');
		expect(labelledby).not.toBeNull();
		const labelNode = container.querySelector(`#${CSS.escape(labelledby!)}`);
		expect(labelNode, 'aria-labelledby must point at the VISIBLE label').not.toBeNull();
		expect(labelNode!.textContent).toContain('[event_schedule_datetime_label]');
		expect(labelNode!.className).not.toContain('sr-only');
	});

	it('submit POSTs the FULL create payload — resolved type id, parent ref, name, UTC-converted datetime, and the MANDATORY explicit _sharing: domain', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent(), schedule: [] });
		await waitReady(container);
		await openAddForm(container);
		await fireEvent.input(container.querySelector('[data-testid="event-schedule-add-name"]')!, {
			target: { value: 'kogunemine' }
		});
		// Tallinn wall clock 2026-09-01 17:30 (EEST, +3) → 14:30Z on the wire.
		await fillDateTime(container as HTMLElement, 'event-schedule-add-datetime', '2026-09-01', '17:30');
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-add-submit"]')!);

		await waitFor(() => {
			const creates = fetchStub.mock.calls.filter(
				(c) =>
					(c[1] as RequestInit | undefined)?.method === 'POST' &&
					/\/entity(\?|$)/.test(String(c[0]))
			);
			expect(creates).toHaveLength(1);
			const props = JSON.parse(String((creates[0][1] as RequestInit).body)) as Array<
				Record<string, unknown>
			>;
			// Full shape — sorted by prop name so the pin is order-independent
			// at the page seam (the data layer's own spec pins exact order).
			const sorted = [...props].sort((a, b) => String(a.type).localeCompare(String(b.type)));
			expect(sorted).toEqual(
				[
					{ type: '_parent', reference: 'ev1' },
					{ type: '_sharing', string: 'domain' },
					{ type: '_type', reference: 'type-schedule-item' },
					{ type: 'datetime', datetime: '2026-09-01T14:30:00.000Z' },
					{ type: 'name', string: 'kogunemine' }
				].sort((a, b) => a.type.localeCompare(b.type))
			);
			// NEGATIVE twin, stated on its own: a payload without _sharing fails.
			expect(props).toContainEqual({ type: '_sharing', string: 'domain' });
			expect(props.map((p) => p.type)).not.toContain('ordinal');
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — editor CRUD: edit (pencil pattern + replaceEntityProperty choreography)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — edit flow (whole-field activator, replace choreography)', () => {
	it('the activator is a TAB-reachable <button> named for the item (standing rule 4/4b)', async () => {
		const { container } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-edit-si1"]')).not.toBeNull();
		});
		const activator = container.querySelector(
			'[data-testid="event-schedule-edit-si1"]'
		) as HTMLButtonElement;
		expect(activator.tagName).toBe('BUTTON');
		expect(activator.getAttribute('tabindex')).not.toBe('-1');
		expect(activator.getAttribute('aria-hidden')).toBeNull();
		// #262 review F3 — the label rides as an sr-only CHILD, the #157 idiom
		// (`event-edit-btn-start_datetime`). `aria-label` would OVERRIDE the
		// button's own descendants and silence the row's TIME, the one datum the
		// schedule exists to convey.
		expect(
			activator.getAttribute('aria-label'),
			'aria-label would silence the name and time this button wraps'
		).toBeNull();
		const srLabel = activator.querySelector('.sr-only');
		expect(srLabel, 'the edit label must ride as an sr-only child').not.toBeNull();
		expect(srLabel!.textContent).toContain('[event_schedule_edit_aria_label]');
		// The computed name is name-from-contents: label + the VISIBLE name AND
		// time still spoken.
		const spoken = activator.textContent ?? '';
		expect(spoken).toContain('[event_schedule_edit_aria_label]');
		expect(spoken).toContain('kogunemine');
		expect(spoken, 'the row time must survive into the accessible name').toContain('17:30');
	});

	it('activating opens name + datetime seeded with the CURRENT values (datetime as the Tallinn wall clock the row displays)', async () => {
		const { container } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-edit-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-edit-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-edit-name-si1"]')
			).not.toBeNull();
		});
		const nameInput = container.querySelector(
			'[data-testid="event-schedule-edit-name-si1"]'
		) as HTMLInputElement;
		expect(nameInput.value).toBe('kogunemine');
		// 14:30Z = 17:30 Tallinn — the user edits the time she sees.
		expect(readDateTime(container as HTMLElement, 'event-schedule-edit-datetime-si1')).toBe(
			'2026-09-01T17:30'
		);
	});

	it('committing a name change runs the replace choreography: GET existing ids FIRST, POST exactly one value, THEN delete the old id', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-edit-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-edit-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-edit-name-si1"]')
			).not.toBeNull();
		});
		const nameInput = container.querySelector('[data-testid="event-schedule-edit-name-si1"]')!;
		await fireEvent.input(nameInput, { target: { value: 'kutse' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => {
			const calls = fetchStub.mock.calls
				.map((c, i) => ({
					i,
					url: String(c[0]),
					method: (c[1] as RequestInit | undefined)?.method ?? 'GET',
					body: (c[1] as RequestInit | undefined)?.body
				}))
				.filter((c) => c.url.includes('/entity/si1') || c.url.includes('/property/val-si1-name'));
			const lookup = calls.find((c) => c.method === 'GET' && c.url.includes('props=name'));
			const post = calls.find((c) => c.method === 'POST');
			const del = calls.find((c) => c.method === 'DELETE');
			expect(lookup, 'the pre-write value-id lookup must run').not.toBeUndefined();
			expect(post, 'the new value must be POSTed').not.toBeUndefined();
			expect(del, 'the old value id must be DELETEd').not.toBeUndefined();
			expect(JSON.parse(String(post!.body))).toEqual([{ type: 'name', string: 'kutse' }]);
			expect(del!.url).toContain('/property/val-si1-name');
			// ORDER: GET before POST before DELETE (POST-before-DELETE house rule).
			expect(lookup!.i).toBeLessThan(post!.i);
			expect(post!.i).toBeLessThan(del!.i);
		});
	});

	it('committing a datetime change writes the datetime slot with the UTC instant of the edited Tallinn wall clock', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-edit-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-edit-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-edit-datetime-si1-hour"]')
			).not.toBeNull();
		});
		// 17:30 → 18:00 Tallinn (still 2026-09-01, EEST +3) = 15:00Z.
		await fillDateTime(
			container as HTMLElement,
			'event-schedule-edit-datetime-si1',
			'2026-09-01',
			'18:00'
		);
		await commitDateTime(container as HTMLElement, 'event-schedule-edit-datetime-si1');

		await waitFor(() => {
			const post = fetchStub.mock.calls.find(
				(c) =>
					(c[1] as RequestInit | undefined)?.method === 'POST' &&
					String(c[0]).includes('/entity/si1')
			);
			expect(post).not.toBeUndefined();
			expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual([
				{ type: 'datetime', datetime: '2026-09-01T15:00:00.000Z' }
			]);
		});
	});

	// ── #262 T3 F1: the activator opens a TWO-field editor ────────────────────
	// One half committing must never unmount the other half under the pointer.
	// The bug: `commitScheduleName` used `scheduleEditingId = null` as its "done"
	// signal, so "fix the name AND the time" lost the time — the composite
	// vanished as the click travelled and the datetime edit was silently dropped.
	it('committing the name while focus travels to the datetime half leaves that half mounted and writable', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-edit-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-edit-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-edit-name-si1"]')
			).not.toBeNull();
		});
		const nameInput = container.querySelector('[data-testid="event-schedule-edit-name-si1"]')!;
		const dateInput = container.querySelector(
			'[data-testid="event-schedule-edit-datetime-si1-date"]'
		)!;
		await fireEvent.input(nameInput, { target: { value: 'kutse' } });
		// She clicks straight onto the date box: blur's relatedTarget is the
		// element about to take focus — still inside THIS row's editor.
		await fireEvent.blur(nameInput, { relatedTarget: dateInput });

		expect(
			container.querySelector('[data-testid="event-schedule-edit-datetime-si1"]'),
			'the datetime half must survive the name commit'
		).not.toBeNull();

		// …and the time edit that follows actually reaches the wire.
		await fillDateTime(
			container as HTMLElement,
			'event-schedule-edit-datetime-si1',
			'2026-09-01',
			'18:00'
		);
		await commitDateTime(container as HTMLElement, 'event-schedule-edit-datetime-si1');
		await waitFor(() => {
			const bodies = fetchStub.mock.calls
				.filter(
					(c) =>
						(c[1] as RequestInit | undefined)?.method === 'POST' &&
						String(c[0]).includes('/entity/si1')
				)
				.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
			expect(bodies, 'the name commit still wrote').toContainEqual([
				{ type: 'name', string: 'kutse' }
			]);
			expect(bodies, 'the datetime the editor reached for must write too').toContainEqual([
				{ type: 'datetime', datetime: '2026-09-01T15:00:00.000Z' }
			]);
		});
	});

	it('the mirror: committing the datetime while focus travels back to the name box leaves the name box mounted', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-edit-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-edit-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-edit-datetime-si1-hour"]')
			).not.toBeNull();
		});
		await fillDateTime(
			container as HTMLElement,
			'event-schedule-edit-datetime-si1',
			'2026-09-01',
			'18:00'
		);
		const nameInput = container.querySelector('[data-testid="event-schedule-edit-name-si1"]')!;
		await fireEvent.focusOut(
			container.querySelector('[data-testid="event-schedule-edit-datetime-si1"]')!,
			{ relatedTarget: nameInput }
		);

		expect(
			container.querySelector('[data-testid="event-schedule-edit-name-si1"]'),
			'the name half must survive the datetime commit'
		).not.toBeNull();
		await waitFor(() => {
			const post = fetchStub.mock.calls.find(
				(c) =>
					(c[1] as RequestInit | undefined)?.method === 'POST' &&
					String(c[0]).includes('/entity/si1')
			);
			expect(post).not.toBeUndefined();
			expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual([
				{ type: 'datetime', datetime: '2026-09-01T15:00:00.000Z' }
			]);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 — editor CRUD: remove (two-step arm → confirm/cancel, #238 red trashcan)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — remove flow (two-step confirm, TrashIcon trigger)', () => {
	it('the trigger carries the #238 shape: aria-hidden TrashIcon svg INSIDE the button, accessible name ON the button, red tint — never the × glyph', async () => {
		const { container } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-remove-si1"]')).not.toBeNull();
		});
		const btn = container.querySelector(
			'[data-testid="event-schedule-remove-si1"]'
		) as HTMLButtonElement;
		expect(btn.tagName).toBe('BUTTON');
		const svg = btn.querySelector('svg[data-icon="trash"]');
		expect(svg, 'TrashIcon.svelte must render inside the trigger').not.toBeNull();
		expect(svg!.getAttribute('aria-hidden')).toBe('true');
		const ariaLabel = btn.getAttribute('aria-label') ?? '';
		expect(ariaLabel).toContain('[event_schedule_remove_aria_label');
		expect(ariaLabel).toContain('kogunemine');
		expect(btn.className).toMatch(/text-red-700/);
		expect(btn.textContent).not.toContain('×');
	});

	it('arming writes NOTHING; cancel disarms with still nothing written', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-remove-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-remove-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-remove-confirm-si1"]')
			).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="event-schedule-remove-cancel-si1"]')
		).not.toBeNull();
		const deletes = () =>
			fetchStub.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE');
		expect(deletes()).toHaveLength(0);
		await fireEvent.click(
			container.querySelector('[data-testid="event-schedule-remove-cancel-si1"]')!
		);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-remove-confirm-si1"]')
			).toBeNull();
		});
		expect(deletes()).toHaveLength(0);
		// The row survived its own near-death.
		expect(scheduleSection(container)!.textContent).toContain('kogunemine');
	});

	it('confirm DELETEs entity/{itemId} — the ENTITY endpoint, never /property/', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-remove-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-remove-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-remove-confirm-si1"]')
			).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="event-schedule-remove-confirm-si1"]')!
		);
		await waitFor(() => {
			const deletes = fetchStub.mock.calls.filter(
				(c) => (c[1] as RequestInit | undefined)?.method === 'DELETE'
			);
			expect(deletes).toHaveLength(1);
			expect(String(deletes[0][0])).toContain('/entity/si1');
			expect(String(deletes[0][0])).not.toContain('/property/');
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 7b — #262 review F1: a failed row write must SAY so
//
// The write queue's `rollback` hook fires first, so the optimistic patch is
// already undone by the time `revert` runs: without a rendered error the row
// simply snaps back to its old value and the editor watches her own edit
// un-do itself in silence. 'Fail loudly over fallbacks' — the standing rule.
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — a failed schedule write surfaces a row-local alert', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	async function openRowEditor(container: HTMLElement, id: string) {
		await waitFor(() => {
			expect(container.querySelector(`[data-testid="event-schedule-edit-${id}"]`)).not.toBeNull();
		});
		await fireEvent.click(container.querySelector(`[data-testid="event-schedule-edit-${id}"]`)!);
		await waitFor(() => {
			expect(
				container.querySelector(`[data-testid="event-schedule-edit-name-${id}"]`)
			).not.toBeNull();
		});
	}

	it('a REJECTED name edit rolls the row back AND renders a visible role="alert"', async () => {
		const { container } = renderSchedulePage({ event: editorEvent(), failItemWrites: true });
		await waitReady(container);
		await openRowEditor(container as HTMLElement, 'si1');
		const nameInput = container.querySelector('[data-testid="event-schedule-edit-name-si1"]')!;
		await fireEvent.input(nameInput, { target: { value: 'kutse' } });
		await fireEvent.blur(nameInput);

		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-schedule-error-si1"]');
			expect(el, 'a failed name edit must not roll back in silence').not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[event_schedule_save_error]');
		// The rollback still happened — the row shows its ORIGINAL name.
		expect(scheduleSection(container)!.textContent).toContain('kogunemine');
		expect(scheduleSection(container)!.textContent).not.toContain('kutse');
	});

	it('a REJECTED datetime edit renders the same row-local alert', async () => {
		const { container } = renderSchedulePage({ event: editorEvent(), failItemWrites: true });
		await waitReady(container);
		await openRowEditor(container as HTMLElement, 'si1');
		await fillDateTime(
			container as HTMLElement,
			'event-schedule-edit-datetime-si1',
			'2026-09-01',
			'18:00'
		);
		await commitDateTime(container as HTMLElement, 'event-schedule-edit-datetime-si1');

		await waitFor(() => {
			const el = container.querySelector('[data-testid="event-schedule-error-si1"]');
			expect(el, 'a failed datetime edit must not roll back in silence').not.toBeNull();
			expect(el!.getAttribute('role')).toBe('alert');
			expect(el!.textContent).toContain('[event_schedule_save_error]');
		});
		// Rolled back to 17:30 — and the reason is on screen next to it.
		expect(scheduleSection(container)!.textContent).toContain('17:30');
	});

	it('a REJECTED removal restores the row AND renders the row-local alert', async () => {
		const { container } = renderSchedulePage({ event: editorEvent(), failItemWrites: true });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-remove-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-remove-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-remove-confirm-si1"]')
			).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="event-schedule-remove-confirm-si1"]')!
		);

		await waitFor(() => {
			const el = container.querySelector('[data-testid="event-schedule-error-si1"]');
			expect(el, 'a failed removal must not reappear in silence').not.toBeNull();
			expect(el!.getAttribute('role')).toBe('alert');
			expect(el!.textContent).toContain('[event_schedule_save_error]');
		});
		expect(scheduleSection(container)!.textContent).toContain('kogunemine');
	});

	it('re-opening the row clears the stale alert — an error that outlives the retry it provoked is a lie', async () => {
		const { container } = renderSchedulePage({ event: editorEvent(), failItemWrites: true });
		await waitReady(container);
		await openRowEditor(container as HTMLElement, 'si1');
		const nameInput = container.querySelector('[data-testid="event-schedule-edit-name-si1"]')!;
		await fireEvent.input(nameInput, { target: { value: 'kutse' } });
		await fireEvent.blur(nameInput);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-error-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-edit-si1"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-error-si1"]')).toBeNull();
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 7c — #262 review F4: an incomplete add is a NAMED refusal, never a no-op
//
// #132/T4 review F1's discipline: validation BEFORE any fetch, and each
// refusal names its own box. A bare `return` left the editor clicking "Add"
// with nothing happening and nothing said.
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — incomplete add refuses out loud (validation before any fetch)', () => {
	async function openAdd(container: HTMLElement) {
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-add"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-add"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-add-name"]')).not.toBeNull();
		});
	}
	const creates = (stub: { mock: { calls: unknown[][] } }) =>
		stub.mock.calls.filter(
			(c) =>
				(c[1] as RequestInit | undefined)?.method === 'POST' &&
				/\/entity(\?|$)/.test(String(c[0]))
		);

	it('name filled, time blank → ZERO creates and a visible alert naming the datetime box', async () => {
		const { container, fetchStub } = renderSchedulePage({
			event: editorEvent(),
			schedule: []
		});
		await waitReady(container);
		await openAdd(container as HTMLElement);
		await fireEvent.input(container.querySelector('[data-testid="event-schedule-add-name"]')!, {
			target: { value: 'kogunemine' }
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-add-submit"]')!);

		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-schedule-add-error"]');
			expect(el, 'a refused add must say which box is empty').not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[event_schedule_datetime_required]');
		expect(creates(fetchStub)).toHaveLength(0);
		// The refusal is wired to the box it blames.
		const group = container.querySelector('[data-testid="event-schedule-add-datetime"]')!;
		expect(group.getAttribute('aria-describedby')).toBe(alert.id);
		// `aria-invalid` is not supported on role="group" — it rides the native
		// control inside it.
		expect(
			container
				.querySelector('[data-testid="event-schedule-add-datetime-date"]')!
				.getAttribute('aria-invalid')
		).toBe('true');
		// …and the form stays open on the value already typed.
		expect(
			(container.querySelector('[data-testid="event-schedule-add-name"]') as HTMLInputElement)
				.value
		).toBe('kogunemine');
	});

	it('time filled, name blank → ZERO creates and a visible alert naming the name box', async () => {
		const { container, fetchStub } = renderSchedulePage({
			event: editorEvent(),
			schedule: []
		});
		await waitReady(container);
		await openAdd(container as HTMLElement);
		await fillDateTime(container as HTMLElement, 'event-schedule-add-datetime', '2026-09-01', '17:30');
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-add-submit"]')!);

		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-schedule-add-error"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.textContent).toContain('[event_schedule_name_required]');
		expect(creates(fetchStub)).toHaveLength(0);
		const nameInput = container.querySelector(
			'[data-testid="event-schedule-add-name"]'
		) as HTMLInputElement;
		expect(nameInput.getAttribute('aria-describedby')).toBe(alert.id);
		expect(nameInput.getAttribute('aria-invalid')).toBe('true');
	});

	it('typing in the blamed box clears the refusal (T2 F6: an error must not outlive its fix)', async () => {
		const { container } = renderSchedulePage({ event: editorEvent(), schedule: [] });
		await waitReady(container);
		await openAdd(container as HTMLElement);
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-add-submit"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-add-error"]')).not.toBeNull();
		});
		await fireEvent.input(container.querySelector('[data-testid="event-schedule-add-name"]')!, {
			target: { value: 'k' }
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-add-error"]')).toBeNull();
		});
	});

	it('emptying a row name refuses out loud too — no silent no-op on the edit commit', async () => {
		const { container, fetchStub } = renderSchedulePage({ event: editorEvent() });
		await waitReady(container);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="event-schedule-edit-si1"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="event-schedule-edit-si1"]')!);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="event-schedule-edit-name-si1"]')
			).not.toBeNull();
		});
		const nameInput = container.querySelector('[data-testid="event-schedule-edit-name-si1"]')!;
		await fireEvent.input(nameInput, { target: { value: '   ' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => {
			const el = container.querySelector('[data-testid="event-schedule-error-si1"]');
			expect(el, 'an emptied name must be refused, not swallowed').not.toBeNull();
			expect(el!.textContent).toContain('[event_schedule_name_required]');
		});
		// Nothing was written, and the editor is still open on the box to fix.
		expect(
			fetchStub.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
		).toHaveLength(0);
		expect(
			container.querySelector('[data-testid="event-schedule-edit-name-si1"]')
		).not.toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 8 — stale-response race (the house method: deterministic ordering, real guard)
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — stale schedule response never lands (generation guard)', () => {
	it('a schedule read started under collective A, settling AFTER a switch to collective B, must not reach the schedule state', async () => {
		const { container, releaseStale, fetchStub } = renderSchedulePage(
			{ holdFirstScheduleGet: true },
			['polyphony', 'crede']
		);
		await waitReady(container);
		// The stale read is in flight (held by the test) — deterministic setup.
		await waitFor(() => {
			expect(
				fetchStub.mock.calls.some((c) => String(c[0]).includes('_type.string=schedule_item'))
			).toBe(true);
		});

		// Switch collectives — the page reloads everything for crede; crede's
		// schedule GET answers immediately with the fresh fixture set.
		selectedCollectiveDbStore.set('crede');
		await waitFor(() => {
			expect(scheduleSection(container)?.textContent).toContain('kogunemine');
		});

		// NOW settle the stale response with a poison item. If the schedule
		// assignment is not under the load's generation guard, this overwrites
		// the fresh state and the real assertions below trip — never a timeout.
		releaseStale([scheduleEntity('si-stale', 'stale-item', '2026-09-01T10:00:00.000Z')]);
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.textContent).not.toContain('stale-item');
		expect(scheduleSection(container)!.textContent).toContain('kogunemine');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 9 — page invariants + i18n keys
// ═════════════════════════════════════════════════════════════════════════════

describe('#262 — page invariants with the schedule on screen', () => {
	it('still exactly one <main> and one <h1>; the schedule heading is a LOWER heading carrying event_schedule_heading', async () => {
		const { container } = renderSchedulePage();
		await waitReady(container);
		await waitFor(() => {
			expect(scheduleSection(container)).not.toBeNull();
		});
		expect(container.querySelectorAll('main')).toHaveLength(1);
		expect(container.querySelectorAll('h1')).toHaveLength(1);
		const section = scheduleSection(container)!;
		expect(section.querySelector('h1')).toBeNull();
		const heading = section.querySelector('h2, h3, h4');
		expect(heading, 'the section must carry its own sub-heading').not.toBeNull();
		expect(heading!.textContent).toContain('[event_schedule_heading]');
	});
});

describe('#262 — i18n keys exist in all four locales (en/et/lv/uk), none empty', () => {
	// The proposed key set, following the event_detail_delete_* /
	// event_create_* conventions. Comenius authors the actual copy in GREEN;
	// this guard pins presence + non-emptiness, the house idiom
	// (page.spec.ts's event_type guard).
	const KEYS = [
		'event_schedule_heading',
		'event_schedule_add_label',
		'event_schedule_name_label',
		'event_schedule_datetime_label',
		'event_schedule_add_submit',
		'event_schedule_add_cancel',
		'event_schedule_edit_aria_label',
		'event_schedule_remove_aria_label',
		'event_schedule_remove_confirm_aria_label',
		'event_schedule_remove_confirm_short',
		'event_schedule_remove_cancel_aria_label',
		'event_schedule_remove_cancel_short',
		'event_schedule_save_error',
		// #262 review F4 — the two field-naming refusals the add form speaks
		// BEFORE any fetch (the `event_create_*_required` family's shape).
		'event_schedule_name_required',
		'event_schedule_datetime_required'
	];

	for (const locale of ['en', 'et', 'lv', 'uk']) {
		it(`${locale}.json carries every event_schedule_* key, non-empty`, () => {
			const messages = JSON.parse(
				readFileSync(resolve(`messages/${locale}.json`), 'utf8')
			) as MessageFile;
			expect(
				KEYS.filter((k) => !(k in messages)),
				`${locale}.json is missing event_schedule keys`
			).toEqual([]);
			expect(
				KEYS.filter((k) => isMessageEmpty(messages[k])),
				`${locale}.json has empty event_schedule keys`
			).toEqual([]);
		});
	}
});

// (*MVOX:Tallis* — #262 RED: event-detail schedule section + editor CRUD)
