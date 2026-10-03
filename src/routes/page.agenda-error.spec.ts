// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (params: { minutes: number }) => `${params.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params: { weeks: number }) => `In ${params.weeks} weeks`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		agenda_view_toggle_label: () => 'Agenda view',
		agenda_view_list: () => 'List',
		agenda_view_month: () => 'Month',
		agenda_filter_empty: () => 'No events match this filter.',
		agenda_switch_collective: () => 'Switch collective'
	})
);

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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
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

vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function setAuthedWithOneCollective() {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }] });
}

function setAuthedWithTwoCollectives() {
	signIn({ collectives: [{ db: 'org-a', name: 'Org A', personId: 'p1' }, { db: 'org-b', name: 'Org B', personId: 'p1' }] });
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	resetAppState();
});

describe('+page — agenda load error + retry (M2)', () => {
	it('surfaces an error + retry affordance on rejection, instead of a permanent skeleton', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(new Error('network down'));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-skeleton"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-error"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="agenda-retry"]')).not.toBeNull();
	});

	it('retry re-invokes loadAgenda and recovers on success', async () => {
		loadFullAgendaMock.mockRejectedValueOnce(new Error('network down'));
		loadFullAgendaMock.mockResolvedValueOnce(fullAgendaResult({ seasons: [], upcoming: [], recent: [], seasonId: null, seasonConductors: [] }));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		const retryBtn = await waitFor(() => {
			const btn = container.querySelector('[data-testid="agenda-retry"]');
			expect(btn).not.toBeNull();
			return btn as HTMLButtonElement;
		});

		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
	});

	it('a later successful load is not clobbered by a stale rejection (requestId guard)', async () => {
		let rejectFirst!: (err: Error) => void;
		loadFullAgendaMock.mockImplementationOnce(
			() => new Promise((_resolve, reject) => { rejectFirst = reject; })
		);
		loadFullAgendaMock.mockResolvedValueOnce(fullAgendaResult({ seasons: [], upcoming: [], recent: [], seasonId: null, seasonConductors: [] }));
		setAuthedWithTwoCollectives();
		const { container } = render(Page);

		selectedCollectiveDbStore.set('org-b');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
		});

		rejectFirst(new Error('stale'));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.querySelector('[data-testid="agenda-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="agenda-empty"]')).not.toBeNull();
	});
});

// (*MVOX:Byrd*)
