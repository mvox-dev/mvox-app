// @vitest-environment happy-dom
//
// #203 (RED) — delete button on the event detail page.
//
// A rights-holder (the page's ONE rights predicate, `isEditor` — already
// derived from manageRightsFrom(detail.ownerIds, detail.editorIds, personId))
// deletes the event she is looking at. Same two-step confirm posture as the
// agenda panel's row deletes (#197 review F2): the × ARMS, only the confirm
// button destroys, cancel disarms. After a successful delete the page she is
// standing on no longer exists, so the page navigates home: goto('/').
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/routes/event/[id]/+page.svelte
//     • event-detail-delete — the idle × <button>, rendered ONLY when
//       `isEditor` (the SAME gate the pencils and the tally run — rights props
//       live in the private bucket, so a plain member reads no rights lists at
//       all and must never see the button).
//     • tap → ARMED state: event-detail-delete-confirm and
//       event-detail-delete-cancel replace the ×. Arming writes NOTHING.
//     • confirm → deleteEvent(cfg, eventId) from $lib/seasons/seasonManage
//       (the #197 cascade — attendance + program_item children first, event
//       last; already fully tested in seasonManage.delete.spec.ts, so THIS
//       spec mocks it and pins the page-side wiring: exactly one call, exact
//       cfg, exact id). On resolve → goto('/') — the deleted event's own page
//       is not a place anyone can stand.
//     • cancel → back to idle: × returns, confirm/cancel unmount, nothing
//       was called.
//     • a REJECTED delete keeps the page up (no navigation) and shows
//       event-detail-delete-error. A 403 refusal (EntityDeleteForbiddenError,
//       duck-typed via isDeleteForbidden from $lib/seasons/deleteErrors — the
//       page imports discriminators from THERE, not from the mocked
//       seasonManage, per that module's header) is the one failure that is
//       NOT "try again": an `_editor` can pass the button's gate yet lack the
//       `_owner` the DELETE endpoint demands, so the error copy must be the
//       forbidden-flavoured message, not the retry-flavoured generic one.
//
// Assertions match on DATA (testids, mock calls, message KEYS via the
// full-fallback paraglide proxy), never translated sentences — same posture
// as page.spec.ts. Every test renders the REAL route page (integration, not a
// component in isolation): the wiring is the thing under test.
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

// Full-fallback paraglide mock — every key renders `[key {params}]`, so the
// forbidden assertion below pins the KEY family, not a translated sentence.
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

const { gotoMock, discoverMock, deleteEventMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	deleteEventMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

// PARTIAL mock — only `deleteEvent` is replaced. The cascade itself is already
// pinned by seasonManage.delete.spec.ts; here the page-side wiring is the
// contract. Everything else the page may import from the module stays real.
vi.mock('$lib/seasons/seasonManage', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/seasons/seasonManage')>()),
	deleteEvent: deleteEventMock
}));

import Page from './+page.svelte';
import { EntityDeleteForbiddenError } from '$lib/seasons/deleteErrors';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

/** The exact cfg the page hands the data layer: selected db + stored token. */
const CFG = { db: 'polyphony', token: 'jwt-token' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── Entu fixtures ─────────────────────────────────────────────────────────────
// Same event as page.spec.ts (2026-09-01T16:00Z = 19:00 Europe/Tallinn).

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

/**
 * Liberal read-only wire — serves the fixtures whether the impl reads by id or
 * by query, empty lists for everything else (rsvp, attendance, roster,
 * repertoire…). No DELETE handling on purpose: `deleteEvent` is mocked, so ANY
 * destructive traffic reaching this stub is itself a failure (the page must go
 * through the #197 cascade, never fire its own DELETE).
 */
function readWireStub(eventOver?: Record<string, unknown>) {
	const event = eventOver ?? eventEntity();
	const season = seasonEntity();
	const series = seriesEntity();
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE' || method === 'POST') {
			throw new Error(`unexpected ${method} ${url} — destructive wire traffic in a mocked-delete spec`);
		}
		if (url.includes('/entity/ev1')) return json({ entity: event });
		if (url.includes('/entity/season1')) return json({ entity: season });
		if (url.includes('/entity/series1')) return json({ entity: series });
		if (url.includes('_type.string=season')) return json({ entities: [season] });
		if (url.includes('_type.string=event_series')) return json({ entities: [series] });
		if (url.includes('_type.string=event')) return json({ entities: [event] });
		return json({ entities: [] });
	});
}

