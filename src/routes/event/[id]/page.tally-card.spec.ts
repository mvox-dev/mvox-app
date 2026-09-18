// @vitest-environment happy-dom
//
// #344 RED — the RSVP tally line folds out who answered what.
//
// Today `loadTally` (+page.svelte ~:902) reduces the per-person rows from
// `listAllRsvpsForEvent` to COUNTS ONLY ({going,not_going,maybe,late}) and the
// line renders exactly four spans (~:4632-4648). Gama's #344:
//
//   Rida ütleb «12 tuleb · 4 ei tule · 1 võib-olla · 1 hilineb · 7 pole
//   vastanud». Klõps avab kaardi, kus on näha, kes nad on.
//
// Contract pinned here:
//   • FUTURE event: FIVE counts on the line, in ONE order —
//     going · not_going · maybe · late · not_responded — where not_responded =
//     active members minus answerers (#255 doctrine: the future tally joins
//     the ACTIVE roster). PAST event: FOUR counts, no fifth group anywhere —
//     one line must not carry counts on two bases.
//   • The tally line ITSELF is the activator (standing rule 4/4b): a native
//     <button type="button"> wrapping the whole line — Tab-reachability and
//     Enter/Space activation come from the ELEMENT, never hand-rolled
//     handlers; an sr-only child carries the action label, NO aria-label.
//     aria-expanded per repo disclosure convention (RepertoireElement.spec.ts
//     "every disclosure sets aria-expanded").
//   • The card folds out IN PLACE below the line — same section, no new
//     route, no goto. Groups appear in the tally's order; each lists PROFILE
//     names resolved through the app's ONE existing chain (`loadRoster`,
//     rosterData.ts — Henry's 2026-09-06 fence: event pages keep profile
//     names; no RedactedField, no second resolution chain). One roster read
//     per OPEN, never one per row.
//   • The card follows the TALLY's visibility (#363: the tally renders from
//     the read, no rights gate) — a no-grant member gets the card too. With
//     zero rows back, or a rejected read (tallyError), NO card activator
//     renders.
//   • #363/#105 pins survive: [data-testid="event-detail-tally"] keeps
//     aria-live="polite"; page.tally-open-read.spec.ts is untouched.
//
// The page component is rendered whole (real route module, real data layer
// over a wire stub — the RED-forcing integration shape: the card must be
// wired into the actual /event/[id] route, not built in isolation). Spies:
// `listAllRsvpsForEvent` (the rows the card renders) and `loadRoster` (the
// name-resolution chain the card must reuse). `listActiveMembers` stays REAL
// over the wire stub — the future join and the not-responded subtraction run
// against a real active-members read.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NOW pinned between the past fixture's start (2026-08-01) and the future
// fixture's (2026-09-01): the future event joins the active roster (#255 D),
// the past one keeps its raw recorded rows.
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

