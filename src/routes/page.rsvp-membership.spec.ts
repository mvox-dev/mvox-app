// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
		rsvp_non_member_hint: () => 'Only members can RSVP.',
		rsvp_save_failed: () => 'Could not save your answer.'
	})
);

const {
	loadFullAgendaMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	applyRsvpChangeMock,
	resolveManageRightsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	applyRsvpChangeMock: vi.fn(),
	resolveManageRightsMock: vi.fn()
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
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
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
vi.mock('$lib/rsvp/rsvpOptimistic', () => ({ applyRsvpChange: applyRsvpChangeMock }));

vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
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

vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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
	signIn();
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
	resetAppState();
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

		await waitFor(() => {
			expect(btn.disabled).toBe(false);
		});
		expect(container.textContent).not.toContain('Only members can RSVP.');

		expect(
			resolveManageRightsMock.mock.calls.some(
				(c) => (c[0] as { db?: string })?.db === 'sampledb' && c[1] === 'person-p' && c[2] === 'person-p'
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

		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-non-member-hint"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="rsvp-control"]')).toBeNull();
	});

	it('an ACTIVE member without the grant sees NO control and NO hint — the #369 trap', async () => {
		loadFullAgendaMock.mockResolvedValue(AGENDA());
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		setAuthedWithOneCollective();

		const { container } = render(Page);

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

		await waitFor(() => expect(findMyMemberIdMock).toHaveBeenCalled());
		await Promise.resolve();
		await Promise.resolve();

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

		await waitFor(() => {
			expect(container.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(container.textContent).toContain('Could not save your answer.');
		const goingAfter = container.querySelector('[data-testid="rsvp-btn-going"]');
		expect(goingAfter?.getAttribute('aria-pressed')).toBe('false');
	});
});

// (*MVOX:Tallis*)
