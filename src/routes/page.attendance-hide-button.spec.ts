// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/agendaCopy')).agendaMessages()
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
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/mocks/events')).attendanceHandlesModule({ lists: true, writes: true, mine: 'empty' })
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
import { listAllRsvpsForEventMock, listAttendanceMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	agendaItem,
	cleanupResetAttendanceMocks,
	panelInRow,
	rowSelector,
	setAuthedWithOneCollective
} from '$lib/testing/pages/agendaAttendance';

function setTwoConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [
			{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] },
			{ ...agendaItem('past-2', '2026-06-03T16:00:00.000Z', []), editors: ['person-p'] }
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], // seat inherited season-wide — both rows conducted
		seasonOwners: [],
		seasonEditors: []
	}));
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
	]));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

const buttonInRow = (eventId: string) =>
	`${rowSelector(eventId)} [data-testid="take-attendance-btn"]`;

async function renderPageWithRecentRows() {
	setTwoConductedRecentEventsFixture();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector(rowSelector('past-1'))).not.toBeNull();
	});
	return container;
}

async function openPanelOnRow(container: HTMLElement, eventId: string) {
	const btn = container.querySelector(buttonInRow(eventId));
	expect(btn).not.toBeNull();
	await fireEvent.click(btn!);
	await waitFor(() => {
		expect(container.querySelector(panelInRow(eventId))).not.toBeNull();
	});
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(cleanupResetAttendanceMocks);

describe("+page — the 'Take attendance' button hides while its panel is open (#112/#1)", () => {
	it('with every panel CLOSED, each conducted recent row shows its button (guard: the hide must not become a blanket removal)', async () => {
		const container = await renderPageWithRecentRows();

		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);

		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();
		expect(container.querySelector(buttonInRow('past-2'))).not.toBeNull();
	});

	it("opening a row's panel HIDES that row's 'Take attendance' button — the panel replaces the entry point, they never render together", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
	});

	it("the hide is scoped to the OPEN row — the other conducted row keeps its button", async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-1');

		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
		expect(container.querySelector(panelInRow('past-2'))).toBeNull();
		expect(container.querySelector(buttonInRow('past-2'))).not.toBeNull();
	});

	it('closing the panel brings the button back; reopening hides it again — visibility tracks the panel across the full toggle cycle', async () => {
		const container = await renderPageWithRecentRows();

		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();

		await fireEvent.click(
			container.querySelector(
				`${rowSelector('past-1')} [data-testid="attendance-collapse-btn"]`
			)!
		);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		});
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();

		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
	});

	it("switching the panel to a DIFFERENT row restores the first row's button and hides the newly opened row's", async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();

		await fireEvent.click(container.querySelector(buttonInRow('past-2'))!);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-2'))).not.toBeNull();
		});

		expect(container.querySelector(buttonInRow('past-2'))).toBeNull();
		expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();
	});
});

// (*MVOX:Tallis*)
