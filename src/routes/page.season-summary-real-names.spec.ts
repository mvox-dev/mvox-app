// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listAttendanceMock,
	listMyAttendanceMock,
	listAllRsvpsForEventMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: listAttendanceMock,
	listMyAttendance: listMyAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn()
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { realNamesWire, PROFILE_NAMES, REAL_NAMES } from '$lib/testing/realNamesFence';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function agendaItem(id: string, startDatetime: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [] as string[],
		owners: [] as string[],
		editors: [] as string[]
	};
}

function setAuthedWithOneCollective(personId = 'person-p') {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId }] });
	completionGateStore.set('complete');
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [
				agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
				agendaItem('past-2', '2026-06-03T16:00:00.000Z')
			],
			seasonId: 's1',
			seasonConductors: [],
			seasonOwners: ['person-p'],
			seasonEditors: []
		})
	);
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(toListRead([]));
	listAllRsvpsForEventMock.mockResolvedValue([]);
	listAttendanceMock.mockResolvedValue([
		{ attendanceId: 'a1', memberId: 'm1', status: 'present' },
		{ attendanceId: 'a2', memberId: 'm9', status: 'present' }
	]);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetTypeIdCache();
	resetAppState();
	resetGate();
});

async function openSeasonSummary(fetchMock: ReturnType<typeof vi.fn>) {
	const utils = render(Page);
	setAuthedWithOneCollective();
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull()
	);
	const before = fetchMock.mock.calls.length;
	await fireEvent.click(utils.container.querySelector('[data-testid="season-summary-expand"]')!);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull()
	);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="member-rate-inactive-m9"]')).not.toBeNull()
	);
	const panelUrls = (fetchMock.mock.calls as Array<[unknown]>)
		.slice(before)
		.map((c) => String(c[0]));
	const region = utils.container.querySelector(
		'[data-testid="season-summary-members"]'
	) as HTMLElement;
	return { ...utils, region, panelUrls };
}

describe('#469 review F1 — the season-rate table obeys the toggle, in ONE overlay pass', () => {
	it('toggle ON: active AND archived rows show REAL names — no profile name survives in the table', async () => {
		const fetchMock = realNamesWire();
		const { region } = await openSeasonSummary(fetchMock);

		const text = region.textContent ?? '';
		expect(text).toContain(REAL_NAMES.m1);
		expect(text).toContain(REAL_NAMES.m2);
		expect(text).toContain(REAL_NAMES.m9);
		expect(text).not.toContain(PROFILE_NAMES.m1);
		expect(text).not.toContain(PROFILE_NAMES.m2);
		expect(text).not.toContain(PROFILE_NAMES.m9);
	});

	it('toggle OFF: every row shows the profile name, ZERO admin_member_record reads — and the toggle IS read (once)', async () => {
		const fetchMock = realNamesWire({ toggle: false });
		const { region, panelUrls } = await openSeasonSummary(fetchMock);

		const text = region.textContent ?? '';
		expect(text).toContain(PROFILE_NAMES.m1);
		expect(text).toContain(PROFILE_NAMES.m2);
		expect(text).toContain(PROFILE_NAMES.m9);
		expect(text).not.toContain(REAL_NAMES.m1);
		expect(text).not.toContain(REAL_NAMES.m9);

		expect(panelUrls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(panelUrls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
	});

	it('opening the panel costs ONE toggle read and ONE admin_member_record read for the WHOLE table, both halves', async () => {
		const fetchMock = realNamesWire();
		const { panelUrls } = await openSeasonSummary(fetchMock);

		expect(panelUrls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(panelUrls.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
		expect(
			panelUrls.filter((u) => u.includes('_type.string=member') && u.includes('status.string=archived'))
		).toHaveLength(1);
	});
});

// (*MVOX:Palestrina*)

describe('#361 — season-rate table: both row branches mark the member name', () => {
	it('active rows (member-rate-*) and the archived row (member-rate-inactive-*) mark the name once', async () => {
		const fetchMock = realNamesWire();
		const { container } = await openSeasonSummary(fetchMock);
		const active1 = container.querySelector('[data-testid="member-rate-m1"]') as HTMLElement;
		const active2 = container.querySelector('[data-testid="member-rate-m2"]') as HTMLElement;
		const inactive = container.querySelector(
			'[data-testid="member-rate-inactive-m9"]'
		) as HTMLElement;
		expectNameMarkedOnce(active1, REAL_NAMES.m1, 'in the active season-rate row');
		expectNameMarkedOnce(active2, REAL_NAMES.m2, 'in the active season-rate row');
		expectNameMarkedOnce(inactive, REAL_NAMES.m9, 'in the archived season-rate row');
	});
});

// (*MVOX:Tallis*)
