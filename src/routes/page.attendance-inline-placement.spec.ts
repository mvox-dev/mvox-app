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
import {
	createAttendanceMock,
	listAllRsvpsForEventMock,
	listAttendanceMock
} from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	agendaItem,
	cleanupResetAttendanceMocks,
	panelInRow,
	rowSelector,
	setAuthedWithOneCollective
} from '$lib/testing/pages/agendaAttendance';

function setThreeConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [
			{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] },
			{ ...agendaItem('past-2', '2026-06-03T16:00:00.000Z', []), editors: ['person-p'] },
			{ ...agendaItem('past-3', '2026-05-27T16:00:00.000Z', []), editors: ['person-p'] }
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], // seat inherited season-wide — all three rows conducted
		seasonOwners: [],
		seasonEditors: []
	}));
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
	]));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([
		{ rsvpId: 'r1', memberId: 'm1', status: 'going' } // m2 deliberately absent — no answer
	]);
	setAuthedWithOneCollective('person-p');
}

async function renderPageWithRecentRows() {
	setThreeConductedRecentEventsFixture();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector(rowSelector('past-1'))).not.toBeNull();
	});
	return container;
}

async function openPanelOnRow(container: HTMLElement, eventId: string) {
	const btn = container.querySelector(
		`${rowSelector(eventId)} [data-testid="take-attendance-btn"]`
	);
	expect(btn).not.toBeNull();
	await fireEvent.click(btn!);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
	});
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(cleanupResetAttendanceMocks);

describe('+page — the attendance panel opens INSIDE the tapped event row (#87)', () => {
	it("tapping 'Take attendance' on the TOP recent row renders the panel inside THAT row — not below the whole agenda", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();

		const panel = container.querySelector('[data-testid="attendance-panel"]')!;
		const owningRow = panel.closest('[data-testid^="agenda-recent-row-"]');
		expect(owningRow).not.toBeNull();
		expect(owningRow!.getAttribute('data-testid')).toBe('agenda-recent-row-past-1');
	});

	it("the panel renders where the 'Take attendance' button was, in the same row — #112/#1 hides that button while its own panel is open, so the panel is what the conductor now sees in its place", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		const row = container.querySelector(rowSelector('past-1'))!;
		const btn = row.querySelector('[data-testid="take-attendance-btn"]');
		const panel = row.querySelector('[data-testid="attendance-panel"]');
		expect(btn).toBeNull();
		expect(panel).not.toBeNull();
	});

	it('opening a SECOND event closes the first panel — exactly one panel, inside the newly tapped row', async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();

		await fireEvent.click(
			container.querySelector(`${rowSelector('past-3')} [data-testid="take-attendance-btn"]`)!
		);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-3'))).not.toBeNull();
		});

		expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		expect(container.querySelectorAll('[data-testid="attendance-panel"]')).toHaveLength(1);
	});

	it('the relocated panel still renders the member list with P/A/L toggles and the RSVP comparison — scoped INSIDE the row', async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-2');

		await waitFor(() => {
			expect(
				container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-row-m1"]`)
			).not.toBeNull();
		});
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-row-m2"]`)
		).not.toBeNull();
		for (const memberId of ['m1', 'm2']) {
			for (const status of ['present', 'absent', 'late']) {
				expect(
					container.querySelector(
						`${panelInRow('past-2')} [data-testid="attendance-toggle-${memberId}-${status}"]`
					)
				).not.toBeNull();
			}
		}
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-rsvp-m1"]`)!
				.textContent
		).toContain('Going');
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-rsvp-m2"]`)!
				.textContent
		).toContain('No answer');

		createAttendanceMock.mockResolvedValue('new-att-1');
		await fireEvent.click(
			container.querySelector(
				`${panelInRow('past-2')} [data-testid="attendance-toggle-m1-present"]`
			)!
		);
		await waitFor(() => {
			expect(createAttendanceMock).toHaveBeenCalledTimes(1);
		});
		expect(createAttendanceMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ eventId: 'past-2', memberId: 'm1', status: 'present' })
		);
	});
});

// (*MVOX:Tallis*)
