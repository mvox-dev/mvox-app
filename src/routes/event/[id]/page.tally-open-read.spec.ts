// @vitest-environment happy-dom
//
// #363 RED — canSeeTally answers whether the person can see the tally. Today
// it answers whether she may MANAGE the event (`manageRightsFrom(...) ===
// 'editor'`, +page.svelte:526) and gates BOTH the fetch (:666, :905, :1052)
// and the render (:4564, :4593) on that wrong question. The rsvp rows are
// `_sharing: domain` (widened 2026-08-10) — Entu already answers the
// cross-person read for every member, so under epic #362's paradigm the app
// must render what the read returns, never hide readable data behind an app
// predicate.
//
// GAMA'S WARNING (ruling comment on #363, IC_kwDOTubdKM8AAAABVU2B6Q):
// `isEditor` on this page IS canSeeTally's result (:530-531) and feeds ~20
// management gates. The split must go predicate-first — management gates keep
// `manageRightsFrom(...) === 'editor'` under their own name; the tally stops
// consuming it. Editing canSeeTally in place would silently open every
// management control to every member. The gate-parity tests below are the
// deliberate run of done-when box 3.
//
// RULED (same comment): capacity opens WITH the tally (it renders tally.going
// inside the tally's own block — keeping it back would ADD a gate), and the
// tally-error paragraph shows to whoever issued the failing read — now every
// member.
//
// The page component is rendered whole (real route module, real data layer
// over a wire stub) — only `listAllRsvpsForEvent` is a spy, because these
// tests pin WHEN that read is issued, not just what renders.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NOW pinned well BEFORE the fixture event's 2026-09-01 start: the event is
// FUTURE, so the tally read joins against the active roster (#255 D) and the
// RSVP control stays writable (the post-write re-fetch test needs a write).
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

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

const { gotoMock, discoverMock, listAllRsvpsForEventMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
// ONLY the tally's own read is a spy — listAttendance and everything else in
// the module stay real (they run over the wire stub and never fire here: the
// attendance panel's Promise.all read is click-triggered only).
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAllRsvpsForEvent: listAllRsvpsForEventMock
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/** The event, rights props INVISIBLE — the viewer holds NO grant on it. This
 *  is the fixture the whole issue is about: owners/editors both read as [].
 *  The editor variant opts in explicitly (gate-parity tests only). */
function nonEditorEvent(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		event_name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [{ reference: 'org1', entity_type: 'organization' }],
		...over
	};
}

function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return nonEditorEvent({ _editor: [{ reference: 'p-viewer' }], ...over });
}

/** What the spied listAllRsvpsForEvent resolves: 2 going (the viewer's own
 *  rsvp-77 among them), 1 not_going, 1 maybe, 0 late. Every memberId is on the
 *  active roster below, so the future-event join (#255 D) drops nothing. */
const RSVP_ROWS = [
	{ rsvpId: 'rsvp-77', memberId: 'member-1', status: 'going' },
	{ rsvpId: 'r-2', memberId: 'm-2', status: 'going' },
	{ rsvpId: 'r-3', memberId: 'm-3', status: 'not_going' },
	{ rsvpId: 'r-4', memberId: 'm-4', status: 'maybe' }
] as const;

const ACTIVE_MEMBER_ENTITIES = ['member-1', 'm-2', 'm-3', 'm-4'].map((id) => ({
	_id: id,
	person: [{ reference: `p-${id}` }]
}));

/**
 * The wire behind everything that is NOT the spied tally read: the event GET,
 * the viewer's member lookup, her OWN rsvp (rsvp-77, going), the active-roster
 * read the future-tally join issues, and the rsvp-77 update choreography
 * (GET → property DELETEs → POST) the post-write test drives.
 */
