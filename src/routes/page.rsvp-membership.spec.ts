// @vitest-environment happy-dom
//
// Membership as DISPLAY, rights as the GATE (#372), page level. Renders the
// real +page -> AgendaList -> RsvpControl chain (with agenda rows present,
// unlike page.rsvp-wiring which loads an empty agenda). The law (Gama ruling
// on #372): the control's ENABLED state derives from the Entu grant on the
// singer's own person entity (resolveManageRights(cfg, personId, personId) —
// the app's one rights predicate); the membership lookup survives only as
// DISPLAY (the non-member hint) and as the write payload's memberId:
//   - membership 'loading' alone  → decides NOTHING (rights alone enable)
//   - confirmed non-member, no grant → hint SHOWN (display), control NOT rendered
//   - active member, no grant     → NO control, no hint (#369's trap)
//   - membership lookup failure   → no false hint; rights alone decide
//   - a rejected write            → per-row error surfaced + optimistic value reverts
// The wire shape of the rights read itself (GET entity/{personId}?props=
// _owner,_editor) is pinned end-to-end in page.rsvp-rights-gate.spec.ts; here
// the predicate is a controllable spy so each test dials the rights answer.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		// #214 — the filter chip row renders whenever the agenda has any
		// events at all, so its message keys must exist in every mock that
		// renders the real +page.svelte with a non-empty agenda.
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		// #247 — the view toggle sits WITH the filter chips, so it renders
		// whenever the chip row does; same "every mock needs it" rule as #214.
		agenda_view_toggle_label: () => 'Agenda view',
		agenda_view_list: () => 'List',
		agenda_view_month: () => 'Month',
		agenda_filter_empty: () => 'No events match this filter.',
		// #101 TE.1 -- every agenda row now carries an event-detail link.
		agenda_row_link_label: (p: { event: string }) => `View details for ${p.event}`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'Only members can RSVP.',
		rsvp_save_failed: () => 'Could not save your answer.'
	}
}));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	applyRsvpChangeMock,
	resolveManageRightsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	applyRsvpChangeMock: vi.fn(),
	resolveManageRightsMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// #91 TR.3 — +page.svelte now imports the repertoire WRITE layer (and the
// library reads that feed its pickers), which reaches entuFetch ->
// $lib/entu-config -> $env/dynamic/public: unavailable outside a SvelteKit
// request context under happy-dom. Same one-line fix the library/profile specs
// already use; the real modules keep running, only the base url is stubbed.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
// ...and the page resolves management rights per season/event on every load.
// Only that ONE call is stubbed (the pure helpers and the write functions stay
// real): left alone it issues a live request per agenda event, which is both a
// network call from a unit test and a source of teardown AbortErrors. The
// management surface itself is covered end-to-end in
// page.repertoire-manage-wiring.spec.ts.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	// #372 — resolveManageRights is now ALSO the rsvp enablement primitive
	// (called with (cfg, personId, personId)), so each test dials its answer.
	resolveManageRights: resolveManageRightsMock
}));
// #132/T2 review F3 — the agenda's season-CREATE gate falls back to the
// ORGANIZATION's rights when the collective has no season at all (which is this
// fixture: seasonId null + seasons []). Stubbed to "no visible collective" so the
// fallback is a no-op here instead of a live member lookup from a unit test.
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
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
// The write dispatch — mocked so a "write" can be made to reject on demand.
vi.mock('$lib/rsvp/rsvpOptimistic', () => ({ applyRsvpChange: applyRsvpChangeMock }));

// #84 — +page.svelte now also imports $lib/roster/rosterData and
// $lib/attendance/attendanceData at module scope (the "Take attendance" panel
// wiring), both of which pull in $lib/entu/request -> $env/dynamic/public —
// same $env wall as rsvpData above. This spec doesn't exercise attendance
// behavior, just needs the import to resolve cleanly.
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	// #85 TA.4 — +page.svelte now also calls listMyAttendance as soon as
	// findMyMemberId resolves an id (not just on demand): a missing mock here
	// throws inside the .then chain, which the outer .catch swallows by
	// resetting memberId/membership — silently breaking THIS spec's member
	// assertions even though it never exercises attendance itself.
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
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

