// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceListsOverRealModule(importOriginal)
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { realNamesWire, PROFILE_NAMES, REAL_NAMES } from '$lib/testing/realNamesFence';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import {
	listAllRsvpsForEventMock,
	listAttendanceMock,
	listMyAttendanceMock
} from '$lib/testing/mocks/events';
import { agendaItem } from '$lib/testing/pages/agenda';
import { setAuthedWithOneCollective } from '$lib/testing/pages/agendaAttendance';

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