function wireStub(event: Record<string, unknown>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/')) return json({ deleted: true });
		// #372 — the rsvp enablement read: grant her editor on her OWN person so
		// the control renders/writes exactly as it did before the grant became
		// the gate (this file's subject is the tally read, not rsvp rights).
		if (url.includes('/entity/p-viewer') && url.includes('props=_owner')) {
			return json({ entity: { _id: 'p-viewer', _editor: [{ reference: 'p-viewer' }] } });
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/rsvp-77')) {
			if (method === 'POST') return json({});
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
		if (url.includes('_type.string=member') && url.includes('status.string=active'))
			return json({ entities: ACTIVE_MEMBER_ENTITIES });
		if (url.includes('_type.string=rsvp') && url.includes('_parent.reference=p-viewer'))
			return json({
				entities: [{ _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] }]
			});
		return json({ entities: [] });
	});
}

function setAuthedWithSampledb() {
	setToken('jwt-token');
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

beforeEach(() => {
	listAllRsvpsForEventMock.mockResolvedValue([...RSVP_ROWS]);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	// resetAllMocks, not clearAllMocks: the retry test queues a
	// mockRejectedValueOnce that stays UNCONSUMED while the fetch is still
	// rights-gated (RED), and clearAllMocks does not drop once-implementations
	// — the stale rejection would leak into the next test's first read.
	vi.resetAllMocks();
	localStorage.clear();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

function renderPage(event: Record<string, unknown>) {
	const stub = wireStub(event);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithSampledb();
	return { ...render(Page), fetchStub: stub };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

// ── 1. the read is ISSUED for a plain member, and its result renders ─────────

describe('#363 — a plain member (no grant on the event) gets the tally', () => {
	it('issues the rsvp read exactly once and renders the full count shape + capacity', async () => {
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally'), 'tally not rendered for a non-editor').not.toBeNull();
		});
		// The FETCH is hers too, not only the render: the spy proves the page
		// asked, once, for THIS event.
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(1);
		expect(listAllRsvpsForEventMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'sampledb' }),
			'ev1'
		);
		// Full shape off the real fixture rows — every bucket, zero included.
		expect(q(container, 'event-detail-tally-going')!.textContent).toContain('"count":2');
		expect(q(container, 'event-detail-tally-not_going')!.textContent).toContain('"count":1');
		expect(q(container, 'event-detail-tally-maybe')!.textContent).toContain('"count":1');
		expect(q(container, 'event-detail-tally-late')!.textContent).toContain('"count":0');
		// RULED: capacity opens with the tally — tally.going of event.capacity.
		const cap = q(container, 'event-detail-capacity');
		expect(cap, 'capacity not rendered for a non-editor').not.toBeNull();
		expect(cap!.textContent).toContain('"going":2');
		expect(cap!.textContent).toContain('"capacity":20');
		// A successful read shows counts, never the error line.
		expect(q(container, 'event-detail-tally-error')).toBeNull();
	});
});

// ── 2. the tally renders from the read's RESULT ──────────────────────────────

describe("#363 — the tally is a function of the read's result (non-editor viewer)", () => {
	it('rows back → the counts show (pinned above); ZERO rows back → the tally still renders, all four buckets at 0 (0 is a COUNT, not an absence)', async () => {
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		for (const s of ['going', 'not_going', 'maybe', 'late']) {
			expect(q(container, `event-detail-tally-${s}`)!.textContent).toContain('"count":0');
		}
		expect(q(container, 'event-detail-tally-error')).toBeNull();
	});

	it('read REJECTS → the error line + Retry show to the non-editor (RULED: the failure of a read she issued is hers to be told about), counts dropped', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listAllRsvpsForEventMock.mockRejectedValue(new Error('boom'));
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(
				q(container, 'event-detail-tally-error'),
				'tally error not shown to a non-editor'
			).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-retry')).not.toBeNull();
		expect(q(container, 'event-detail-tally')).toBeNull();
		errorSpy.mockRestore();
	});
});

// ── 3. retry and the post-write re-fetch run for a non-editor ────────────────