// #90 TR.2 — the page now resolves each row's Works element and signs PDFs on
// click. Mocked here for the same reason agendaData/rsvpData are: both modules
// pull in $lib/entu/request -> $env/dynamic/public, which is unavailable
// outside a SvelteKit request context under happy-dom (and neither belongs in
// these specs' subject).
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';

const EVENT = {
	id: 'e1',
	name: 'Rehearsal e1',
	startDatetime: '2026-06-15T09:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
};

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	// T4.8/#28 — the home page now folds the completion gate into the membership value
	// (gatedMembership): a member is only shown the ENABLED control once the gate is
	// 'complete'. This spec exercises the membership 3-state, so establish a complete
	// gate; it is inert for the non-member / loading / fail-safe cases (gatedMembership
	// only diverges when membership === 'member').
	completionGateStore.set('complete');
}

async function waitForGoingButton(container: HTMLElement) {
	return waitFor(() => {
		const btn = container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	applyRsvpChangeMock.mockReset();
	resolveManageRightsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
});

describe('+page — membership is display, the Entu grant is the gate (#372)', () => {
	const AGENDA = () =>
		fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] });

	it("membership 'loading' alone never disables OR enables: the grant says editor while the member lookup hangs -> ENABLED", async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockReturnValue(new Promise(() => {})); // never resolves
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);

		// Enabled on the grant alone — membership had no say (it never resolved).
		await waitFor(() => {
			expect(btn.disabled).toBe(false);
		});
		expect(container.textContent).not.toContain('Only members can RSVP.');

		// The enablement question was asked of the app's ONE rights predicate,
		// against the entity the write targets: her own person, as herself.
		expect(
			resolveManageRightsMock.mock.calls.some(
				(c) => (c[0] as { db?: string })?.db === 'polyphony' && c[1] === 'person-p' && c[2] === 'person-p'
			)
		).toBe(true);
	});

	it('a CONFIRMED non-member without the grant: the hint STAYS (display) and the control is NOT rendered — two separate facts', async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockResolvedValue(null);
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);

		// Fact 1 — the membership DISPLAY survives: the hint shows.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		// Fact 2 — no grant, so no write-inviting control renders at all
		// (not disabled — absent).
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	it('an ACTIVE member without the grant sees NO control and NO hint — the #369 trap', async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);

		// Let both answers land: member (display) + not-editor (gate).
		await waitFor(() => {
			expect(
				resolveManageRightsMock.mock.calls.some((c) => c[1] === 'person-p' && c[2] === 'person-p')
			).toBe(true);
		});
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
		expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).toBeNull();
	});

	it('a membership lookup FAILURE shows no false hint — and the grant alone still ENABLES', async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockRejectedValue(new Error('lookup boom'));
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);

		// Let the rejection settle so we're testing the FAILED state, not merely
		// the initial loading tick.
		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

		// The write is permitted (Entu said so); the display fails safe (no hint).
		await waitFor(() => {
			expect(btn.disabled).toBe(false);
		});
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});
});

describe('+page — write-failure feedback (a rejected rsvp save)', () => {
	it('a rejected write surfaces a per-row save-failed error AND reverts the optimistic value', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor'); // #372 — the grant enables the tap
		applyRsvpChangeMock.mockRejectedValue(new Error('save failed'));
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const goingBtn = await waitForGoingButton(container);
		await waitFor(() => expect(goingBtn.disabled).toBe(false));

		await fireEvent.click(goingBtn);

		// The error line appears...
		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(container.textContent).toContain('Could not save your answer.');
		// ...and the optimistic "going" is rolled back (no longer the active answer).
		const goingAfter = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(goingAfter?.getAttribute('aria-pressed')).toBe('false');
	});
});

// (*MVOX:Tallis*)
