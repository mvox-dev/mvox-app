// @vitest-environment happy-dom
//
// #434 slice 6/6 RED (event-page integration) — inline event editing is
// gated while offline, on the REAL /event/[id] page (harness:
// page.event-editing.spec.ts — the wire stub applies edit POSTs; only global
// fetch is stubbed).
//
// CONTRACT: an event `_editor` sees the six event-edit-btn-* pencils. With the
// signal ($lib/net/online) offline —
//   • every event-edit-btn-* is `disabled`;
//   • ONE visible sentence [data-testid="event-edit-write-unavailable"] =
//     m.write_unavailable_no_signal() is on the page (the header's edit area);
//   • tapping a pencil opens no input and issues no fetch (nothing queued);
//   • an edit OPEN when the signal drops cannot commit: blur writes nothing
//     (no POST reaches the wire);
//   • back online: pencils enabled, sentence gone, an edit commits again.
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
import { authStore } from '$lib/auth/session';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	nonGetCalls
} from '$lib/testing/networkSignal';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

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

function renderEditPage(eventOver?: Record<string, unknown>, opts: EditWireOpts = {}) {
	const { stub, release } = editWireStub(eventOver, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
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


const REASON = '[write_unavailable_no_signal]';

afterEach(() => {
	resetOnLine();
});

function pencils(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll('[data-testid^="event-edit-btn-"]'));
}

async function renderEditable() {
	await goOnline();
	const rendered = renderEditPage(editorEvent());
	await waitFor(() => {
		expect(pencils(rendered.container).length).toBe(6);
		for (const b of pencils(rendered.container)) expect(b.disabled).toBe(false);
	});
	return rendered;
}

describe('/event/[id] — inline editing while offline (#434 slice 6)', () => {
	it('offline: all six pencils are disabled and the reason is visible', async () => {
		const { container } = await renderEditable();
		await goOffline();

		await waitFor(() => {
			for (const b of pencils(container)) expect(b.disabled, b.dataset.testid).toBe(true);
		});
		expectVisibleReason(container, 'event-edit-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="event-edit-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: tapping a pencil opens no input and issues no fetch', async () => {
		const { container, fetchStub } = await renderEditable();
		await goOffline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		await settle();

		expect(container.querySelector('[data-testid="event-edit-input-name"]')).toBeNull();
		expect(fetchStub.mock.calls.length).toBe(callsBefore);
	});

	it('an edit open when the signal drops cannot commit: blur writes nothing', async () => {
		const { container, fetchStub } = await renderEditable();
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-input-name"]');
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await goOffline();

		await fireEvent.blur(input);
		await settle();

		expect(nonGetCalls(fetchStub)).toEqual([]);
		expect(editPosts(fetchStub)).toEqual([]);
	});

	it('back online: pencils enabled, reason gone, and an edit commits', async () => {
		const { container, fetchStub } = await renderEditable();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			for (const b of pencils(container)) expect(b.disabled, b.dataset.testid).toBe(false);
		});
		expect(container.querySelector('[data-testid="event-edit-write-unavailable"]')).toBeNull();
		await fireEvent.click(container.querySelector('[data-testid="event-edit-btn-name"]')!);
		const input = await waitFor(() => {
			const el = container.querySelector('[data-testid="event-edit-input-name"]');
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Autumn Sing' } });
		await fireEvent.blur(input);
		await waitFor(() => expect(editPosts(fetchStub).length).toBe(1));
	});
});

// (*MVOX:Tallis* — #434 slice 6 RED)
