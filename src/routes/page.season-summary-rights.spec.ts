// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
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
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule({ archived: true, others: 'bare' })
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
import { toListRead } from '$lib/testing/listReadFixtures.js';
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
import { loadActiveAndArchivedRostersMock, loadRosterMock } from '$lib/testing/mocks/roster';
import { agendaItem, cleanupClearResetGate } from '$lib/testing/pages/agendaSummary';
import { setAuthedWithOneCollective } from '$lib/testing/pages/agendaAttendance';

function agendaFixture(overrides: {
	seasonOwners?: string[];
	seasonEditors?: string[];
	seasonConductors?: string[];
}) {
	return fullAgendaResult({
		seasons: [],
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z')
		],
		seasonId: 's1',
		seasonConductors: overrides.seasonConductors ?? [],
		seasonOwners: overrides.seasonOwners ?? [],
		seasonEditors: overrides.seasonEditors ?? []
	});
}

beforeEach(() => {
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(
		toListRead([{ attendanceId: 'a1', eventId: 'past-1', status: 'present' }])
	);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	loadRosterMock.mockResolvedValue(
		toListRead([{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }])
	);
	loadActiveAndArchivedRostersMock.mockResolvedValue({
		active: toListRead([
			{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
		]),
		inactive: toListRead([])
	});
	listAttendanceMock.mockResolvedValue([{ attendanceId: 'x1', memberId: 'm1', status: 'present' }]);
});

afterEach(cleanupClearResetGate);

async function renderWithSummary() {
	const utils = render(Page);
	setAuthedWithOneCollective();
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="season-summary"]')).not.toBeNull()
	);
	return utils;
}

const EXPAND = '[data-testid="season-summary-expand"]';

describe('#365 — the season-summary comparison opens on season rights', () => {
	it('a season OWNER gets the expand affordance, and the comparison opens on click', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaFixture({ seasonOwners: ['person-p'] }));
		const { container } = await renderWithSummary();
		await waitFor(() => expect(container.querySelector(EXPAND)).not.toBeNull());
		await fireEvent.click(container.querySelector(EXPAND)!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull()
		);
	});

	it('a season EDITOR gets the expand affordance', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaFixture({ seasonEditors: ['person-p'] }));
		const { container } = await renderWithSummary();
		await waitFor(() => expect(container.querySelector(EXPAND)).not.toBeNull());
	});

	it('a member with NEITHER grant gets no affordance — the roster comparison is unreachable', async () => {
		loadFullAgendaMock.mockResolvedValue(
			agendaFixture({ seasonOwners: ['someone-else'], seasonEditors: ['other-person'] })
		);
		const { container } = await renderWithSummary();
		expect(container.querySelector(EXPAND)).toBeNull();
		expect(container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});

	it('the conductor SEAT does not count: on the conductor list but holding no grant → NO expand', async () => {
		loadFullAgendaMock.mockResolvedValue(
			agendaFixture({ seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] })
		);
		const { container } = await renderWithSummary();
		expect(container.querySelector(EXPAND)).toBeNull();
	});

	it('no affordance while the agenda (and with it the rights answer) is still loading', async () => {
		loadFullAgendaMock.mockReturnValue(new Promise(() => {}));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		await waitFor(() => expect(loadFullAgendaMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector(EXPAND)).toBeNull();
	});
});

// (*MVOX:Tallis*)
