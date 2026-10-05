// @vitest-environment happy-dom
// Event creation on the agenda page: the entry point and its rights gate.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule()
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { gotoMock } from '$lib/testing/routeMocks';
import { loadFullAgendaMock, resolveManageRightsMock } from '$lib/testing/moduleHandles';
import { createEventMock } from '$lib/testing/mocks/events';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import { SEASON_ID, fill, isoDate, openFormFromPanel } from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { agendaResult, useEventCreatePage } from '$lib/testing/pages/eventCreate';

useEventCreatePage();

function lapsedOnlySeasonResult(viewerIsEditor: boolean): ReturnType<typeof agendaResult> {
	return fullAgendaResult({
		seasons: [
			{
				id: 'season-0',
				name: 'Season 2025',
				startDate: isoDate(-300),
				endDate: isoDate(-1),
				conductors: [],
				owners: [],
				editors: viewerIsEditor ? ['person-p'] : []
			}
		]
	});
}

describe('agenda — the event-creation entry point (rights gate — #213: the gear + the panel [+ Event])', () => {
	it('season editor + current season: the season CARD renders (page-level, never inside an agenda row); the page-level event-create is GONE; merely rendering writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();
		const control = q(container, 'season-card-expand') as HTMLElement;
		expect(control.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(control.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it('NON-editor: the card does NOT render — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'season-card-expand')).toBeNull();
		expect(q(container, 'event-create')).toBeNull();
	});

	it('the only season LAPSED yesterday and nothing is queued behind it: the card RENDERS — `manageableSeason` falls back to that season, and it is still where a new event belongs', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(true));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		const databaseEntityProbes = resolveManageRightsMock.mock.calls.filter(
			(c) => c[1] !== 'person-p'
		);
		expect(databaseEntityProbes).toEqual([]);
	});

	it('fail-closed on the same shape: a lapsed-only season the viewer does NOT edit (and no collective-wide grant) still hides the card', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(false));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalledWith(CFG, ORG_EFK, 'person-p');
		});
		expect(q(container, 'season-card-expand')).toBeNull();
	});

	it('an upcoming season hides NEITHER [+ Season] (#261 reopen) NOR the card — the two gates are independent, both rights-driven', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
	});

	it("the PANEL's [+ Event] (T3's season-manage-add-event) opens the SAME form with the panel's season PRE-FILLED and the series options already offered", async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		expect(season.value).toBe(SEASON_ID);

		const series = q(container, 'event-create-series') as HTMLSelectElement;
		expect(series.disabled).toBe(false);
		const values = [...series.querySelectorAll('option')].map((o) => o.value);
		expect(values).toEqual(['', 'series-1', 'series-2']);

		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fill(container, 'event-create-name', 'Doomed draft');

		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
