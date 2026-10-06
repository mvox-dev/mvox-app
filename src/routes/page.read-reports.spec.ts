// @vitest-environment happy-dom
// #756: the agenda's season panel and event-create form report each failed read.
import 'fake-indexeddb/auto';
import { fireEvent, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule()
);
vi.mock('$lib/seasons/seasonManage', async () => {
	const seasons = await import('$lib/testing/mocks/seasons');
	return { ...seasons.seasonManageModule(), ...seasons.seasonManageWritesModule({ deleteEvent: false }) };
});
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import {
	countSeasonScopeMock,
	countSeriesOccurrencesMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { armSeasonDelete, openFormFromPanel, selectValue } from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { useEventCreatePage } from '$lib/testing/pages/eventCreate';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { reportProblem } from '$lib/testing/mocks/session';

useEventCreatePage();
beforeEach(() => reportProblem.mockReset());

const boom = new Error('read broke');
// The harness leaves other reads unwired; only the read under test is asserted.
const reportsOf = (action: string) =>
	reportProblem.mock.calls.filter(([problem]) => problem.action === action);

async function armSeriesDelete(container: HTMLElement): Promise<void> {
	listEventSeriesForSeasonMock.mockResolvedValue({
		items: [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] }],
		truncated: false
	});
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-series-delete-series-1')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
}

describe('agenda page reports a failed read (#756)', () => {
	it.each([
		{
			read: "the season's event series",
			fail: () => listEventSeriesForSeasonMock.mockRejectedValue(boom),
			run: openSeasonCardPanel,
			action: "loading the season's event series"
		},
		{
			read: 'the season delete scope',
			fail: () => countSeasonScopeMock.mockRejectedValue(boom),
			run: armSeasonDelete,
			action: 'counting what the season delete removes'
		},
		{
			read: 'the series occurrences',
			fail: () => countSeriesOccurrencesMock.mockRejectedValue(boom),
			run: armSeriesDelete,
			action: 'counting the series occurrences'
		},
		{
			read: 'the series options',
			fail: () => listSeriesOptionsForSeasonMock.mockRejectedValue(boom),
			run: openFormFromPanel,
			action: 'loading the series options'
		},
		{
			read: 'the series defaults',
			fail: () => getSeriesDefaultsMock.mockRejectedValue(boom),
			run: async (container: HTMLElement) => {
				await openFormFromPanel(container);
				await selectValue(container, 'event-create-series', 'series-1');
			},
			action: 'loading the series defaults'
		}
	])('a failed read of $read is reported', async ({ fail, run, action }) => {
		fail();
		const container = await renderReady();
		await run(container);
		await waitFor(() => {
			expect(reportsOf(action)).toEqual([[{ area: 'agenda', action, error: boom }]]);
		});
	});
});