const { gotoMock, discoverMock, listAllRsvpsForEventMock, loadRosterMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	loadRosterMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
// The tally's rows read is a spy (the card renders ITS rows); everything else
// in attendanceData stays real over the wire stub.
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAllRsvpsForEvent: listAllRsvpsForEventMock
}));
// `loadRoster` is a spy — the card's names MUST come through this one chain
// (called once per open, never per row). `listActiveMembers` and the rest of
// rosterData stay REAL: the future tally join and the not-responded
// subtraction run against the wire stub's active-members read.
vi.mock('$lib/roster/rosterData', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/rosterData')>()),
	loadRoster: loadRosterMock
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

/** Rights props INVISIBLE — the viewer holds NO grant on the event. #344's
 *  card follows #363's gate (the read renders, not rights), so the DEFAULT
 *  fixture is the no-grant member. */
function futureEvent(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-09-01T16:00:00.000Z' }],
		duration_minutes: [{ _id: 'val-dur-1', number: 90 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		_parent: [{ reference: 'org1', entity_type: 'organization' }],
		...over
	};
}

function pastEvent() {
	return futureEvent({
		start_datetime: [{ _id: 'val-start-1', datetime: '2026-08-01T16:00:00.000Z' }]
	});
}

/** 5 answers: 2 going (the viewer's own rsvp-77 among them), 1 not_going,
 *  1 maybe, 1 late. Every memberId is on the 7-member active roster below, so
 *  the future join drops nothing and not_responded = m-6 + m-7 = 2. */
const RSVP_ROWS = [
	{ rsvpId: 'rsvp-77', memberId: 'member-1', status: 'going' },
	{ rsvpId: 'r-2', memberId: 'm-2', status: 'going' },
	{ rsvpId: 'r-3', memberId: 'm-3', status: 'not_going' },
	{ rsvpId: 'r-4', memberId: 'm-4', status: 'maybe' },
	{ rsvpId: 'r-5', memberId: 'm-5', status: 'late' }
] as const;

const ACTIVE_MEMBER_IDS = ['member-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7'] as const;

const ACTIVE_MEMBER_ENTITIES = ACTIVE_MEMBER_IDS.map((id) => ({
	_id: id,
	person: [{ reference: `p-${id}` }]
}));

/** Profile names, one per active member — what `loadRoster` (the app's ONE
 *  resolution chain) resolves. m-6/m-7 answered nothing: the not-responded
 *  names. */
const NAME_BY_MEMBER: Record<string, string> = {
	'member-1': 'Anna Alt',
	'm-2': 'Bruno Bass',
	'm-3': 'Cecilia Cantor',
	'm-4': 'Diana Descant',
	'm-5': 'Erik Echo',
	'm-6': 'Frida Fauxbourdon',
	'm-7': 'Georg Gamba'
};

/** #344 review F1 — the member who has SINCE LEFT. She answered `going` while
 *  she still sang; a past tally shows her answer as recorded (#255 D, no
 *  active-roster join), so the card must name her — and `status.string=active`
 *  can never return her. Only `listInactiveMembers` can. */
const ARCHIVED_MEMBER_ID = 'm-gone';
const ARCHIVED_PERSON_ID = 'p-m-gone';
const ARCHIVED_NAME = 'Helena Hymnal';

const ARCHIVED_MEMBER_ENTITIES = [
	{ _id: ARCHIVED_MEMBER_ID, person: [{ reference: ARCHIVED_PERSON_ID }] }
];

const ROSTER_READ = {
	items: ACTIVE_MEMBER_IDS.map((id) => ({
		memberId: id,
		personId: `p-${id}`,
		name: NAME_BY_MEMBER[id],
		profileName: NAME_BY_MEMBER[id],
		email: `${id}@example.invalid`,
		sectionIds: []
	})),
	total: ACTIVE_MEMBER_IDS.length,
	truncated: false
};

/** The wire behind everything that is NOT spied: the event GET, the viewer's
 *  member lookup, her OWN rsvp, the active-roster read the future-tally join
 *  issues (REAL listActiveMembers), the #372 rsvp enablement read, and the
 *  past event's attendance read (empty). */
function wireStub(event: Record<string, unknown>, opts: { activeMembersCount?: number } = {}) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/')) return json({ deleted: true });
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
			return json(
				// #344 review F2 — `count` > returned entities is the truncation
				// signal `listActiveMembers` reports (see $lib/entu/listRead).
				opts.activeMembersCount === undefined
					? { entities: ACTIVE_MEMBER_ENTITIES }
					: { entities: ACTIVE_MEMBER_ENTITIES, count: opts.activeMembersCount }
			);
		// #344 review F1 — the archived read `loadRosterIncludingArchived` issues
		// on a PAST event, and the domain-tier profile its name resolves through
		// (the SAME listProfilesForPerson + toRosterRow chain loadRoster uses).
		if (url.includes('_type.string=member') && url.includes('status.string=archived'))
			return json({ entities: ARCHIVED_MEMBER_ENTITIES });
		if (url.includes('_type.string=profile') && url.includes(ARCHIVED_PERSON_ID))
			return json({
				entities: [
					{
						_id: 'profile-gone',
						name: [{ string: ARCHIVED_NAME }],
						_sharing: [{ string: 'domain' }]
					}
				]
			});
		if (url.includes('_type.string=rsvp') && url.includes('_parent.reference=p-viewer'))
			return json({
				entities: [{ _id: 'rsvp-77', event: [{ reference: 'ev1' }], status: [{ string: 'going' }] }]
			});
		return json({ entities: [] });
	});
}

