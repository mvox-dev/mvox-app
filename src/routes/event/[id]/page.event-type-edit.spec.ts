// @vitest-environment happy-dom
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

beforeEach(editorTokenAtNow);

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { updateEventField, type EditableEventField } from '$lib/events/eventFieldEdit';
import { CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
import { gotoMock } from '$lib/testing/routeMocks';
import {
	PROFILES,
	cfg,
	cleanupRealTimersReset,
	editorTokenAtNow,
	postedProps,
	seasonEntity,
	setAuthedWithSampledb
} from '$lib/testing/pages/event';

const FIELD: EditableEventField = 'event_type';

function eventEntity(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		event_name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
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

function seriesEntity() {
	return {
		_id: 'series1',
		name: [{ string: 'Tuesday Series' }],
		event_type: [{ _id: 'val-series-type-1', string: 'rehearsal' }],
		duration_minutes: [{ number: 120 }],
		default_location: [{ string: 'Church Hall' }],
		default_description: [{ string: 'Series default note.' }]
	};
}

type EditWireOpts = {
	failEditPosts?: number;
};

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

function renderEditPage(eventOver?: Record<string, unknown>, opts: EditWireOpts = {}) {
	const { stub } = editWireStub(eventOver, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub };
}

afterEach(cleanupRealTimersReset);

function allPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls.filter(
		(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
	);
}

function editPosts(fetchStub: ReturnType<typeof vi.fn>) {
	return allPosts(fetchStub).filter((c) => String(c[0]).includes('/entity/ev1'));
}

function deletedPropertyUrls(fetchStub: ReturnType<typeof vi.fn>) {
	return fetchStub.mock.calls
		.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'DELETE')
		.map((c) => String(c[0]));
}

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

describe('/event/[id] — the type badge gains the #205 whole-field activator, rights-gated', () => {
	it('an _editor gets event-edit-btn-event_type: a real Tab-reachable <button> wrapping the colored badge, sr-only label, aria-hidden glyph', async () => {
		const { container } = renderEditPage(editorEvent());
		const btn = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-btn-event_type"]');
			expect(el, 'event-edit-btn-event_type missing for an _editor').not.toBeNull();
			return el as HTMLButtonElement;
		});
		expect(btn.tagName).toBe('BUTTON');
		expect(btn.getAttribute('tabindex')).not.toBe('-1');
		expect(btn.getAttribute('aria-label')).toBeNull();
		expect(btn.querySelector('.sr-only')?.textContent).toContain(
			'event_edit_event_type_aria_label'
		);
		const glyph = [...btn.querySelectorAll('span')].find((el) =>
			(el.textContent ?? '').includes('✎')
		);
		expect(glyph, 'pencil glyph span missing').not.toBeUndefined();
		expect(glyph!.getAttribute('aria-hidden')).toBe('true');
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

describe('/event/[id] — tapping the badge opens the #199 canonical native <select>', () => {
	it('a native SELECT, self-labelled, seeded with the current type, listing EXACTLY the canonical types in canonical order via eventTypeLabel', async () => {
		const { container } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		expect(select.tagName).toBe('SELECT');
		expect(container.querySelector('[data-testid="event-edit-btn-event_type"]')).toBeNull();
		expect(select.getAttribute('aria-label')).toContain('event_edit_event_type_aria_label');
		expect(select.value).toBe('rehearsal');
		const options = [...select.querySelectorAll('option')];
		expect(options.map((o) => o.value).filter((v) => v !== '')).toEqual([
			...CANONICAL_EVENT_TYPES
		]);
		for (const type of CANONICAL_EVENT_TYPES) {
			const opt = options.find((o) => o.value === type)!;
			expect(opt.textContent).toContain(`[event_type_${type}]`);
		}
	});

	it('#266 — the editor select offers trip and service, hand-typed ten-list, pinned order, localized labels', async () => {
		const { container } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		const options = [...select.querySelectorAll('option')];
		expect(options.map((o) => o.value).filter((v) => v !== '')).toEqual([
			'rehearsal',
			'concert',
			'service',
			'festival',
			'retreat',
			'trip',
			'workshop',
			'meeting',
			'social',
			'other'
		]);
		expect(options.find((o) => o.value === 'trip')!.textContent).toContain('[event_type_trip]');
		expect(options.find((o) => o.value === 'service')!.textContent).toContain(
			'[event_type_service]'
		);
	});
});

describe('/event/[id] — Enter and blur save; the badge re-renders in the new color without a reload', () => {
	it('blur after choosing concert: ONE full-shape write to THIS event, and the badge flips to concert label + concert #211 classes', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'concert' } });
		await fireEvent.blur(select);

		await waitFor(() => {
			const posts = editPosts(fetchStub);
			expect(posts.length).toBeGreaterThan(0);
			expect(String(posts[0][0])).toContain('/sampledb/');
			expect(String(posts[0][0])).toContain('/entity/ev1');
			expect(postedProps(posts[0])).toEqual([
				{ _id: 'val-type-1', type: 'event_type', string: 'concert' }
			]);
		});
		const allProps = editPosts(fetchStub).flatMap((c) => postedProps(c));
		expect(allProps).toEqual([{ _id: 'val-type-1', type: 'event_type', string: 'concert' }]);

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

describe('/event/[id] — changing a series child’s type touches that event alone', () => {
	it('every POST targets /entity/ev1 and every DELETE targets the child’s OWN value id — the parent series is never written', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent());
		const select = await beginTypeEdit(container);
		await fireEvent.change(select, { target: { value: 'concert' } });
		await fireEvent.blur(select);
		await waitFor(() => {
			expect(editPosts(fetchStub).length).toBeGreaterThan(0);
		});
		await new Promise((r) => setTimeout(r, 30));

		for (const call of allPosts(fetchStub)) {
			expect(String(call[0]), 'a write escaped to another entity').toContain('/entity/ev1');
		}
		expect(
			allPosts(fetchStub).some((c) => String(c[0]).includes('series1')),
			'the parent series must never be written'
		).toBe(false);
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
		expect(container.querySelector('[data-testid="event-detail-type"]')).toBeNull();
	});

	it('the fresh-open select reads as EMPTY — blurring it untouched writes nothing (no silently preselected rehearsal)', async () => {
		const { container, fetchStub } = renderEditPage(editorEvent({ event_type: [] }));
		const select = await beginTypeEdit(container);
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
