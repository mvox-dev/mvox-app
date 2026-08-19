// @vitest-environment happy-dom
//
// T4.8/#28 RED — "not shown as a member anywhere until the domain name is filled."
// RECON A proved the ONLY surface presenting the current user AS a member is the
// enabled RSVP control (S1) on the agenda home. This spec renders the real +page →
// AgendaList → RsvpControl chain and asserts that an INCOMPLETE member (real member
// id, but no domain name → completionGateStore !== 'complete') is NOT presented as a
// member: her control stays disabled and — crucially — she is NEVER mislabeled a
// non-member (no "Only members can RSVP" hint; she is a member, just incomplete).
//
// RED: +page.svelte does not yet consume completionGateStore, so a member with an
// incomplete gate is wrongly shown the ENABLED control — the load-bearing
// suppression assertions FAIL until GREEN folds the gate into `gatedMembership`.
// Template: page.rsvp-membership.spec.ts.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
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

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
// ...and the page resolves management rights per season/event on every load.
// Only that ONE call is stubbed (the pure helpers and the write functions stay
// real): left alone it issues a live request per agenda event, which is both a
// network call from a unit test and a source of teardown AbortErrors. The
// management surface itself is covered end-to-end in
// page.repertoire-manage-wiring.spec.ts.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
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
	listMyAttendance: vi.fn().mockResolvedValue([]),
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
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';

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
	authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'person-p' }, expMs: Date.now() + 100_000 });
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('+page — completion gate suppresses S1 (the member RSVP affordance)', () => {
	it('an INCOMPLETE member (real member id, gate incomplete) is NOT shown as a member: control disabled AND no non-member hint (never mislabeled)', async () => {
		loadFullAgendaMock.mockResolvedValue({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] });
		findMyMemberIdMock.mockResolvedValue('member-1'); // she IS an active member
		listMyRsvpsMock.mockResolvedValue([]);
		completionGateStore.set('incomplete'); // ...but her domain name is missing
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await vi.waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		// Let membership resolution + Svelte reactivity fully settle (a macrotask flushes
		// all pending microtasks/effects), so we test the RESOLVED state, not a loading tick.
		await new Promise((r) => setTimeout(r, 0));

		const btn = goingButton(container)!;
		expect(btn.disabled).toBe(true); // S1 must NOT light for an incomplete member
		expect(container.textContent).not.toContain('Only members can RSVP.'); // she is a member, not a non-member
	});

	it('a COMPLETE member (gate complete) IS shown as a member: control enabled (the release path)', async () => {
		loadFullAgendaMock.mockResolvedValue({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] });
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		const btn = await waitForGoingButton(container);
		await waitFor(() => expect(btn.disabled).toBe(false));
		expect(container.textContent).not.toContain('Only members can RSVP.');
	});

	it('a member with the gate still LOADING is disabled with NO hint (no flash of the member affordance)', async () => {
		loadFullAgendaMock.mockResolvedValue({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] });
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
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

	it('a GENUINE non-member is unaffected by the gate: disabled + the non-member hint (no over-reach)', async () => {
		loadFullAgendaMock.mockResolvedValue({ seasons: [], upcoming: [EVENT], recent: [], seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] });
		findMyMemberIdMock.mockResolvedValue(null); // confirmed non-member
		listMyRsvpsMock.mockResolvedValue([]);
		completionGateStore.set('complete');
		setAuthedWithOneCollective();

		const { container } = render(Page);
		await waitForGoingButton(container);
		await waitFor(() => expect(container.textContent).toContain('Only members can RSVP.'));
		expect(goingButton(container)!.disabled).toBe(true);
	});
});

// (*MVOX:Tallis*)