function setAuthedWithPolyphony() {
	setToken('jwt-token');
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

beforeEach(() => {
	listAllRsvpsForEventMock.mockResolvedValue([...RSVP_ROWS]);
	loadRosterMock.mockResolvedValue(structuredClone(ROSTER_READ));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.resetAllMocks();
	localStorage.clear();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

function renderPage(event: Record<string, unknown>, opts: { activeMembersCount?: number } = {}) {
	const stub = wireStub(event, opts);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
	return { ...render(Page), fetchStub: stub };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** ONE tally order — line spans and card groups must both follow it. */
const TALLY_ORDER = ['going', 'not_going', 'maybe', 'late', 'not_responded'] as const;

/** Parse the rendered count out of a tally span (mocked messages render
 *  `[event_detail_tally_<status> {"count":N}]`). */
function countOf(el: HTMLElement | null): number {
	const match = el?.textContent?.match(/"count":(\d+)/);
	return match ? Number(match[1]) : NaN;
}

async function openCard(container: HTMLElement): Promise<HTMLElement> {
	const toggle = await waitFor(() => {
		const t = q(container, 'event-detail-tally-toggle');
		expect(t, 'tally line activator not rendered').not.toBeNull();
		return t!;
	});
	await fireEvent.click(toggle);
	await waitFor(() => {
		expect(q(container, 'event-detail-tally-card'), 'card did not fold out').not.toBeNull();
	});
	return toggle;
}

// ── 1. future event: FIVE counts, one order ──────────────────────────────────

describe('#344 — future event, plain member: the line carries five counts', () => {
	it('renders going · not_going · maybe · late · not_responded, full shape, from the rows + active-members fixtures', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
			expect(
				q(container, 'event-detail-tally-not_responded'),
				'fifth count (not responded) missing from the line'
			).not.toBeNull();
		});
		// Full shape, real subtraction: 7 active members − 5 answerers = 2.
		const counts = Object.fromEntries(
			TALLY_ORDER.map((s) => [s, countOf(q(container, `event-detail-tally-${s}`))])
		);
		expect(counts).toEqual({ going: 2, not_going: 1, maybe: 1, late: 1, not_responded: 2 });
		// ONE order on the line — the same order the card's groups must follow.
		const text = q(container, 'event-detail-tally')!.textContent!;
		const indices = TALLY_ORDER.map((s) => text.indexOf(`[event_detail_tally_${s} `));
		for (const [i, s] of TALLY_ORDER.entries()) {
			expect(indices[i], `${s} not rendered on the line`).toBeGreaterThanOrEqual(0);
		}
		expect([...indices].sort((a, b) => a - b)).toEqual(indices);
	});
});

// ── 2. past event: FOUR counts, no fifth group anywhere ──────────────────────

describe('#344 — past event: four counts, no not-responded group', () => {
	it('renders no fifth span on the line and no not-responded group in the card', async () => {
		const { container } = renderPage(pastEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(
			q(container, 'event-detail-tally-not_responded'),
			'a past tally must not grow a fifth count'
		).toBeNull();
		// Raw recorded rows, unjoined (#255): 2/1/1/1.
		expect(countOf(q(container, 'event-detail-tally-going'))).toBe(2);
		expect(countOf(q(container, 'event-detail-tally-late'))).toBe(1);
		await openCard(container);
		expect(
			q(container, 'event-detail-tally-card-group-not_responded'),
			'a past card must not carry a not-responded group'
		).toBeNull();
		const groups = Array.from(
			container.querySelectorAll('[data-testid^="event-detail-tally-card-group-"]')
		).map((el) => el.getAttribute('data-testid'));
		expect(groups).toEqual([
			'event-detail-tally-card-group-going',
			'event-detail-tally-card-group-not_going',
			'event-detail-tally-card-group-maybe',
			'event-detail-tally-card-group-late'
		]);
	});
});

// ── 3. the line is the activator; the card folds out in place ────────────────

describe('#344 — the whole tally line activates the card (rule 4/4b)', () => {
	it('the activator is a native <button type="button"> wrapping the whole line, sr-only label, NO aria-label', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await waitFor(() => {
			const t = q(container, 'event-detail-tally-toggle');
			expect(t).not.toBeNull();
			return t!;
		});
		// Native element — Enter/Space activation and Tab-reachability come from
		// the tag, never a hand-rolled div+onclick (rule 4b reference:
		// admin/+page.svelte collective name field).
		expect(toggle.tagName).toBe('BUTTON');
		expect(toggle.getAttribute('type')).toBe('button');
		// WHOLE line: every count span lives inside the activator.
		for (const s of TALLY_ORDER) {
			expect(
				toggle.contains(q(container, `event-detail-tally-${s}`)),
				`${s} span outside the activator — the whole line must be tappable`
			).toBe(true);
		}
		// sr-only action label, not aria-label (rule 4 reference pattern).
		expect(toggle.getAttribute('aria-label')).toBeNull();
		const srOnly = toggle.querySelector('.sr-only');
		expect(srOnly, 'sr-only action label missing on the activator').not.toBeNull();
		// #344 review F1 — the label must name THIS object. The home page's
		// season-card keys were reused here at first, so a screen reader on an
		// event page heard "… 7 not responded, Open season card" in all four
		// locales. Pinned to the dedicated keys so the reuse cannot come back.
		expect(srOnly!.textContent?.trim()).toBe('[event_detail_tally_card_expand_label]');
		// Disclosure convention: aria-expanded, closed by default, no card yet.
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(q(container, 'event-detail-tally-card')).toBeNull();
	});

	it('click folds the card out below the line, aria-expanded flips, focus stays on the activator; second click folds in', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await waitFor(() => {
			const t = q(container, 'event-detail-tally-toggle');
			expect(t).not.toBeNull();
			return t!;
		});
		toggle.focus();
		await fireEvent.click(toggle);
		const card = await waitFor(() => {
			const c = q(container, 'event-detail-tally-card');
			expect(c).not.toBeNull();
			return c!;
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		// #344 review F1 — open state swaps to the card's OWN collapse label.
		expect(toggle.querySelector('.sr-only')!.textContent?.trim()).toBe(
			'[event_detail_tally_card_collapse_label]'
		);
		// IN PLACE, below the line: same rsvp section, after the tally in DOM
		// order — not a dialog, not a portal, not another page.
		const section = q(container, 'event-detail-rsvp')!;
		expect(section.contains(card)).toBe(true);
		const tallyEl = q(container, 'event-detail-tally')!;
		expect(
			Boolean(tallyEl.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING),
			'card must fold out BELOW the tally line'
		).toBe(true);
		// Focus never leaves the activator on open.
		expect(document.activeElement).toBe(toggle);
		// Second tap folds in.
		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card')).toBeNull();
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(toggle);
	});

	it('keyboard activation: the click a native button synthesizes from Enter/Space (detail 0) toggles the card', async () => {
		// happy-dom does not emulate UA keyboard activation of native buttons
		// (probed 2026-09-18: keydown/keyup Enter and Space synthesize NO click),
		// and a hand-rolled keydown handler would DOUBLE-activate in a real
		// browser. The native guarantee is pinned structurally above (tagName
		// BUTTON, type=button); here we drive the detail:0 click that guarantee
		// produces for Enter and for Space.
		const { container } = renderPage(futureEvent());
		const toggle = await waitFor(() => {
			const t = q(container, 'event-detail-tally-toggle');
			expect(t).not.toBeNull();
			return t!;
		});
		toggle.focus();
		// Enter → click(detail 0): opens.
		await fireEvent.click(toggle, { detail: 0 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card')).not.toBeNull();
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(toggle);
		// Space → click(detail 0): closes.
		await fireEvent.click(toggle, { detail: 0 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card')).toBeNull();
		});
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});
});

// ── 4. who is who: groups, names, and the ONE resolution chain ───────────────

describe('#344 — the card lists profile names per group, resolved once per open', () => {
	it('groups follow the tally order and carry the names from loadRoster', async () => {
		const { container } = renderPage(futureEvent());
		await openCard(container);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card-group-not_responded')).not.toBeNull();
		});
		const groups = Array.from(
			container.querySelectorAll('[data-testid^="event-detail-tally-card-group-"]')
		).map((el) => el.getAttribute('data-testid'));
		expect(groups).toEqual(TALLY_ORDER.map((s) => `event-detail-tally-card-group-${s}`));
		// Group headers speak the status (rsvp_status_* keys; the fifth is NEW).
		for (const s of TALLY_ORDER) {
			expect(q(container, `event-detail-tally-card-group-${s}`)!.textContent).toContain(
				`[rsvp_status_${s}]`
			);
		}
		// Names, group by group — profile names through the app's ONE chain.
		const expectNames = (testid: string, names: string[]) => {
			const el = q(container, testid)!;
			for (const n of names) {
				expect(el.textContent, `${n} missing from ${testid}`).toContain(n);
			}
		};
		expectNames('event-detail-tally-card-group-going', ['Anna Alt', 'Bruno Bass']);
		expectNames('event-detail-tally-card-group-not_going', ['Cecilia Cantor']);
		expectNames('event-detail-tally-card-group-maybe', ['Diana Descant']);
		expectNames('event-detail-tally-card-group-late', ['Erik Echo']);
		// Not responded = ACTIVE members minus answerers, same name chain.
		expectNames('event-detail-tally-card-group-not_responded', [
			'Frida Fauxbourdon',
			'Georg Gamba'
		]);
		// …and a non-answerer never leaks into an answer group.
		expect(q(container, 'event-detail-tally-card-group-going')!.textContent).not.toContain(
			'Frida'
		);
	});

	it('loadRoster runs ZERO times before the card opens, exactly ONCE per open — never once per row', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		// The line's counts need no name read.
		expect(loadRosterMock).not.toHaveBeenCalled();
		await openCard(container);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card-group-not_responded')).not.toBeNull();
		});
		// Seven names on screen, ONE roster read.
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(loadRosterMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'polyphony' }));
	});
});

