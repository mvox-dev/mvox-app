// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	listAttendanceMock,
	listAllRsvpsForEventMock
} = vi.hoisted(() => ({
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));

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
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
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
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { setAuthedWithOneCollective } from '$lib/testing/pages/agendaAttendance';
import { agendaItem } from '$lib/testing/pages/agenda';

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	resetTypeIdCache();
	resetAppState();
	resetGate();
});

function setConductedRecentFixture() {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z'), editors: ['person-p'] }],
			seasonId: 's1',
			seasonConductors: ['person-p'],
			seasonOwners: [],
			seasonEditors: []
		})
	);
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

async function openAttendancePanel(container: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
	});
	return container.querySelector('[data-testid="attendance-panel"]') as HTMLElement;
}

describe('#469 — the AGENDA obeys roster_show_real_names (supersedes the #269 roster-only ruling)', () => {
	it('toggle ON: the attendance panel names members by their REAL names — the profile names appear nowhere in it', async () => {
		realNamesWire();
		setConductedRecentFixture();
		const { container } = render(Page);
		const panel = await openAttendancePanel(container);

		await waitFor(() => {
			const text = panel.textContent ?? '';
			expect(text).toContain(REAL_NAMES.m1);
			expect(text).toContain(REAL_NAMES.m2);
		});
		const text = panel.textContent ?? '';
		expect(text).not.toContain(PROFILE_NAMES.m1);
		expect(text).not.toContain(PROFILE_NAMES.m2);
	});

	it('toggle ON: ONE roster_show_real_names read and ONE admin_member_record read across the whole load + panel open — getRoster is one read, the overlay rides it', async () => {
		const fetchMock = realNamesWire();
		setConductedRecentFixture();
		const { container } = render(Page);
		const panel = await openAttendancePanel(container);
		await waitFor(() => {
			expect(panel.textContent ?? '').toContain(REAL_NAMES.m1);
		});

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(urls.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
	});

	it('toggle OFF: profile names everywhere, the record names appear nowhere on the agenda, ZERO admin_member_record requests — and the toggle itself IS read (once): off is an answer, not a skipped ask', async () => {
		const fetchMock = realNamesWire({ toggle: false });
		setConductedRecentFixture();
		const { container } = render(Page);
		const panel = await openAttendancePanel(container);

		const text = panel.textContent ?? '';
		expect(text).toContain(PROFILE_NAMES.m1);
		expect(text).toContain(PROFILE_NAMES.m2);
		expect(container.textContent).not.toContain(REAL_NAMES.m1);
		expect(container.textContent).not.toContain(REAL_NAMES.m2);

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
	});
});

// (*MVOX:Palestrina* — #269 review F1/F2: agenda scope fence)
// (*MVOX:Tallis* — #469 RED: fence flipped to the conditional contract)
