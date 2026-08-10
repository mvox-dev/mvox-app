// @vitest-environment happy-dom
//
// #12 — the data-loading half of the RSVP wiring: once the agenda resolves,
// the page must also resolve the singer's member id and existing rsvps (#10/
// #11's read primitives) so RsvpControl (once Byrd wires it into AgendaList)
// has its initial state. Not testing the click/optimistic-write path here —
// that needs the full RsvpControl-in-AgendaList chain that doesn't exist until
// GREEN; see rsvpOptimistic.spec.ts for the write-dispatch unit coverage and
// RsvpControl.spec.ts / AgendaList.spec.ts for the presentational + prop-wiring
// contracts.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (params: { minutes: number }) => `${params.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params: { weeks: number }) => `${params.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry'
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
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// #12 — mocked so the assertions below observe whether the page calls them, not
// a live network. Full replacement (not `importOriginal` spread): the real
// rsvpData.ts imports $lib/entu/request -> $env/dynamic/public, which doesn't
// resolve under happy-dom (same $env wall as discover.ts elsewhere) — spreading
// importOriginal() still evaluates that real module graph and hits it.
// rsvpsByEventId is reimplemented inline (pure, no $env) since the page calls
// it directly on listMyRsvps' resolution.
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
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+page — resolves member id + existing rsvps alongside the agenda (#12 data half)', () => {
	it('calls findMyMemberId with {db,token} for the selected collective and the selected person id', async () => {
		loadFullAgendaMock.mockResolvedValue({ upcoming: [], recent: [], seasonId: null, seasonConductors: [] });
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(findMyMemberIdMock).toHaveBeenCalled();
		});
		expect(findMyMemberIdMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, 'person-p');
	});

	it('calls listMyRsvps with {db,token} for the selected collective and the selected person id', async () => {
		loadFullAgendaMock.mockResolvedValue({ upcoming: [], recent: [], seasonId: null, seasonConductors: [] });
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		render(Page);

		await vi.waitFor(() => {
			expect(listMyRsvpsMock).toHaveBeenCalled();
		});
		expect(listMyRsvpsMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, 'person-p');
	});
});

// (*MVOX:Tallis*)