// ── 5. the card is visible exactly where the tally is ────────────────────────

describe("#344 — the card follows the tally's own visibility (#363 gate)", () => {
	it('a plain member with NO grant on the event gets the activator and the card', async () => {
		// futureEvent() carries no _owner/_editor — this IS the no-grant fixture;
		// the whole suite runs on it, this case states the gate out loud.
		const { container } = renderPage(futureEvent());
		const toggle = await openCard(container);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});

	// #344 review F4 — a FUTURE event nobody has answered yet is exactly when
	// "who is who" is asked: the conductor reading "0 going … 7 not responded"
	// wants those seven names so she can chase them. Keying the activator off
	// the RAW rsvp row count made the fifth number the one count on the line
	// that could not be opened.
	it('zero rows back on a FUTURE event → the activator renders and the card carries the not-responded names', async () => {
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(countOf(q(container, 'event-detail-tally-not_responded'))).toBe(7);
		await openCard(container);
		const group = await waitFor(() => {
			const g = q(container, 'event-detail-tally-card-group-not_responded');
			expect(g, 'the not-responded group must be reachable with zero answers').not.toBeNull();
			expect(g!.querySelector('li'), 'names not resolved').not.toBeNull();
			return g!;
		});
		for (const name of Object.values(NAME_BY_MEMBER)) {
			expect(group.textContent, `${name} missing from the not-responded group`).toContain(name);
		}
		// The four answer groups render their (zero) headers and no list at all.
		expect(q(container, 'event-detail-tally-card-group-going')!.querySelector('li')).toBeNull();
	});

	it('zero rows back on a PAST event → the tally renders (#363 pin) but NO card activator', async () => {
		// A past tally carries no not-responded group at all (#255 D), so zero
		// rows there really is nothing to fold out.
		listAllRsvpsForEventMock.mockResolvedValue([]);
		const { container } = renderPage(pastEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-toggle')).toBeNull();
		expect(q(container, 'event-detail-tally-card')).toBeNull();
	});

	it('read REJECTS (tallyError) → error line, no tally, no activator, no card', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listAllRsvpsForEventMock.mockRejectedValue(new Error('boom'));
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-error')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally')).toBeNull();
		expect(q(container, 'event-detail-tally-toggle')).toBeNull();
		expect(q(container, 'event-detail-tally-card')).toBeNull();
		errorSpy.mockRestore();
	});
});

