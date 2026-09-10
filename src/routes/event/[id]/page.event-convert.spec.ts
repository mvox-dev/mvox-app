// @vitest-environment happy-dom
//
// #313 RED — standalone event → series conversion moves to the EVENT PAGE
// (integration: real src/routes/event/[id]/+page.svelte; reads go through a
// fetch stub — the page.series-picker.spec.ts harness — while the WRITE seams
// (convertEventToSeries, createEvent, resolveDatabaseEntityId) are mocked the
// way src/routes/page.event-convert.spec.ts mocked them, so every behaviour
// assertion below is the #196/#212 contract unchanged; only the ENTRY POINT
// and the route are new).
//
// WHY (#313, Mihkel 2026-09-10): "in season editor, we dont need to list
// events … every event should have these administrator controls on their
// page." The season panel's standalone-event list is REMOVED in this same
// slice; convert must live here FIRST — never a window where neither surface
// offers it.
//
// THE GATE (research-313, confirmed from eventConvert.ts): the conversion's
// wire is a series CREATE (parented [dbEntityId, seasonId]) + ONE `_parent`
// APPEND on the event + a NAME-value delete — no `_parent` value DELETE
// anywhere, so #304's owner-only gate (isOwnerTier, unassign-specific) does
// NOT apply. Convert reuses the page's existing `isEditor` (the ONE rights
// rule this page owns, manageRightsFrom over the already-loaded detail):
//   - rendered for an editor-NOT-owner (the tier #304's unassign refuses);
//   - rendered for an owner (ownership subsumes editing);
//   - ABSENT (never disabled) for a plain member, while the event read is
//     still in flight, for a SERIES CHILD (detail.seriesId !== null —
//     converting one is meaningless), and for a SEASONLESS event (the series
//     is parented to the season; no season, nowhere to put it) — the #301/
//     #304 fail-closed posture.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS
//     event-detail-convert       the entry control on the event page — a real
//                                BUTTON whose accessible name renders the NEW
//                                key `event_detail_convert`; GONE while the
//                                form is open (one entry, one meaning — the
//                                armed-delete swap idiom), restored on close,
//                                and Escape hands focus back to it.
//     event-convert-form         the conversion form — SAME testid family as
//                                the panel-era form, because the flow is the
//                                same flow relocated:
//     event-convert-interval     number input, default '7' (weekly)
//     event-convert-duration     number input (minutes)
//     event-convert-end-date     type="date" — the series' last day
//     event-convert-start-date   #212 — a <p>: label key + the event's
//                                Tallinn wall-clock ISO date, above end-date
//     event-convert-submit / -cancel / -error / -progress / -resume-notice
//
//   DATA — unchanged from #196:
//     - submit calls `convertEventToSeries(cfg, input)`; dbEntityId from
//       `resolveDatabaseEntityId` (never guessed), seasonId = the EVENT's own
//       season (detail.seasonId — the page resolves it from the detail read,
//       the relocation of the panel's `manageableSeasonId` gate), eventId =
//       the page's event, startTime/startDate derived from the event's
//       startDatetime as EUROPE/TALLINN wall clock.
//     - the occurrence loop, validation-before-write, step-named failures,
//       stop-and-resume: all byte-identical behaviour to the panel era.
//     - success → the form closes AND the page re-reads its event (the world
//       refreshed: the event is a series child now).
//     - an OCCURRENCE failure does NOT re-read the event: a refresh would
//       show detail.seriesId !== null, unmount the convert region, and eat
//       the resume record — the relocation of the panel's "the standalone
//       list is deliberately NOT re-read" pin.
//
//   UNTOUCHED — event-detail-delete (trigger, armed pair, error slot) is
//   byte-untouched by this slice; one presence pin below, the full contract
//   stays in page.event-delete.spec.ts.
//
//   I18N — the event_convert_* keys are REUSED by the relocated form (their
//   locale pins stay in src/routes/page.event-convert.spec.ts); NEW here:
//   `event_detail_convert` in all four locales, and `event_create_series_hint`
//   REWRITTEN in all four locales to stop pointing at the season panel.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin "now" before the fixture event (2027-04-18) — same hygiene as
// page.spec.ts: only Date is faked, timers stay real so waitFor polls.
const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

