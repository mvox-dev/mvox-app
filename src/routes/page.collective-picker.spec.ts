// @vitest-environment happy-dom
//
// #338 RED — the collective picker moves INTO the agenda header; the separate
// /collectives page dies (its route-death guard is src/no-collectives-route.spec.ts).
//
// Contract (issue #338, Gama):
//
// - pickerMode === 'picker' (2+ collectives): the header's collective NAME
//   becomes a native, CLASSED <select> — the picker's display face. It keeps
//   data-testid="selected-collective" (bullet: "keep the testid on whatever
//   renders the name" — in picker mode the select renders it, which also keeps
//   page.agenda-partial-notice.spec.ts:281 honest: a select's textContent
//   contains its options' labels). Options are the collectives (label = name,
//   value = db), value = the selected db, aria-label = m.agenda_switch_collective()
//   — the KEY survives #338, the <a href="/collectives"> it labelled does not.
// - Changing the select drives the REAL selectCollective path (store +
//   localStorage + same-pathname goto) — not a bespoke handler: localStorage's
//   'mvox.selected_collective' updates, goto carries ?collective=<db>, and the
//   page re-renders the NEW collective end to end.
// - pickerMode === 'static' (exactly 1): the header renders BYTE-IDENTICAL to
//   today — the plain <p>, no select, no affordance. A one-option picker
//   teaches nothing.
// - collectives.status === 'none': m.agenda_collectives_none() renders as
//   TEXT. No navigation anywhere — the page it pointed at no longer exists.
// - collectives.status === 'error': a native, CLASSED retry <button>
//   (data-testid="collectives-retry", label m.agenda_collectives_error_retry())
//   that RE-FIRES collective discovery — asserted at the store boundary:
//   hydrateCollectives is mocked here, everything else in the store is real.
//   The state also NAMES the dbs that could not be checked, through the NEW
//   single-param key m.agenda_collectives_error_dbs({ dbs }) with the list
//   joined ', ' at the call site — the deleted page's own
//   "Some collectives could not be checked ({dbs})" fact, kept (#321 family).
// - Switch hygiene (done-when bullet 5): the switch is driven through the
//   ACTUAL select (component event, not bare store.set). A→B leaves nothing
//   of A on screen; A→B→A stays clean AND re-delivers A's own facts fresh —
//   the truncation notice earned by A's read reappears from A's SECOND read,
//   proving the switch-generation counters survive in-place double switches.
//
// Research fact this suite leans on: no agenda switch guard is
// remount-dependent — every reset fires from the store-value $effect — so the
// header-driven switch exercises the identical path the /collectives page did.
//
// Harness mirrors page.agenda-partial-notice.spec.ts (the standing agenda-page
// spec for the rsvp/attendance loads); messages are key-echo WITH params so
// the parameterized-key assertion binds DOM to key AND call-site join.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { msgProxy } = vi.hoisted(() => ({
	msgProxy: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_t, key) => (params?: Record<string, unknown>) =>
			params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/messages.js', () => ({ m: msgProxy }));
vi.mock('$lib/paraglide/messages', () => ({ m: msgProxy }));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listMyAttendanceMock,
	hydrateCollectivesMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	hydrateCollectivesMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
// The store boundary: hydrateCollectives is the ONE mocked export — the retry
// contract is "re-fire collective discovery through the store's own entry
// point", not a page-local re-implementation. Everything else (the stores,
// selectCollective, pickerModeStore) stays REAL: the picker tests drive the
// actual selection path.
vi.mock('$lib/collectives/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/collectives/store')>()),
	hydrateCollectives: hydrateCollectivesMock
}));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Full replacement (not importOriginal spread) — same $env wall as
// page.rsvp-wiring.spec.ts documents. rsvpsByEventId reimplemented inline.
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: (rsvps: Array<{ rsvpId: string; eventId: string; status: string }>) => {
		const map: Record<string, { rsvpId: string; status: string }> = {};
		for (const r of rsvps) map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
		return map;
	},
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: listMyAttendanceMock,
	listAllRsvpsForEvent: vi.fn(),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: (
		records: Array<{ attendanceId: string; memberId: string; status: string }>
	) => {
		const map: Record<string, { attendanceId: string; status: string }> = {};
		for (const r of records) map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
		return map;
	}
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { get } from 'svelte/store';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const DB_A = 'polyphony';
const DB_B = 'orlando';
const SELECTED_KEY = 'mvox.selected_collective';