// ── 6. no new route ──────────────────────────────────────────────────────────

describe('#344 — the card is a fold-out, not a navigation', () => {
	it('opening the card calls goto ZERO times and the activator is no link', async () => {
		const { container } = renderPage(futureEvent());
		const toggle = await openCard(container);
		expect(gotoMock).not.toHaveBeenCalled();
		expect(toggle.closest('a')).toBeNull();
	});
});

// ── 7. existing pins survive ─────────────────────────────────────────────────

describe('#344 — #105/#363 pins survive the fold-out', () => {
	it('event-detail-tally keeps its testid and aria-live=polite, closed AND open', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally')!.getAttribute('aria-live')).toBe('polite');
		await openCard(container);
		const tallyEl = q(container, 'event-detail-tally');
		expect(tallyEl, 'the tally line must survive the card opening').not.toBeNull();
		expect(tallyEl!.getAttribute('aria-live')).toBe('polite');
	});
});

// ── 8. review fixes: no raw entity id ever reaches the screen ────────────

describe('#344 review F1 — a past card names the member who has since left', () => {
	it('resolves an ARCHIVED answerer through the archived roster, never printing her raw member id', async () => {
		// Her answer stands as recorded (#255 D: no active-roster join on a past
		// tally), so her id is in the going group with no active row to name it.
		listAllRsvpsForEventMock.mockResolvedValue([
			...RSVP_ROWS,
			{ rsvpId: 'r-gone', memberId: ARCHIVED_MEMBER_ID, status: 'going' }
		]);
		const { container } = renderPage(pastEvent());
		await openCard(container);
		const going = await waitFor(() => {
			const g = q(container, 'event-detail-tally-card-group-going')!;
			expect(g.querySelector('li'), 'names not resolved').not.toBeNull();
			return g;
		});
		expect(going.textContent, 'the archived answerer is not named').toContain(ARCHIVED_NAME);
		expect(going.textContent, 'a raw member id reached the screen').not.toContain(
			ARCHIVED_MEMBER_ID
		);
		// The active answerers are still named from the same card.
		expect(going.textContent).toContain('Anna Alt');
	});
});

