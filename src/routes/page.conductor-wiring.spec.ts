// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		agenda_view_toggle_label: () => 'Agenda view',
		agenda_view_list: () => 'List',
		agenda_view_month: () => 'Month',
		agenda_filter_empty: () => 'No events match this filter.',
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
	})
);

const { loadFullAgendaMock, findMyMemberIdMock, listMyRsvpsMock } =
	vi.hoisted(() => ({
		loadFullAgendaMock: vi.fn(),
		findMyMemberIdMock: vi.fn(),
		listMyRsvpsMock: vi.fn()
	}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
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
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare', byMember: 'records' })
);

vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId }] });
	completionGateStore.set('complete');
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
	resetGate();
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
		const recentEvent = { ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] };
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

// (*MVOX:Josquin*)