// Lenient message mock — structural assertions only; real copy is Comenius's.
// Params append as JSON so a spec can pin that a message RECEIVED its
// parameter (the event_convert_failed {step} contract, the resume counts)
// without pinning translated copy. Same mock as the panel-era spec, so the
// relocated assertions carry over byte-identical.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
}));

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev-9' } as Record<string, string>,
	url: new URL('http://localhost/event/ev-9')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const {
	gotoMock,
	discoverMock,
	convertEventToSeriesMock,
	createEventMock,
	resolveDatabaseEntityIdMock
} = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	convertEventToSeriesMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
// #196 — the conversion seam. The real module's error class rides along so the
// page can discriminate EventConvertError from anything else.
vi.mock('$lib/events/eventConvert', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/events/eventConvert')>();
	return { ...actual, convertEventToSeries: convertEventToSeriesMock };
});
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});

import Page from './+page.svelte';
import { isMessageEmpty, messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';
import type { ConvertEventToSeriesInput } from '$lib/events/eventConvert';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
/** The page's own cfg shape: { db: selected.db, token: getToken() ?? '' }. */
const CFG = { db: 'polyphony', token: 'jwt-abc' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** The standalone event #313 converts. Its UTC instant is 2027-04-18T18:00Z —
 *  Europe/Tallinn is EEST (UTC+3) in April, so the wall clock the operator
 *  knows this event by is 21:00 on 2027-04-18. Season parent, NO series. */
function standaloneEvent(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev-9',
		name: [{ _id: 'val-name-1', string: 'Spring concert' }],
		event_type: [{ _id: 'val-type-1', string: 'concert' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2027-04-18T18:00:00.000Z' }],
		location: [{ _id: 'val-loc-1', string: 'Concert Hall' }],
		_parent: [
			{ _id: 'pv-org', reference: 'org1', entity_type: 'organization' },
			{ _id: 'pv-season', reference: 'season-1', entity_type: 'season' }
		],
		...over
	};
}
/** Editor-NOT-owner — the tier the #304 owner gate refuses and THIS control
 *  must serve (research-313: convert's wire never deletes a `_parent` value). */
function editorEvent(over: Partial<Record<string, unknown>> = {}) {
	return standaloneEvent({ _editor: [{ reference: 'p-viewer' }], ...over });
}
/** Owner view — ownership subsumes editing (manageRightsFrom). */
function ownerEvent(over: Partial<Record<string, unknown>> = {}) {
	return standaloneEvent({ _owner: [{ reference: 'p-viewer' }], ...over });
}
/** A series CHILD — detail.seriesId !== null; convert is meaningless. */
function seriesChildEvent() {
	return editorEvent({
		_parent: [
			{ _id: 'pv-org', reference: 'org1', entity_type: 'organization' },
			{ _id: 'pv-season', reference: 'season-1', entity_type: 'season' },
			{ _id: 'pv-series', reference: 'series-1', entity_type: 'event_series' }
		]
	});
}
/** No season parent — nowhere to hang the new series. */
function seasonlessEvent() {
	return editorEvent({
		_parent: [{ _id: 'pv-org', reference: 'org1', entity_type: 'organization' }]
	});
}

function seasonEntity() {
	return {
		_id: 'season-1',
		name: [{ string: 'Season 2026' }],
		start_date: [{ date: '2026-08-01' }],
		conductor: []
	};
}
function series1Entity() {
	return {
		_id: 'series-1',
		name: [{ string: 'Monday rehearsals' }],
		duration_minutes: [{ number: 90 }]
	};
}

type WireOpts = {
	/** Hold the event GET open — the "loading claims nothing" probe. */
	holdEventGet?: boolean;
};

/** Read-only wire: the page's fetch traffic (event, season, series list,
 *  anything else empty). WRITES never reach here — the conversion seams are
 *  module mocks above. */
function wireStub(eventOver?: Record<string, unknown>, opts: WireOpts = {}) {
	const event = eventOver ?? editorEvent();
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const stub = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/entity/ev-9')) {
			if (opts.holdEventGet) await gate;
			return json({ entity: event });
		}
		if (url.includes('/entity/season-1')) return json({ entity: seasonEntity() });
		if (url.includes('/entity/series-1')) return json({ entity: series1Entity() });
		if (url.includes('_type.string=event_series')) return json({ entities: [series1Entity()] });
		return json({ entities: [] });
	});
	return { stub, release: () => release() };
}

