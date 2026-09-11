// @vitest-environment happy-dom
//
// #326 RED (event-page integration) — the saved cue on the WRITE path.
//
// #329 rewired this page's own-answer READ (the scoped fact read). The cue
// this suite pins reports the WRITE's outcome and sits on the write path —
// the rsvpChangeQueue reconcile — never on the read: loading the page and
// seeing an answer that was saved last week must NOT announce "saved".
//
// INTEGRATION posture (page.rsvp-fact-read.spec.ts family): the REAL page +
// REAL data layer + REAL rsvpChangeQueue, only global fetch stubbed at the
// wire. Pins:
//   1. A settled status change announces saved on THIS page's control
//      (persistent role="status" region — the #267 reference shape; a
//      visible cue may join it, tolerated, never asserted against).
//   2. While the write is in flight the PO-ruled SILENT disable is
//      byte-preserved: aria-busy, no saved text, msg line blank.
//   3. Failure path byte-preserved: value reverts + role=alert, no saved cue.
//   4. Hold → switch → settle: a write that settles AFTER a collective
//      switch must NOT paint the saved cue onto the reloaded page (the
//      page's existing isCurrentWrite/generation discipline extends to the
//      cue). And the cue never fires from the READ path at all.
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

/** The viewer's OWN rsvp for ev1 — she answered "going". */
const MY_RSVP_ROW = { _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] };

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

type WireOpts = {
	/** How the status-change POST to /entity/rsvp-77 behaves. */
	updatePost?: 'ok' | 'fail' | 'hold';
};

function wireStub(opts: WireOpts = {}) {
	const heldPost = deferred<Response>();
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') {
				if (opts.updatePost === 'fail') return json({ error: 'boom' }, 500);
				if (opts.updatePost === 'hold') return heldPost.promise;
				return json({});
			}
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
				// The SCOPED fact read (#329).
				return json({ entities: [MY_RSVP_ROW] });
			}
			return json({ entities: [] });
		}
		return json({ entities: [] });
	});
	return {
		stub,
		releasePost: () => heldPost.resolve(json({})),
		failHeldPost: () => heldPost.resolve(json({ error: 'boom' }, 500))
	};
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

function renderPage(opts: WireOpts = {}, dbs?: string[]) {
	const wire = wireStub(opts);
	vi.stubGlobal('fetch', wire.stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	const rendered = render(Page);
	return { ...rendered, ...wire };
}

function rsvpSection(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="event-detail-rsvp"]');
}

function savedText(container: HTMLElement): string {
	return (
		rsvpSection(container)
			?.querySelector('[data-testid="rsvp-saved-status"]')
			?.textContent?.trim() ?? ''
	);
}

async function waitForAnsweredControl(container: HTMLElement) {
	await waitFor(() => {
		const btn = container.querySelector(
			'[data-testid="rsvp-btn-going"]'
		) as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.getAttribute('aria-pressed')).toBe('true');
		expect(btn!.disabled).toBe(false);
	});
}

async function flushMicrotasks(times = 6) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	resetTypeIdCache();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/event/[id] — the saved cue fires when the WRITE reconciles (#326)', () => {
	it('merely LOADING an existing answer announces nothing — the cue reports a write, never a read (#329 wiring)', async () => {
		const { container } = renderPage();
		await waitForAnsweredControl(container);
		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
	});

	it('a settled status change announces saved on this page — persistent role="status" region inside the RSVP section', async () => {
		const { container } = renderPage();
		await waitForAnsweredControl(container);

		// The region pre-exists the announcement (a live region must be mounted
		// before its text changes to be announced) …
		const region = rsvpSection(container)?.querySelector('[data-testid="rsvp-saved-status"]');
		expect(region).not.toBeNull();
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.getAttribute('aria-live')).toBe('polite');

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		// …and carries the saved message once the write settles, alongside the
		// reconciled value.
		await waitFor(() => {
			expect(savedText(container)).toContain('[rsvp_saved]');
		});
		expect(
			container.querySelector('[data-testid="rsvp-btn-not_going"]')?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('while the write is in flight: the PO-ruled SILENT disable is byte-preserved — aria-busy, no saved text, msg line blank', async () => {
		const { container, releasePost } = renderPage({ updatePost: 'hold' });
		await waitForAnsweredControl(container);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		await waitFor(() => {
			expect(
				rsvpSection(container)
					?.querySelector('[data-testid="rsvp-control"]')
					?.getAttribute('aria-busy')
			).toBe('true');
		});
		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
		expect(
			rsvpSection(container)
				?.querySelector('[data-testid="rsvp-msg-line"]')
				?.textContent?.trim()
		).toBe('');
		releasePost();
	});

	it('failure path byte-preserved: the value reverts + role=alert error — and NO saved cue', async () => {
		const { container } = renderPage({ updatePost: 'fail' });
		await waitForAnsweredControl(container);

		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);

		await waitFor(() => {
			expect(
				rsvpSection(container)?.querySelector('[data-testid="rsvp-save-failed"]')
			).not.toBeNull();
		});
		expect(
			rsvpSection(container)
				?.querySelector('[data-testid="rsvp-save-failed"]')
				?.getAttribute('role')
		).toBe('alert');
		// Reverted: her pre-tap "going" is back.
		expect(
			container.querySelector('[data-testid="rsvp-btn-going"]')?.getAttribute('aria-pressed')
		).toBe('true');
		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
	});
});

describe('/event/[id] — the cue does not leak across a collective switch (#326 pin 7, hold → switch → settle)', () => {
	it('a write that settles AFTER the switch never paints the saved cue onto the reloaded page', async () => {
		const { container, releasePost } = renderPage({ updatePost: 'hold' }, [
			'polyphony',
			'other-choir'
		]);
		await waitForAnsweredControl(container);

		// The write starts under polyphony…
		await fireEvent.click(container.querySelector('[data-testid="rsvp-btn-not_going"]')!);
		await waitFor(() => {
			expect(
				rsvpSection(container)
					?.querySelector('[data-testid="rsvp-control"]')
					?.getAttribute('aria-busy')
			).toBe('true');
		});

		// …the viewer switches collectives (the page reloads ev1 under the new
		// db; the wire serves the same fixtures for both)…
		selectedCollectiveDbStore.set('other-choir');
		await waitForAnsweredControl(container);

		// …and only NOW the old write settles successfully. The saved cue must
		// not appear: it would describe a write from the collective she left.
		releasePost();
		await flushMicrotasks();

		expect(savedText(container)).toBe('');
		expect(container.textContent).not.toContain('[rsvp_saved]');
	});
});

// (*MVOX:Tallis* — #326 RED)