function complete<T>(items: T[]) {
	return { items, total: items.length, truncated: false };
}
function truncated<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function agendaEvent(id: string, name: string) {
	return {
		id,
		name,
		startDatetime: future,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

/** One distinct agenda per collective, keyed off the REAL selection store. */
function installAgendaPerDb() {
	loadFullAgendaMock.mockImplementation(async () =>
		fullAgendaResult(
			get(selectedCollectiveDbStore) === DB_B
				? { upcoming: [agendaEvent('or-ev', 'Orlando rehearsal')] }
				: { upcoming: [agendaEvent('pv-ev', 'Polyphony rehearsal')] }
		)
	);
}

/** A's own-rsvp read TRUNCATED (earns rsvp-partial-notice), B's complete. */
function installRsvpReadsPerDb() {
	findMyMemberIdMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === DB_B ? 'member-b' : 'member-a'
	);
	listMyRsvpsMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === DB_A
			? truncated([{ rsvpId: 'rsvp-a', eventId: 'pv-ev', status: 'going' }], 503)
			: complete([])
	);
	listMyAttendanceMock.mockResolvedValue(complete([]));
}

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB_A]: 'person-p', [DB_B]: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: DB_A, name: 'Polyphony', personId: 'person-p' },
			{ db: DB_B, name: 'Orlando', personId: 'person-p' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(DB_A);
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB_A]: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: DB_A, name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(DB_A);
}

/** Authenticated, but collective discovery landed on a non-ready status. */
function setAuthedWithStatus(state: { status: 'none' } | { status: 'error'; erroredDbs: string[] } | { status: 'loading' }) {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: {},
		expMs: Date.now() + 100_000
	});
	collectiveState.set(state);
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function headerSelect(container: HTMLElement): HTMLSelectElement | null {
	return container.querySelector<HTMLSelectElement>('select[data-testid="selected-collective"]');
}

async function renderTwoCollectivesReady() {
	installAgendaPerDb();
	installRsvpReadsPerDb();
	setAuthedWithTwoCollectives();
	const rendered = render(Page);
	await waitFor(() => {
		expect(rendered.container.textContent).toContain('Polyphony rehearsal');
	});
	return rendered;
}