describe('#344 review F2 — an unresolvable member gets a placeholder, never her id', () => {
	it('an active member the #28 completeness gate dropped renders the translated placeholder', async () => {
		// `loadRoster` drops a member whose profile carries no domain/public
		// name, but `listActiveMembers` still counts her into not_responded.
		loadRosterMock.mockResolvedValue({
			...structuredClone(ROSTER_READ),
			items: structuredClone(ROSTER_READ).items.filter((r) => r.memberId !== 'm-7')
		});
		const { container } = renderPage(futureEvent());
		await openCard(container);
		const group = await waitFor(() => {
			const g = q(container, 'event-detail-tally-card-group-not_responded')!;
			expect(g.querySelector('li')).not.toBeNull();
			return g;
		});
		expect(group.textContent).toContain('Frida Fauxbourdon');
		expect(group.textContent, 'the nameless member is missing from the group').toContain(
			'[event_detail_tally_name_unavailable]'
		);
		expect(group.textContent, 'a raw member id reached the screen').not.toContain('m-7');
	});
});

describe('#344 review F3 — the name read fails LOUDLY, with a retry', () => {
	it('a rejected roster read says so inside the card, shows no names, and the Retry re-reads', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockRejectedValueOnce(new Error('boom'));
		const { container } = renderPage(futureEvent());
		await openCard(container);
		const errorLine = await waitFor(() => {
			const e = q(container, 'event-detail-tally-card-names-error');
			expect(e, 'a failed name read must be said on screen').not.toBeNull();
			return e!;
		});
		expect(errorLine.textContent).toContain('[event_detail_tally_names_error]');
		// No names, and — the point — no raw ids standing in for them.
		expect(container.querySelector('[data-testid="event-detail-tally-card"] li')).toBeNull();
		expect(q(container, 'event-detail-tally-card')!.textContent).not.toContain('member-1');

		loadRosterMock.mockResolvedValue(structuredClone(ROSTER_READ));
		await fireEvent.click(q(container, 'event-detail-tally-card-names-retry')!);
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-card-names-error')).toBeNull();
			expect(q(container, 'event-detail-tally-card-group-going')!.textContent).toContain(
				'Anna Alt'
			);
		});
		errorSpy.mockRestore();
	});

	it('a TRUNCATED active-member read says so NEXT TO THE LINE, card still closed (#344 review F2)', async () => {
		// The fifth count is derived from `listActiveMembers` (limit 500). A short
		// read under-reports it, and the count is on screen BEFORE the card is
		// ever opened — so the notice cannot wait for the card's own name read.
		const { container } = renderPage(futureEvent(), { activeMembersCount: 900 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-not_responded')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-card'), 'card must still be closed').toBeNull();
		const notice = await waitFor(() => {
			const n = q(container, 'event-detail-tally-partial-notice');
			expect(n, 'a truncated member read under-reports the fifth count unsaid').not.toBeNull();
			return n!;
		});
		expect(notice.textContent).toContain('[picker_partial_members_notice]');
	});

	it('an UNtruncated active-member read raises no line notice', async () => {
		const { container } = renderPage(futureEvent());
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-not_responded')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-partial-notice')).toBeNull();
	});

	it('a PAST event carries no line notice — it shows no fifth count to under-report', async () => {
		const { container } = renderPage(pastEvent(), { activeMembersCount: 900 });
		await waitFor(() => {
			expect(q(container, 'event-detail-tally-going')).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-not_responded')).toBeNull();
		expect(q(container, 'event-detail-tally-partial-notice')).toBeNull();
	});

	it('a TRUNCATED member read raises the partial-members notice inside the card (#321)', async () => {
		loadRosterMock.mockResolvedValue({ ...structuredClone(ROSTER_READ), truncated: true });
		const { container } = renderPage(futureEvent());
		await openCard(container);
		await waitFor(() => {
			expect(
				q(container, 'event-detail-tally-card-partial-notice'),
				'a short member read reads as "she is not a member" unless stated'
			).not.toBeNull();
		});
		expect(q(container, 'event-detail-tally-card-partial-notice')!.textContent).toContain(
			'[picker_partial_members_notice]'
		);
	});
});

// (*MVOX:Tallis* — #344 RED)
// (*MVOX:Josquin* — #344 review F1–F4)