describe('#363 — retry and the post-write re-fetch are not editor-gated either', () => {
	it('Retry re-issues the read for a non-editor: fail once, click Retry, counts render — two spy calls', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listAllRsvpsForEventMock.mockRejectedValueOnce(new Error('boom'));
		const { container } = renderPage(nonEditorEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-error')).not.toBeNull();
		});
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'event-detail-tally-retry')!);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-going')?.textContent).toContain('"count":2');
		});
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(2);
		expect(q(container, 'event-detail-tally-error')).toBeNull();
		errorSpy.mockRestore();
	});

	it("a non-editor's OWN rsvp write re-reads the counts (#102 F4 re-fetch, no longer behind the rights gate): two spy calls", async () => {
		const { container, fetchStub } = renderPage(nonEditorEvent());
		// Settle: tally rendered (read #1), own answer seeded + control enabled.
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
			expect(q(container, 'rsvp-btn-going')?.getAttribute('aria-pressed')).toBe('true');
			const maybe = q(container, 'rsvp-btn-maybe') as HTMLButtonElement | null;
			expect(maybe).not.toBeNull();
			expect(maybe!.disabled).toBe(false);
		});
		expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(1);

		await fireEvent.click(q(container, 'rsvp-btn-maybe')!);

		await waitFor(() => {
			expect(listAllRsvpsForEventMock).toHaveBeenCalledTimes(2);
		});
		// …and the count bump came from a REAL settled write, not a shortcut:
		// the update POST hit the viewer's existing rsvp entity.
		const posts = fetchStub.mock.calls.filter(
			(c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === 'POST'
		);
		expect(posts.length).toBeGreaterThan(0);
		for (const c of posts) expect(String(c[0])).toContain('/entity/rsvp-77');
	});
});

// ── 4. the ~20 management gates are UNTOUCHED (done-when box 3, run
//       deliberately — Gama's warning: isEditor must stop BEING canSeeTally
//       without changing its own answer) ────────────────────────────────────

describe('#363 — every management gate still asks manageRightsFrom, exactly as before', () => {
	// Three representative editor-only controls, all passively rendered:
	//   • the event_type header pencil   (+page.svelte ~:3771)
	//   • the schedule "add row" opener  (editor-only block ~:4404 → ~:4502)
	//   • the danger zone (delete)       (~:4757)
	const MANAGEMENT_TESTIDS = [
		'event-edit-btn-event_type',
		'event-schedule-add',
		'event-detail-danger-zone'
	] as const;

	it('a NON-editor sees the tally, yet NONE of the management controls', async () => {
		const { container } = renderPage(nonEditorEvent());
		// The tally rendering is the settle point AND the proof the new law is in
		// effect — the page is fully composed when we assert the absences.
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
			// schedule read settled too (its status region mounts with the section
			// only for editors; the event name proves the detail render finished).
			expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
		});
		for (const testid of MANAGEMENT_TESTIDS) {
			expect(q(container, testid), `${testid} leaked to a non-editor`).toBeNull();
		}
	});

	it('an `_editor` keeps all three controls AND the tally', async () => {
		const { container } = renderPage(editorEvent());
		await waitFor(() => {
			for (const testid of MANAGEMENT_TESTIDS) {
				expect(q(container, testid), `${testid} missing for an editor`).not.toBeNull();
			}
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
	});
});

// ── 5. canSeeTally is gone ───────────────────────────────────────────────────

describe('#363 — canSeeTally no longer exists under that lying name', () => {
	it('no definition or call site of canSeeTally survives in +page.svelte (the tally has no seeing-predicate at all — the read is the predicate)', () => {
		const src = readFileSync(resolve('src/routes/event/[id]/+page.svelte'), 'utf8');
		// Definition (`function canSeeTally(`) and every call (`canSeeTally(...)`)
		// share this shape; a prose mention in a comment does not.
		expect(src).not.toMatch(/canSeeTally\s*\(/);
	});
});

// (*MVOX:Tallis*)
