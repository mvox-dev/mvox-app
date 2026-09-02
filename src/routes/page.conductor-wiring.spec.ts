// @vitest-environment happy-dom
//
// #83 review fix — route-level test for the conductor data flow: loadFullAgenda
// returns recent items + seasonConductors, and the page wires them into AgendaList
// as recentItems + conductorEventIds. Prior route specs all returned
// `recent: [], seasonConductors: [], seasonOwners: [], seasonEditors: []`, leaving this wire untested.
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
		agenda_filter_empty: () => 'No events match this filter.',
		// #101 TE.1 -- every agenda row now carries an event-detail link.
		agenda_row_link_label: (p: { event: string }) => `View details for ${p.event}`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		agenda_recent: () => 'Recent',
		agenda_take_attendance: () => 'Take attendance',
		agenda_take_attendance_label: (p: { event: string }) => `Take attendance for ${p.event}`,
		// #85 TA.4 — the recent-row attendance badge + season summary render
		// unconditionally whenever the Recent section renders, so this file's
		// fixtures (which all populate `recent`) need these keys too.
		attendance_group_label: (p: { name: string }) => `Attendance for ${p.name}`,
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_toggle_aria_label: (p: { name: string; status: string }) => `Mark ${p.name} as ${p.status}`,
		attendance_season_summary: () => 'This season',
		attendance_season_rate: (p: { attended: number; total: number }) =>
			`Attended ${p.attended} of ${p.total} events`,
		attendance_member_rate: (p: { attended: number; total: number }) => `${p.attended} of ${p.total}`,
		attendance_all_members: () => 'All members'
	}
}));

const { loadFullAgendaMock, discoverMock, gotoMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
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
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { get } from 'svelte/store';
import { isConductor, resetConductor } from '$lib/attendance/conductorStore';

function agendaItem(
	id: string,
	startDatetime: string,
	conductors: string[] = []
): {
	id: string;
	name: string;
	startDatetime: string;
	durationMinutes: number;
	location: string;
	conductors: string[];
	owners: string[];
	editors: string[];
} {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors,
		owners: [],
		editors: []
	};
}

function setAuthedWithOneCollective(personId = 'person-p') {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: personId },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	completionGateStore.set('complete');
}

// Safe defaults so unrelated resolve calls don't hang.
findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
	resetConductor();
});

describe('+page — recent items reach AgendaList (#83 conductor wiring)', () => {
	it('renders the Recent section with recent items from loadFullAgenda', async () => {
		const recentEvent = agendaItem('past-1', '2026-06-10T16:00:00.000Z');
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [recentEvent],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="agenda-recent-row-past-1"]')
		).not.toBeNull();
	});

	it('renders no Recent section when loadFullAgenda returns empty recent', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [agendaItem('up-1', '2026-09-10T16:00:00.000Z')],
			recent: [],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-list"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-recent"]')).toBeNull();
	});
});

describe('+page — conductorEventIds reach AgendaList (#83 conductor wiring)', () => {
	it('a conductor sees the Recent section with their conducted events identified', async () => {
		// person-p is in the season conductors, and the event inherits (empty conductors)
		const recentEvent = agendaItem('past-1', '2026-06-10T16:00:00.000Z', []);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [recentEvent],
			seasonId: 's1',
			seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective('person-p');
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		// #84 TA.3 — +page.svelte now wires ontakeattendance, so the button that was
		// deliberately gated absent here in TA.2 (handler not yet wired) is now
		// present for a conductor. See page.attendance-panel.spec.ts for the full
		// expand-flow coverage this handler now drives.
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
	});

	it('a non-conductor sees recent rows but no attendance button, conductorEventIds is empty', async () => {
		const recentEvent = agendaItem('past-1', '2026-06-10T16:00:00.000Z', []);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [recentEvent],
			seasonId: 's1',
			seasonConductors: ['other-person'], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective('person-p');
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
	});
});

describe('+page — isConductor store reflects the broader signal (#83 signal shape fix)', () => {
	it('sets isConductor to "conductor" when person is in seasonConductors, even with no past events', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [agendaItem('up-1', '2026-09-10T16:00:00.000Z')],
			recent: [], // no past events yet
			seasonId: 's1',
			seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective('person-p');
		render(Page);

		await waitFor(() => {
			expect(get(isConductor)).toBe('conductor');
		});
	});

	it('sets isConductor to "not-conductor" when person is NOT in seasonConductors and has no conducted events', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [agendaItem('up-1', '2026-09-10T16:00:00.000Z')],
			recent: [],
			seasonId: 's1',
			seasonConductors: ['other-person'], seasonOwners: [], seasonEditors: []
		}));
		setAuthedWithOneCollective('person-p');
		render(Page);

		await waitFor(() => {
			// Need to wait for the load to complete
			expect(loadFullAgendaMock).toHaveBeenCalled();
		});
		// Give the .then() a tick to execute
		await new Promise((r) => setTimeout(r, 0));
		expect(get(isConductor)).toBe('not-conductor');
	});

	it('sets isConductor to "conductor" via conducted past events (per-event ids.size > 0)', async () => {
		const recentEvent = agendaItem('past-1', '2026-06-10T16:00:00.000Z', []);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [recentEvent],
			seasonId: 's1',
			seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] // person conducts all events (inherit)
		}));
		setAuthedWithOneCollective('person-p');
		render(Page);

		await waitFor(() => {
			expect(get(isConductor)).toBe('conductor');
		});
	});
});

// (*MVOX:Josquin*)