function setAuthed() {
	setToken('jwt-abc');
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

function renderEventPage(eventOver?: Record<string, unknown>, opts: WireOpts = {}) {
	const { stub, release } = wireStub(eventOver, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev-9' };
	pageStub.url = new URL('http://localhost/event/ev-9');
	setAuthed();
	const rendered = render(Page);
	return { ...rendered, fetchStub: stub, release };
}

beforeEach(() => {
	convertEventToSeriesMock.mockResolvedValue({ seriesId: 'series-new-9', eventType: 'concert' });
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	convertEventToSeriesMock.mockReset();
	createEventMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	gotoMock.mockReset();
	discoverMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── helpers ─────────────────────────────────────────────────────────────────────

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function waitDetail(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'event-detail-name')?.textContent ?? '').not.toBe('');
	});
}

async function waitConvertControl(container: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(q(container, 'event-detail-convert')).not.toBeNull();
	});
	return q(container, 'event-detail-convert') as HTMLElement;
}

async function openConvertForm(container: HTMLElement): Promise<void> {
	const control = await waitConvertControl(container);
	await fireEvent.click(control);
	await waitFor(() => {
		expect(q(container, 'event-convert-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function fillAndSubmitConvert(
	container: HTMLElement,
	over: { duration?: string; endDate?: string; interval?: string } = {}
): Promise<void> {
	if (over.interval !== undefined) await fill(container, 'event-convert-interval', over.interval);
	await fill(container, 'event-convert-duration', over.duration ?? '90');
	await fill(container, 'event-convert-end-date', over.endDate ?? '2027-06-30');
	await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);
}

/** How many times the page has READ its own event off the wire. */
function eventGets(stub: ReturnType<typeof vi.fn>): number {
	return stub.mock.calls.filter((c) => {
		const method = ((c[1] as RequestInit | undefined)?.method ?? 'GET') as string;
		return method === 'GET' && String(c[0]).includes('/entity/ev-9');
	}).length;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — the gate: editor tier, standalone only, fail closed (absent, not disabled)
//     (integration: rendered by the ACTUAL event page route)
// ═════════════════════════════════════════════════════════════════════════════

describe('#313 — the convert control on the event page: rendered exactly when editor + standalone + season', () => {
	it('editor-NOT-owner on a standalone event with a season: event-detail-convert renders as a real BUTTON with the localized accessible name — and the UNTOUCHED delete trigger stands beside it', async () => {
		const { container } = renderEventPage(editorEvent());
		const control = await waitConvertControl(container);

		expect(control.tagName).toBe('BUTTON');
		const name = `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''}`;
		expect(name).toContain('event_detail_convert');

		// #313 Done-when: delete on the event page is byte-untouched — the #237
		// trigger still renders for the same editor (full contract stays in
		// page.event-delete.spec.ts).
		expect(q(container, 'event-detail-delete')).not.toBeNull();

		// Merely rendering writes nothing.
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('an OWNER gets it too — ownership subsumes editing (manageRightsFrom, the page’s one rights rule)', async () => {
		const { container } = renderEventPage(ownerEvent());
		await waitConvertControl(container);
	});

	it('a plain member (no rights visible) gets NO convert control — absent, not disabled', async () => {
		const { container } = renderEventPage(standaloneEvent());
		await waitDetail(container);
		expect(q(container, 'event-detail-convert')).toBeNull();
		expect(q(container, 'event-convert-form')).toBeNull();
	});

	it('a SERIES CHILD (detail.seriesId !== null) gets NO convert control, editor or not — converting one is meaningless', async () => {
		const { container } = renderEventPage(seriesChildEvent());
		await waitDetail(container);
		expect(q(container, 'event-detail-convert')).toBeNull();
	});

	it('a SEASONLESS event gets NO convert control — the series is parented to the season, and there is none', async () => {
		const { container } = renderEventPage(seasonlessEvent());
		await waitDetail(container);
		expect(q(container, 'event-detail-convert')).toBeNull();
	});

	it('while the event read is still in flight NOTHING renders — an unresolved tier/season is not a positive claim (fail closed)', async () => {
		const { container } = renderEventPage(editorEvent(), { holdEventGet: true });
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		expect(q(container, 'event-detail-convert')).toBeNull();
		expect(q(container, 'event-convert-form')).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — the form: relocated intact (open/cancel, defaults, #212 start date)
// ═════════════════════════════════════════════════════════════════════════════

describe('#313 — clicking convert opens the relocated form; nothing is written yet', () => {
	it('the form opens with interval pre-filled 7 (weekly), number/number/date inputs — and the ENTRY control leaves while it is open (one entry, one meaning)', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		const interval = q(container, 'event-convert-interval') as HTMLInputElement;
		expect(interval.type).toBe('number');
		expect(interval.value).toBe('7');
		const duration = q(container, 'event-convert-duration') as HTMLInputElement;
		expect(duration.type).toBe('number');
		const endDate = q(container, 'event-convert-end-date') as HTMLInputElement;
		expect(endDate.type).toBe('date');

		expect(q(container, 'event-detail-convert')).toBeNull();

		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form, NOTHING is written, and the entry control comes back', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fireEvent.click(q(container, 'event-convert-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'event-detail-convert')).not.toBeNull();
		});
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});

	it('#212 relocated — event-convert-start-date renders as labelled TEXT (label key + Tallinn wall-clock ISO date), above the end-date picker, never an input', async () => {
		// 2026-03-14 is EET (UTC+2, before the late-March DST switch): the UTC
		// instant 16:00Z is the 18:00 Tallinn wall clock. The date shown must be
		// the TALLINN date, ISO-formatted.
		const { container } = renderEventPage(
			editorEvent({
				start_datetime: [{ _id: 'val-start-1', datetime: '2026-03-14T16:00:00.000Z' }]
			})
		);
		await openConvertForm(container);

		const start = q(container, 'event-convert-start-date');
		expect(start).not.toBeNull();
		expect((start as HTMLElement).tagName).toBe('P');
		expect((start as HTMLElement).querySelector('input, select, textarea')).toBeNull();
		expect((start as HTMLElement).textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'event_convert_start_date_label 2026-03-14'
		);
		const form = q(container, 'event-convert-form') as HTMLElement;
		expect(form.contains(start)).toBe(true);
		const endDate = q(container, 'event-convert-end-date') as HTMLElement;
		expect(
			(start as HTMLElement).compareDocumentPosition(endDate) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — submit wiring: the FULL input, success refresh, step-named failures
// ═════════════════════════════════════════════════════════════════════════════

describe('#313 — submit hands convertEventToSeries the FULL input off the page’s own detail', () => {
	it('eventId from the route, dbEntityId resolved (never guessed), seasonId = the EVENT’s season, cadence typed, startTime/startDate = the event as TALLINN wall clock', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fill(container, 'event-convert-duration', '90');
		await fill(container, 'event-convert-end-date', '2027-06-30');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);

		await waitFor(() => {
			expect(convertEventToSeriesMock).toHaveBeenCalledTimes(1);
		});
		const expected: ConvertEventToSeriesInput = {
			eventId: 'ev-9',
			dbEntityId: ORG_EFK,
			seasonId: 'season-1',
			intervalDays: 7,
			startTime: '21:00',
			startDate: '2027-04-18',
			endDate: '2027-06-30',
			durationMinutes: 90
		};
		expect(convertEventToSeriesMock).toHaveBeenCalledWith(CFG, expected);
		// Let the occurrence run finish inside the test rather than leaving a
		// loop POSTing into torn-down mocks.
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
	});

	it('success → the form closes AND the page re-reads its event — the world refreshed, the event is a series child now', async () => {
		const { container, fetchStub } = renderEventPage(editorEvent());
		await openConvertForm(container);
		const readsBefore = eventGets(fetchStub);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		await waitFor(() => {
			expect(eventGets(fetchStub)).toBeGreaterThan(readsBefore);
		});
	});

	it('failure → role="alert" inline error NAMING the failed step (the EventConvertError step feeds {step}); form stays OPEN, NO re-read', async () => {
		convertEventToSeriesMock.mockRejectedValue(
			Object.assign(new Error('convertEventToSeries: link-event failed — HTTP 500'), {
				name: 'EventConvertError',
				step: 'link-event',
				seriesId: 'series-orphan-1'
			})
		);
		const { container, fetchStub } = renderEventPage(editorEvent());
		await openConvertForm(container);
		const readsBefore = eventGets(fetchStub);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('event_convert_failed');
		expect(error.textContent).toContain('link-event');

		expect(q(container, 'event-convert-form')).not.toBeNull();
		expect(eventGets(fetchStub)).toBe(readsBefore);
	});

	it('the COLLECTIVE lookup rejecting names "resolve-collective", never a conversion step that did not run', async () => {
		resolveDatabaseEntityIdMock.mockRejectedValue(new Error('HTTP 401'));
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('event_convert_failed');
		expect(error.textContent).toContain('resolve-collective');
		expect(error.textContent).not.toContain('read-event');
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});

	it('an UNRESOLVABLE collective (null, no throw) names the same stage', async () => {
		resolveDatabaseEntityIdMock.mockResolvedValue(null);
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('resolve-collective');
		expect(error.textContent).not.toContain('read-event');
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});

	it('a rejection carrying NO step names "unknown" — never the choreography’s first step by default', async () => {
		convertEventToSeriesMock.mockRejectedValue(new Error('boom'));
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('unknown');
		expect(error.textContent).not.toContain('read-event');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 — the converted event actually REPEATS: the occurrence loop, stop, resume
// ═════════════════════════════════════════════════════════════════════════════

/** The event's own date is 2027-04-18 (Tallinn 21:00); with interval 7 and an
 *  end date of 2027-06-30 the cadence lands on 11 dates, of which the FIRST is
 *  the converted event itself — 10 further occurrences are written. */
const FURTHER_OCCURRENCE_UTC = [
	'2027-04-25T18:00:00.000Z',
	'2027-05-02T18:00:00.000Z',
	'2027-05-09T18:00:00.000Z',
	'2027-05-16T18:00:00.000Z',
	'2027-05-23T18:00:00.000Z',
	'2027-05-30T18:00:00.000Z',
	'2027-06-06T18:00:00.000Z',
	'2027-06-13T18:00:00.000Z',
	'2027-06-20T18:00:00.000Z',
	'2027-06-27T18:00:00.000Z'
];

describe('#313 — the occurrence loop relocates intact', () => {
	it('creates one event per further occurrence, serially, each carrying the new series and the EVENT’S own type; the converted event itself is NOT re-created', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(FURTHER_OCCURRENCE_UTC.length);
		});
		// Full shape on the first occurrence — an `objectContaining` here would
		// hide exactly the wire-shape bugs this loop can produce.
		expect(createEventMock).toHaveBeenNthCalledWith(1, CFG, {
			dbEntityId: ORG_EFK,
			seriesId: 'series-new-9',
			extraParentIds: ['season-1'],
			eventType: 'concert',
			startDatetime: FURTHER_OCCURRENCE_UTC[0]
		});
		expect(
			createEventMock.mock.calls.map((call) => (call[1] as { startDatetime: string }).startDatetime)
		).toEqual(FURTHER_OCCURRENCE_UTC);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
	});

	it('a typed interval no named pattern can express (every 10 days) is honoured', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fillAndSubmitConvert(container, { interval: '10', endDate: '2027-05-08' });

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(2);
		});
		expect(
			createEventMock.mock.calls.map((call) => (call[1] as { startDatetime: string }).startDatetime)
		).toEqual(['2027-04-28T18:00:00.000Z', '2027-05-08T18:00:00.000Z']);
		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
	});

	it('an event with NO event_type is refused BEFORE any write, saying why — nothing to resume, nothing stranded', async () => {
		convertEventToSeriesMock.mockRejectedValue(
			Object.assign(
				new Error(
					'convertEventToSeries: read-event failed — event has no event_type — an event_series with no event_type violates v4E'
				),
				{ name: 'EventConvertError', step: 'read-event', reason: 'missing-event-type' }
			)
		);
		const { container, fetchStub } = renderEventPage(editorEvent());
		await openConvertForm(container);
		const readsBefore = eventGets(fetchStub);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.textContent).toContain('event_convert_missing_type');
		// NOT the "series was created, the run stopped" copy — nothing was created.
		expect(error.textContent).not.toContain('event_convert_generate_failed');
		expect(error.textContent).not.toContain('event_convert_failed');
		expect(q(container, 'event-convert-resume-notice')).toBeNull();
		expect(createEventMock).not.toHaveBeenCalled();
		// Nothing changed, so nothing is refreshed, and the form stays open.
		expect(eventGets(fetchStub)).toBe(readsBefore);
		expect(q(container, 'event-convert-form')).not.toBeNull();
	});

	it('a NAMELESS event is refused the same way, with its own reason', async () => {
		convertEventToSeriesMock.mockRejectedValue(
			Object.assign(new Error('convertEventToSeries: read-event failed — event has no name'), {
				name: 'EventConvertError',
				step: 'read-event',
				reason: 'missing-name'
			})
		);
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		expect((q(container, 'event-convert-error') as HTMLElement).textContent).toContain(
			'event_convert_missing_name'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('an occurrence failure STOPS the run, says how far it got, keeps the form open with a resume notice, does NOT re-read the event — and a re-submit FINISHES it instead of converting a second time', async () => {
		createEventMock.mockResolvedValueOnce('ev-new-1').mockRejectedValueOnce(new Error('HTTP 500'));
		const { container, fetchStub } = renderEventPage(editorEvent());
		await openConvertForm(container);
		const readsBefore = eventGets(fetchStub);

		await fillAndSubmitConvert(container);

		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});
		const error = q(container, 'event-convert-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('event_convert_generate_failed');
		expect(error.textContent).toContain('"created":1');
		expect(error.textContent).toContain('"total":10');
		// The form is still on screen with what the run still owes — and the
		// event is deliberately NOT re-read: a refresh would show seriesId set,
		// unmount this region, and eat the ONLY record of the unfinished run
		// (the relocation of the panel's "standalone list not re-read" pin).
		expect(q(container, 'event-convert-form')).not.toBeNull();
		expect(q(container, 'event-convert-resume-notice')?.textContent).toContain('"remaining":9');
		expect(eventGets(fetchStub)).toBe(readsBefore);

		createEventMock.mockResolvedValue('ev-new-n');
		await fireEvent.click(q(container, 'event-convert-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		// Re-converting would leave a duplicate series behind — the resume path
		// must not call the conversion again.
		expect(convertEventToSeriesMock).toHaveBeenCalledTimes(1);
		// 1 landed + 1 failed + 9 on the resume run = 11 attempts, 10 occurrences.
		expect(createEventMock).toHaveBeenCalledTimes(11);
		expect(
			createEventMock.mock.calls
				.slice(2)
				.map((call) => (call[1] as { startDatetime: string }).startDatetime)
		).toEqual(FURTHER_OCCURRENCE_UTC.slice(1));
		// The run genuinely finished — NOW the world refreshes.
		await waitFor(() => {
			expect(eventGets(fetchStub)).toBeGreaterThan(readsBefore);
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 5 — validation before any write, naming the field (relocated intact)
// ═════════════════════════════════════════════════════════════════════════════

describe('#313 — conversion form validation: refused BEFORE any write, naming the box', () => {
	const cases: Array<
		[string, { duration?: string; endDate?: string; interval?: string }, string, string]
	> = [
		['a blank duration', { duration: '' }, 'event_convert_duration_required', 'event-convert-duration'],
		['a zero duration', { duration: '0' }, 'event_convert_duration_required', 'event-convert-duration'],
		['a blank end date', { endDate: '' }, 'event_convert_end_required', 'event-convert-end-date'],
		[
			'an end date BEFORE the event’s own date',
			{ endDate: '2027-01-01' },
			'event_convert_end_before_start',
			'event-convert-end-date'
		],
		['a blank interval', { interval: '' }, 'event_convert_interval_required', 'event-convert-interval'],
		['an interval below 1', { interval: '0' }, 'event_convert_interval_required', 'event-convert-interval']
	];

	it.each(cases)(
		'%s → refused with its OWN message, the field marked invalid and described by it; NOTHING is written',
		async (_label, over, expectedKey, fieldTestid) => {
			const { container } = renderEventPage(editorEvent());
			await openConvertForm(container);

			await fillAndSubmitConvert(container, over);

			await waitFor(() => {
				expect(q(container, 'event-convert-error')).not.toBeNull();
			});
			const error = q(container, 'event-convert-error') as HTMLElement;
			expect(error.textContent).toContain(expectedKey);
			// NOT the "(read-event)" failure copy for a step that never ran.
			expect(error.textContent).not.toContain('event_convert_failed');
			expect(error.id).toBe('event-convert-error');

			const field = q(container, fieldTestid) as HTMLElement;
			expect(field.getAttribute('aria-invalid')).toBe('true');
			expect(field.getAttribute('aria-describedby')).toBe('event-convert-error');

			expect(convertEventToSeriesMock).not.toHaveBeenCalled();
			expect(createEventMock).not.toHaveBeenCalled();
		}
	);

	it('typing in a refused field clears the message, so a retry is not read against the old complaint', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);
		await fillAndSubmitConvert(container, { duration: '' });
		await waitFor(() => {
			expect(q(container, 'event-convert-error')).not.toBeNull();
		});

		await fill(container, 'event-convert-duration', '90');
		await waitFor(() => {
			expect(q(container, 'event-convert-error')).toBeNull();
		});
		expect(
			(q(container, 'event-convert-duration') as HTMLElement).getAttribute('aria-invalid')
		).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 — the dialog contract (relocated: no panel around it any more)
// ═════════════════════════════════════════════════════════════════════════════

describe('#313 — the conversion form as a dialog on the event page', () => {
	it('takes focus when it opens — a role="dialog" nothing is focused inside promises a container that is not there', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'event-convert-form'));
		});
		expect((q(container, 'event-convert-form') as HTMLElement).getAttribute('tabindex')).toBe(
			'-1'
		);
	});

	it('Escape dismisses the form, writes NOTHING, and hands focus back to the entry control', async () => {
		const { container } = renderEventPage(editorEvent());
		await openConvertForm(container);

		await fireEvent.keyDown(q(container, 'event-convert-form') as HTMLElement, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'event-convert-form')).toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'event-detail-convert'));
		});
		expect(convertEventToSeriesMock).not.toHaveBeenCalled();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 7 — i18n: the new entry key exists; the hint stops pointing at the panel
// ═════════════════════════════════════════════════════════════════════════════

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

function messages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('#313 — i18n: event_detail_convert present and non-empty in all four locales', () => {
	it.each(LOCALES)('%s carries the key, non-empty', (locale) => {
		expect(
			isMessageEmpty(messages(locale)['event_detail_convert']),
			`messages/${locale}.json: event_detail_convert`
		).toBe(false);
	});
});

describe('#313 — event_create_series_hint no longer sends people to the season panel', () => {
	// The rewritten copy is Comenius's; what is PINNED is that no locale keeps
	// pointing at a surface that no longer offers convert. Stems, not full
	// phrases, so inflection cannot dodge the pin.
	const FORBIDDEN: Record<(typeof LOCALES)[number], string> = {
		en: 'season panel',
		et: 'hooaja paneel',
		lv: 'sezonas panel',
		uk: 'панел'
	};

	it.each(LOCALES)('%s: the hint exists, non-empty, and never names the season panel', (locale) => {
		const value = messages(locale)['event_create_series_hint'];
		expect(isMessageEmpty(value), `messages/${locale}.json: event_create_series_hint`).toBe(false);
		for (const pattern of messagePatterns(value)) {
			expect(
				pattern.toLowerCase(),
				`messages/${locale}.json: event_create_series_hint still points at the season panel`
			).not.toContain(FORBIDDEN[locale]);
		}
	});
});

// (*MVOX:Tallis* — #313 RED: convert relocates to the event page — isEditor
// gate (standalone + season, fail closed), the #196/#212 form/validation/
// occurrence/resume/dialog contract unchanged with the page's own detail as
// its season source, success = re-read, occurrence failure = no re-read,
// event_detail_convert key, event_create_series_hint re-pointed)