/** Drive the switch through the ACTUAL control — component event, not store.set. */
async function switchVia(container: HTMLElement, db: string) {
	const select = headerSelect(container);
	expect(select, 'the header collective <select>').not.toBeNull();
	await fireEvent.change(select!, { target: { value: db } });
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	localStorage.removeItem(SELECTED_KEY);
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

// ── 1. the header picker (pickerMode === 'picker') ──────────────────────────

describe('#338 — header picker with 2+ collectives', () => {
	it('renders a native, classed <select> as the name — options are the collectives, value the selected db; the switch LINK is gone', async () => {
		const { container } = await renderTwoCollectivesReady();

		const select = headerSelect(container);
		expect(select, 'select[data-testid="selected-collective"]').not.toBeNull();

		// The name IS the picker's display face — one element carries the
		// testid, and it is the select (nothing else renders the name beside it).
		expect(container.querySelectorAll('[data-testid="selected-collective"]')).toHaveLength(1);

		// Options = the collectives: label = name, value = db. Value = selected db.
		const options = Array.from(select!.options);
		expect(options.map((o) => o.value)).toEqual([DB_A, DB_B]);
		expect(options.map((o) => o.text.trim())).toEqual(['Polyphony', 'Orlando']);
		expect(select!.value).toBe(DB_A);

		// The i18n key survives its link: it names the control now.
		expect(select!.getAttribute('aria-label')).toBe('[agenda_switch_collective]');

		// #335 — an unclassed control is an invisible control. SOME class,
		// never a specific one (the suite-wide guard enforces the same
		// structurally; this select must not be its first offender).
		expect(select!.getAttribute('class'), 'the select carries a class').toBeTruthy();

		// No navigation to the dead page remains in the header (or anywhere).
		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
	});

	it('changing the select drives the REAL selectCollective path: localStorage, goto ?collective=, and the new collective end to end', async () => {
		const { container } = await renderTwoCollectivesReady();

		await switchVia(container, DB_B);

		await waitFor(() => {
			// The real selectCollective persisted the pick…
			expect(localStorage.getItem(SELECTED_KEY)).toBe(DB_B);
			// …and reflected it into the URL (same-pathname, in-place goto).
			expect(gotoMock).toHaveBeenCalledWith(
				expect.stringContaining('collective=orlando'),
				expect.objectContaining({ keepFocus: true, noScroll: true })
			);
		});

		// The selected-collective flow reflects the NEW name: the select's face…
		await waitFor(() => {
			const select = headerSelect(container)!;
			expect(select.value).toBe(DB_B);
			expect(select.selectedOptions[0]?.text.trim()).toBe('Orlando');
			// …and the page body followed — B's agenda, not A's.
			expect(container.textContent).toContain('Orlando rehearsal');
		});
	});
});

// ── 2. static mode (exactly 1 collective) ───────────────────────────────────

describe('#338 — static mode with exactly one collective', () => {
	it('the header renders the plain name <p> BYTE-IDENTICAL to today — no select, no affordance', async () => {
		installAgendaPerDb();
		installRsvpReadsPerDb();
		setAuthedWithOneCollective();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'selected-collective')).not.toBeNull();
		});

		const name = q(container, 'selected-collective')!;
		// Byte-identical to today's markup — same element, same classes, same text.
		expect(name.outerHTML).toBe(
			'<p class="font-display text-xl text-ink" data-testid="selected-collective">Polyphony</p>'
		);
		// A one-option picker teaches nothing: no select, no link, nothing.
		expect(container.querySelector('select[data-testid="selected-collective"]')).toBeNull();
		expect(container.querySelector('[data-testid="collective-picker"]')).toBeNull();
		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
	});
});

// ── 3. the none state ───────────────────────────────────────────────────────

describe('#338 — collectives status none', () => {
	it('renders m.agenda_collectives_none() as TEXT — no link, no navigation anywhere', async () => {
		setAuthedWithStatus({ status: 'none' });
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.textContent).toContain('[agenda_collectives_none]');
		});
		// The page it linked to is dead: the copy is plain text, and the whole
		// signed-in-without-collective surface carries NO navigation at all.
		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
		expect(container.querySelectorAll('a')).toHaveLength(0);
	});
});

// ── 4. the error state ──────────────────────────────────────────────────────

