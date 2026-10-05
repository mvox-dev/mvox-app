// @vitest-environment happy-dom
// Series creation on the agenda page: a season switch takes the form with the panel.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['series', 'event'])
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { CreateEventInput } from '$lib/entity/entityCreate';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock } from '$lib/testing/mocks/events';
import { q } from '$lib/testing/pages/dom';
import {
	SEASON_ID,
	SEASON_START,
	enableMondayGeneration,
	isoDate,
	lastSeriesInput,
	openSeriesForm
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { flush } from '$lib/testing/pages/seasonEventCreate';
import {
	currentSeason,
	fillValidTemplate,
	settleSeriesRun,
	submit,
	useSeriesCreatePage
} from '$lib/testing/pages/seriesCreate';

useSeriesCreatePage();

describe('#277 review F2 — a season switch takes the series form with the panel', () => {
	const SEASON_B_ID = 'season-2';

	function twoSeasonResult() {
		return fullAgendaResult({
			seasons: [
				currentSeason(true),
				{
					id: SEASON_B_ID,
					name: 'Season 2027',
					startDate: isoDate(61),
					endDate: isoDate(240),
					conductors: [],
					owners: [],
					editors: ['person-p']
				}
			]
		});
	}

	function expandButtons(container: HTMLElement): HTMLButtonElement[] {
		return Array.from(
			container.querySelectorAll('[data-testid="season-card-expand"]')
		) as HTMLButtonElement[];
	}

	function expandFor(container: HTMLElement, seasonName: string): HTMLButtonElement | null {
		return expandButtons(container).find((b) => b.textContent?.includes(seasonName)) ?? null;
	}

	it('form open under A, click B’s entry: no form survives under B — and the one re-opened there prefills B’s dates and submits under B', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const container = await renderReady();
		await openSeriesForm(container);
		expect((q(container, 'series-create-from') as HTMLInputElement).value).toBe(SEASON_START);

		await fireEvent.click(expandFor(container, 'Season 2027') as HTMLButtonElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2027');
		});
		expect(q(container, 'series-create-form')).toBeNull();

		await waitFor(() => {
			expect(q(container, 'season-manage-add-series')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).not.toBeNull();
		});
		expect((q(container, 'series-create-from') as HTMLInputElement).value).toBe(isoDate(61));

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await settleSeriesRun(container);

		expect(lastSeriesInput().extraParentIds).toEqual([SEASON_B_ID]);
		for (const call of createEventMock.mock.calls) {
			expect((call[1] as CreateEventInput).extraParentIds).toEqual([SEASON_B_ID]);
		}
	});

	it('a STOPPED run refuses the switch: B’s entry is DISABLED, the panel stays A’s with its resume notice, and the run’s record survives to be finished', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		const bEntry = expandFor(container, 'Season 2027') as HTMLButtonElement;
		expect(bEntry.disabled).toBe(true);
		await fireEvent.click(bEntry);
		await flush();

		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2026');
		expect(q(container, 'series-create-resume')).not.toBeNull();
		createEventMock.mockImplementation(
			async () => `ev-resumed-${createEventMock.mock.calls.length}`
		);
		await submit(container);
		await settleSeriesRun(container);

		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(lastSeriesInput().extraParentIds).toEqual([SEASON_ID]);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(
			createEventMock.mock.calls.slice(2).map((c) => (c[1] as CreateEventInput).startDatetime)
		).toEqual(['2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']);
	});

	it('the season ALREADY in play is never disabled by its own run: it has no entry of its own while open — the collapse control carries the refusal (#135)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		expect(expandFor(container, 'Season 2026')).toBeNull();
		expect((q(container, 'season-card-collapse') as HTMLButtonElement).disabled).toBe(true);
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
