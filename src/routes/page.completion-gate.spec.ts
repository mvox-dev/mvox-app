// @vitest-environment happy-dom
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
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

vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
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
	resetAppState();
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
			expect(container.textContent).not.toContain('Only members can RSVP.');
		});
	}
});

// (*MVOX:Tallis*)
