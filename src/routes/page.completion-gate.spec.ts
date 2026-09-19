// @vitest-environment happy-dom
//
// T4.8/#28 — "not shown as a member anywhere until the domain name is filled."
// RECON A proved the ONLY surface presenting the current user AS a member is the
// enabled RSVP control (S1) on the agenda home. This spec renders the real +page →
// AgendaList → RsvpControl chain and asserts that an INCOMPLETE member (real grant
// on her own person, but no domain name → completionGateStore !== 'complete') is
// NOT presented as a member: her control stays disabled and — crucially — she is
// NEVER mislabeled a non-member (no "Only members can RSVP" hint; she is a member,
// just incomplete).
//
// #372 (issue #362 paradigm) update: the control's own gate moved from membership
// to the Entu grant (resolveManageRights(cfg, personId, personId) — see
// page.rsvp-membership.spec.ts / page.rsvp-rights-gate.spec.ts). The completion
// gate folds into THAT rights state now (`gatedCanRsvp` in +page.svelte), not into
// membership — this file dials `resolveManageRightsMock` per test to isolate the
// gate's own suppression from the grant question.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
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
	resolveManageRightsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
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
// ...and the page resolves management rights per season/event on every load,
// AND (#372) the agenda's rsvp enablement itself — resolveManageRights(cfg,
// personId, personId). Only that ONE call is stubbed (the pure helpers and
// the write functions stay real): left alone it issues a live request per
// agenda event, which is both a network call from a unit test and a source of
// teardown AbortErrors. The management surface itself is covered end-to-end
// in page.repertoire-manage-wiring.spec.ts; each test below dials its own
// rsvp-rights answer via `resolveManageRightsMock`.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
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
	authStore.set({ status: 'authenticated', personIdByDb: { sampledb: 'person-p' }, expMs: Date.now() + 100_000 });
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

function goingButton(container: HTMLElement) {
	return container.querySelector('[data-testid="rsvp-btn-going"]') as HTMLButtonElement | null;
}
async function waitForGoingButton(container: HTMLElement) {
	return waitFor(() => {
		const btn = goingButton(container);
		expect(btn).not.toBeNull();
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	resolveManageRightsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('+page — completion gate suppresses S1 (the member RSVP affordance)', () => {
	it('an INCOMPLETE member (real grant, gate incomplete) is NOT shown as a member: control disabled AND no non-member hint (never mislabeled)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1'); // she IS an active member
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor'); // #372 — she HAS the grant
		completionGateStore.set('incomplete'); // ...but her domain name is missing
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await vi.waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		// Let membership/rights resolution + Svelte reactivity fully settle (a
		// macrotask flushes all pending microtasks/effects), so we test the
		// RESOLVED state, not a loading tick.
		await new Promise((r) => setTimeout(r, 0));

		const btn = goingButton(container)!;
		expect(btn.disabled).toBe(true); // S1 must NOT light for an incomplete member
		expect(container.textContent).not.toContain('Only members can RSVP.'); // she is a member, not a non-member
	});

	it('a COMPLETE member (gate complete) IS shown as a member: control enabled (the release path)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);
		await waitFor(() => expect(btn.disabled).toBe(false));
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a member with the gate still LOADING is disabled with NO hint (no flash of the member affordance)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		completionGateStore.set('loading');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await vi.waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));

		const btn = goingButton(container)!;
		expect(btn.disabled).toBe(true);
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	// #372 — a genuine non-member's write capability is no longer decided by
	// membership at all: it follows whatever grant `resolveManageRights`
	// answers for her (mocked here as 'not-editor', the realistic shape for
	// someone with no roster row and no direct grant on her own person). The
	// completion gate is complete, so this test isolates the OTHER suppression
	// (#369's shape: no control, not a disabled one) from the gate's own.
	it('a GENUINE non-member with no grant is unaffected by the (complete) gate: the hint shows, NO control renders (no over-reach)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
		findMyMemberIdMock.mockResolvedValue(null); // confirmed non-member
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitFor(() => expect(container.textContent).toContain('Only members can RSVP.'));
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	// #372 review F2 — `gatedCanRsvp` folds the gate into the RIGHTS primitive,
	// and that fold may only DOWNGRADE a positive answer. Unconditional, it
	// UPGRADED a confirmed 'not-editor' to 'loading', which renders a DISABLED
	// control where the ruling says none may render at all. Not a one-tick
	// window either: resolveGate fails safe to 'loading' FOREVER on a failed read
	// (no-flash discipline), so a no-grant singer sat with a dead four-button
	// strip indefinitely. Both non-'complete' gate values are pinned; the subject
	// is an ACTIVE member (#369's shape) so the non-member hint branch cannot be
	// what suppresses the control.
	for (const gate of ['incomplete', 'loading'] as const) {
		it(`F2: gate='${gate}' must not resurrect a control for a CONFIRMED no-grant member — nothing renders`, async () => {
			loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] }));
			findMyMemberIdMock.mockResolvedValue('member-1'); // active member, no grant
			listMyRsvpsMock.mockResolvedValue(toListRead([]));
			resolveManageRightsMock.mockResolvedValue('not-editor');
			completionGateStore.set(gate);
			setAuthedWithOneCollective();

			const { container } = render(Page);
			await vi.waitFor(() => expect(resolveManageRightsMock).toHaveBeenCalled());
			await new Promise((r) => setTimeout(r, 0));

			expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
			expect(goingButton(container)).toBeNull();
			// ...and she is still not mislabeled a non-member: she IS one.
			expect(container.textContent).not.toContain('Only members can RSVP.');
		});
	}
});

// (*MVOX:Tallis*)