function setAuthedWithPolyphony() {
	setToken(CFG.token);
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

function renderPage(eventOver?: Record<string, unknown>) {
	const stub = readWireStub(eventOver);
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
	deleteEventMock.mockReset();
	gotoMock.mockReset();
	localStorage.clear();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Wait for the loaded page, then hand back the idle delete button. */
async function idleDeleteButton(container: HTMLElement): Promise<HTMLElement> {
	return await waitFor(() => {
		const btn = q(container, 'event-detail-delete');
		expect(btn, 'event-detail-delete missing for a rights-holder').not.toBeNull();
		return btn as HTMLElement;
	});
}

/** Tap the ×, wait for the armed pair, hand both halves back. */
async function arm(container: HTMLElement): Promise<{ confirm: HTMLElement; cancel: HTMLElement }> {
	await fireEvent.click(await idleDeleteButton(container));
	return await waitFor(() => {
		const confirm = q(container, 'event-detail-delete-confirm');
		const cancel = q(container, 'event-detail-delete-cancel');
		expect(confirm, 'event-detail-delete-confirm missing after arming').not.toBeNull();
		expect(cancel, 'event-detail-delete-cancel missing after arming').not.toBeNull();
		return { confirm: confirm as HTMLElement, cancel: cancel as HTMLElement };
	});
}

// ═════════════════════════════════════════════════════════════════════════════
// visibility — the isEditor gate
// ═════════════════════════════════════════════════════════════════════════════

describe('event detail — #203 delete button visibility', () => {
	it('a rights-holder sees the delete button, as a <button>, in IDLE shape — no confirm/cancel yet, nothing called', async () => {
		const { container } = renderPage(editorEvent());
		const btn = await idleDeleteButton(container);
		expect(btn.tagName).toBe('BUTTON');
		expect(q(container, 'event-detail-delete-confirm')).toBeNull();
		expect(q(container, 'event-detail-delete-cancel')).toBeNull();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	it('a plain member (no rights lists at all — the private-bucket read) sees NO delete surface of any kind', async () => {
		const { container } = renderPage(eventEntity());
		// The page must be LOADED (name rendered) before the absence means
		// anything — an unrendered page has no buttons either.
		await waitFor(() => {
			expect(q(container, 'event-detail-name')).not.toBeNull();
		});
		expect(q(container, 'event-detail-delete')).toBeNull();
		expect(q(container, 'event-detail-delete-confirm')).toBeNull();
		expect(q(container, 'event-detail-delete-cancel')).toBeNull();
	});

	// Review F2 — affordance hierarchy. The delete used to render inside the
	// name/start/duration/location/description stack, right under the description
	// pencil: a bare unlabelled × in the same narrow column, at the same size, as
	// four edit pencils, with three whole sections after it in both visual and tab
	// order. The agenda's bare × is unambiguous because it sits at the right edge
	// of a named list row; here the ONLY thing separating "delete this entire
	// event" from "edit the description" was the glyph. These pin the fix: last in
	// document order, and it names itself.

	it('the delete sits at the FOOT of the article — after the RSVP section, not inside the field stack', async () => {
		const { container } = renderPage(editorEvent());
		const btn = await idleDeleteButton(container);
		const rsvp = q(container, 'event-detail-rsvp');
		expect(rsvp, 'event-detail-rsvp missing').not.toBeNull();
		// DOCUMENT_POSITION_PRECEDING (2) — the RSVP section comes BEFORE the
		// delete, i.e. the delete is downstream of the page's content sections.
		expect(
			btn.compareDocumentPosition(rsvp as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING,
			'the delete button renders before the RSVP section — it is back inside the field stack'
		).toBeTruthy();
		// …and after every edit pencil, which is where it already was; asserted so
		// a future move cannot push it back up past them either.
		const pencil = q(container, 'event-edit-btn-description');
		expect(pencil, 'event-edit-btn-description missing').not.toBeNull();
		expect(
			btn.compareDocumentPosition(pencil as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING
		).toBeTruthy();
	});

	// #237 SPEC FLIP — this test used to hunt the aria-hidden × span as the
	// decorative marker. The sweep replaces the × with the shared trashcan unit
	// (TrashIcon inside DeleteTrigger), and this is the STATED CHOICE pinned for
	// the site: NOT icon-only — the visible label STAYS (the #157/#249
	// single-name discipline; the button keeps name-from-contents), only the
	// decoration changes from × to the aria-hidden trashcan svg.
	it('the delete NAMES itself — visible text label beside the shared trashcan icon, not a bare glyph leaning on an aria-label (#237)', async () => {
		const { container } = renderPage(editorEvent());
		const btn = await idleDeleteButton(container);
		// The label is a real message key rendered as button CONTENT. `aria-label`
		// would override name-from-contents (the #157 rule the pencils follow), so
		// the button must not carry one.
		expect(btn.getAttribute('aria-label')).toBeNull();
		expect(btn.textContent ?? '').toContain('[event_detail_delete_label]');
		// The decoration is the shared trashcan now — aria-hidden, so the
		// accessible name is exactly the label a sighted user reads (WCAG 2.5.3).
		const svg = btn.querySelector('svg[data-icon="trash"]');
		expect(svg, 'TrashIcon must render inside the trigger').not.toBeNull();
		expect(svg!.getAttribute('aria-hidden')).toBe('true');
		// The × is GONE — it read as a close control, the #236 confusion.
		expect(btn.textContent ?? '').not.toMatch(/[×✕]/);
		// Red treatment + 44px by construction survive the migration to the unit.
		for (const cls of ['text-red-700', 'hover:text-red-800', 'min-h-11', 'min-w-11']) {
			expect(btn.classList.contains(cls), `${cls} missing on the trigger`).toBe(true);
		}
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// the two-step confirm
// ═════════════════════════════════════════════════════════════════════════════

describe('event detail — #203 delete is a TWO-step confirm, never a single tap', () => {
	it('tapping the × writes NOTHING — it arms: confirm + cancel appear, the idle × leaves', async () => {
		const { container } = renderPage(editorEvent());
		await arm(container);
		expect(deleteEventMock).not.toHaveBeenCalled();
		expect(gotoMock).not.toHaveBeenCalled();
		// The armed pair REPLACES the × — two live delete triggers at once is
		// exactly the mis-tap the two-step exists to prevent.
		expect(q(container, 'event-detail-delete')).toBeNull();
	});

	it('confirm calls deleteEvent(cfg, eventId) exactly ONCE and navigates home', async () => {
		deleteEventMock.mockResolvedValue(undefined);
		const { container } = renderPage(editorEvent());
		const { confirm } = await arm(container);
		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(deleteEventMock).toHaveBeenCalledTimes(1);
		});
		expect(deleteEventMock).toHaveBeenCalledWith(CFG, 'ev1');
		await waitFor(() => {
			expect(gotoMock).toHaveBeenCalledWith('/');
		});
	});

	it('cancel disarms back to idle: × returns, confirm/cancel unmount, NOTHING was called', async () => {
		const { container } = renderPage(editorEvent());
		const { cancel } = await arm(container);
		await fireEvent.click(cancel);
		await waitFor(() => {
			expect(q(container, 'event-detail-delete')).not.toBeNull();
		});
		expect(q(container, 'event-detail-delete-confirm')).toBeNull();
		expect(q(container, 'event-detail-delete-cancel')).toBeNull();
		expect(deleteEventMock).not.toHaveBeenCalled();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	// Review F1 — WCAG 2.4.3. Each flip UNMOUNTS the button that holds focus
	// (arming kills the trigger, cancelling kills the confirm/cancel pair), so
	// without explicit placement focus drops to <body> and the next Tab restarts
	// at the top of the document — a keyboard user has to tab all the way back
	// down to the confirm she just armed. The roster (`armRemove`) and the agenda
	// (`armSeasonManageDelete`) both pin this; pin it here too or the gap simply
	// recurs on the next delete surface.

	it('arming moves focus onto the confirm button that replaced the trigger — never <body>', async () => {
		const { container } = renderPage(editorEvent());
		const { confirm } = await arm(container);
		await waitFor(() => {
			expect(
				document.activeElement,
				`focus after arming was <${document.activeElement?.tagName}>, not the confirm button`
			).toBe(confirm);
		});
	});

	it('cancelling hands focus back to the trigger that came back — never <body>', async () => {
		const { container } = renderPage(editorEvent());
		const { cancel } = await arm(container);
		await fireEvent.click(cancel);
		const trigger = await waitFor(() => {
			const btn = q(container, 'event-detail-delete');
			expect(btn, 'event-detail-delete missing after cancelling').not.toBeNull();
			return btn as HTMLElement;
		});
		await waitFor(() => {
			expect(
				document.activeElement,
				`focus after cancelling was <${document.activeElement?.tagName}>, not the delete trigger`
			).toBe(trigger);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// failure — the 403 refusal
// ═════════════════════════════════════════════════════════════════════════════

describe('event detail — #203 refused delete', () => {
	it('a 403 refusal shows the FORBIDDEN-flavoured error, stays on the page, and never navigates', async () => {
		deleteEventMock.mockRejectedValue(new EntityDeleteForbiddenError('ev1'));
		const { container } = renderPage(editorEvent());
		const { confirm } = await arm(container);
		await fireEvent.click(confirm);
		const error = await waitFor(() => {
			const el = q(container, 'event-detail-delete-error');
			expect(el, 'event-detail-delete-error missing after a refused delete').not.toBeNull();
			return el as HTMLElement;
		});
		// The paraglide proxy renders `[key]` — so this pins that the refusal
		// copy comes from a forbidden-flavoured message KEY, distinct from any
		// retry-flavoured generic (an _editor who lacks _owner must be told the
		// truth, not "try again").
		expect(error.textContent ?? '').toMatch(/forbidden/i);
		// Still standing on the (undeleted) event — no navigation happened.
		expect(gotoMock).not.toHaveBeenCalled();
		expect(q(container, 'event-detail-name')).not.toBeNull();
	});
});

// (*MVOX:Palestrina* — #203 RED: event detail delete button)
// (*MVOX:Palestrina* — #237 RED spec flip: the decorative × becomes the shared
// aria-hidden trashcan; the visible label stays as the accessible name)