describe('#338 — collectives status error', () => {
	function setErrored() {
		hydrateCollectivesMock.mockResolvedValue({
			status: 'error',
			erroredDbs: ['alpha-db', 'beta-db']
		});
		setAuthedWithStatus({ status: 'error', erroredDbs: ['alpha-db', 'beta-db'] });
	}

	it('renders a classed retry <button> that re-fires collective discovery through the store', async () => {
		setErrored();
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'collectives-retry')).not.toBeNull();
		});
		const retry = q(container, 'collectives-retry')!;
		// A retry, not a navigation — the link target is gone.
		expect(retry.tagName).toBe('BUTTON');
		expect(retry.getAttribute('class'), 'the retry button carries a class (#335)').toBeTruthy();
		expect(retry.textContent).toContain('[agenda_collectives_error_retry]');
		expect(container.querySelector('a[href="/collectives"]')).toBeNull();
		expect(container.querySelectorAll('a')).toHaveLength(0);

		// Clicking re-invokes the store's OWN discovery entry point.
		expect(hydrateCollectivesMock).not.toHaveBeenCalled();
		await fireEvent.click(retry);
		await waitFor(() => {
			expect(hydrateCollectivesMock).toHaveBeenCalledTimes(1);
		});
	});

	it('names the dbs that could not be checked — the new single-param key, joined at the call site', async () => {
		setErrored();
		const { container } = render(Page);

		// The deleted page's own honest-partial-failure fact, kept: the state
		// says WHICH databases failed, through ONE parameterized key with the
		// list joined ', ' where it is called.
		await waitFor(() => {
			expect(container.textContent).toContain(
				'[agenda_collectives_error_dbs {"dbs":"alpha-db, beta-db"}]'
			);
		});
	});

	// #338 review F4 — `hydrateCollectives` RETHROWS a non-auth discovery failure
	// (store.ts: only auth expiry is settled as 'anonymous'). A bare `void` call
	// made a failed retry an unhandled rejection AND a click with no consequence
	// the viewer can see.
	it('a retry that fails again keeps the error panel standing — no unhandled rejection, button live again', async () => {
		setErrored();
		hydrateCollectivesMock.mockRejectedValue(new Error('discovery down'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'collectives-retry')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'collectives-retry')!);

		await waitFor(() => {
			expect(consoleError).toHaveBeenCalled();
		});
		// The panel still names the same dbs, and the button is clickable again.
		expect(get(collectiveState)).toEqual({ status: 'error', erroredDbs: ['alpha-db', 'beta-db'] });
		expect(container.textContent).toContain(
			'[agenda_collectives_error_dbs {"dbs":"alpha-db, beta-db"}]'
		);
		const retry = q(container, 'collectives-retry') as HTMLButtonElement;
		expect(retry.disabled).toBe(false);

		// …and a second attempt is genuinely re-fired, not swallowed by the guard.
		await fireEvent.click(retry);
		await waitFor(() => {
			expect(hydrateCollectivesMock).toHaveBeenCalledTimes(2);
		});
		consoleError.mockRestore();
	});
});

// ── 5. the loading state (fence — completes the branch coverage) ────────────

describe('#338 — collectives status loading', () => {
	it('renders m.agenda_collectives_loading() as text, with no navigation', async () => {
		setAuthedWithStatus({ status: 'loading' });
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.textContent).toContain('[agenda_collectives_loading]');
		});
		expect(container.querySelectorAll('a')).toHaveLength(0);
	});
});

// ── 6. switch hygiene, driven through the ACTUAL control ────────────────────

describe('#338 — switching via the header select leaves no state behind', () => {
	it('A→B: nothing from A survives on screen — agenda rows and A’s truncation notice are gone', async () => {
		const { container } = await renderTwoCollectivesReady();
		// A's own-rsvp read was truncated: the notice is A's fact, on screen.
		await waitFor(() => {
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
		});

		await switchVia(container, DB_B);

		await waitFor(() => {
			expect(container.textContent).toContain('Orlando rehearsal');
		});
		// No state from A: not its rows, not its notice.
		expect(container.textContent).not.toContain('Polyphony rehearsal');
		expect(q(container, 'rsvp-partial-notice')).toBeNull();
	});

	it('A→B→A: still clean, and A’s facts come back FRESH — generation counters survive in-place double switches', async () => {
		const { container } = await renderTwoCollectivesReady();
		await waitFor(() => {
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
		});

		await switchVia(container, DB_B);
		await waitFor(() => {
			expect(container.textContent).toContain('Orlando rehearsal');
			expect(q(container, 'rsvp-partial-notice')).toBeNull();
		});

		await switchVia(container, DB_A);
		await waitFor(() => {
			expect(container.textContent).toContain('Polyphony rehearsal');
			// A's truncated read ran AGAIN and its notice re-earned its place —
			// a generation counter confused by the round trip would swallow
			// this second delivery (or leave B's absence sticky).
			expect(q(container, 'rsvp-partial-notice')).not.toBeNull();
		});
		expect(container.textContent).not.toContain('Orlando rehearsal');
		expect(headerSelect(container)!.value).toBe(DB_A);
		expect(localStorage.getItem(SELECTED_KEY)).toBe(DB_A);
	});
});

// (*MVOX:Tallis* — #338 RED)
