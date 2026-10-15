// @vitest-environment happy-dom
// #917 — every season row carries its delete trashcan, shown only to the season's _owner.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageWritesModule({ deleteEvent: true })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import type { Season } from '$lib/seasons/types';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import {
	countSeasonScopeMock,
	deleteSeasonMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock
} from '$lib/testing/mocks/seasons';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import {
	type PageOnProgress,
	SEASON_ID,
	cleanupResetSeasonDeleteMocks,
	isoDate
} from '$lib/testing/pages/seasonPanel';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { renderReady } from '$lib/testing/pages/seasonManageRender';

const NEXT_ID = 'season-2';

function seasons(rights: 'owner' | 'editor'): Season[] {
	const owners = rights === 'owner' ? ['person-p'] : [];
	const editors = rights === 'editor' ? ['person-p'] : [];
	return [
		{
			id: SEASON_ID,
			name: 'Season 2026',
			startDate: isoDate(-30),
			endDate: isoDate(60),
			conductors: [],
			owners,
			editors
		},
		{
			id: NEXT_ID,
			name: 'Season 2027',
			startDate: isoDate(61),
			endDate: isoDate(240),
			conductors: [],
			owners,
			editors
		}
	];
}

function agendaResult(rights: 'owner' | 'editor') {
	return fullAgendaResult({ seasons: seasons(rights) });
}

function rowTrash(container: HTMLElement, seasonId: string): HTMLButtonElement | null {
	return container.querySelector<HTMLButtonElement>(
		`[data-testid="season-row-delete"][data-season-manage-id="${seasonId}"]`
	);
}

function expandButton(container: HTMLElement, seasonId: string): HTMLButtonElement {
	return container.querySelector<HTMLButtonElement>(
		`[data-testid="season-card-expand"][data-season-manage-id="${seasonId}"]`
	) as HTMLButtonElement;
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult('owner'));
	listEventSeriesForSeasonMock.mockResolvedValue({ items: [], truncated: false });
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	getSeriesDefaultsMock.mockResolvedValue({
		name: '',
		durationMinutes: null,
		defaultLocation: '',
		defaultDescription: ''
	});
	countSeasonScopeMock.mockImplementation(async (_cfg: unknown, seasonId: string) =>
		seasonId === NEXT_ID
			? { series: 2, events: 9, repertoireItems: 4 }
			: { series: 3, events: 21, repertoireItems: 6 }
	);
	deleteSeasonMock.mockResolvedValue({ series: 2, events: 9, repertoireItems: 4 });
});

afterEach(cleanupResetSeasonDeleteMocks);

describe('#917 — closed season rows: the trashcan follows the season _owner', () => {
	it('an _owner sees a trashcan on each closed row, named for that row’s season', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(rowTrash(container, SEASON_ID)).not.toBeNull();
			expect(rowTrash(container, NEXT_ID)).not.toBeNull();
		});
		const card = q(container, 'agenda-admin-card') as HTMLElement;
		expect(
			within(card).getByRole('button', {
				name: 'season_manage_season_delete {"name":"Season 2027"}'
			})
		).toBe(rowTrash(container, NEXT_ID));
		expect(
			within(card).getByRole('button', {
				name: 'season_manage_season_delete {"name":"Season 2026"}'
			})
		).toBe(rowTrash(container, SEASON_ID));
		expect(rowTrash(container, NEXT_ID)?.closest('button[data-testid="season-card-expand"]')).toBeNull();
		expect(rowTrash(container, NEXT_ID)?.disabled).toBe(false);
	});

	it('an _editor-only person sees no trashcan, closed or open, but keeps the expand control and the panel', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult('editor'));
		const container = await renderReady();
		await waitFor(() => {
			expect(expandButton(container, NEXT_ID)).not.toBeNull();
		});
		expect(rowTrash(container, SEASON_ID)).toBeNull();
		expect(rowTrash(container, NEXT_ID)).toBeNull();

		await openSeasonCardPanel(container);
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-delete-season'), 'no open-row trashcan').toBeNull();
		expect(rowTrash(container, NEXT_ID)).toBeNull();
		expect(
			within(container).queryByRole('button', { name: /season_manage_season_delete/ })
		).toBeNull();
	});

	it('an _owner keeps the open-row trashcan', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
	});
});

describe('#917 — deleting a closed season from its row', () => {
	it('the trashcan shows that season’s confirm and counts without opening the panel', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(rowTrash(container, NEXT_ID)).not.toBeNull();
		});
		await fireEvent.click(rowTrash(container, NEXT_ID) as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-row-delete-confirm')?.getAttribute('aria-label')).toBe(
				'season_delete_confirm_scope {"name":"Season 2027","series":2,"events":9,"repertoire":4}'
			);
		});
		expect(countSeasonScopeMock).toHaveBeenCalledWith(CFG, NEXT_ID);
		expect(q(container, 'season-manage-panel'), 'the panel stays shut').toBeNull();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(q(container, 'season-row-delete-confirm'));
	});

	it('with another season open, confirming deletes the closed row’s season (not the open one) with progress, then reloads', async () => {
		let onProgress: PageOnProgress;
		let finish: (v: { series: number; events: number; repertoireItems: number }) => void = () => {};
		deleteSeasonMock.mockImplementation(
			(_cfg: unknown, _id: string, _f: unknown, opts: { onProgress: PageOnProgress }) => {
				onProgress = opts.onProgress;
				return new Promise((resolve) => {
					finish = resolve;
				});
			}
		);
		const container = await renderReady();
		await fireEvent.click(expandButton(container, SEASON_ID));
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).not.toBeNull();
			expect(rowTrash(container, NEXT_ID)).not.toBeNull();
		});

		await fireEvent.click(rowTrash(container, NEXT_ID) as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-row-delete-confirm')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-season'), 'the open row stays unarmed').not.toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		const loadsBefore = loadFullAgendaMock.mock.calls.length;
		await fireEvent.click(q(container, 'season-row-delete-confirm') as HTMLElement);

		expect(deleteSeasonMock).toHaveBeenCalledTimes(1);
		expect(deleteSeasonMock.mock.calls[0][0]).toEqual(CFG);
		expect(deleteSeasonMock.mock.calls[0][1]).toBe(NEXT_ID);
		onProgress!(1, 3, 'events');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')?.textContent?.trim()).toBe(
				'season_manage_delete_progress {"current":1,"total":3}'
			);
		});
		finish({ series: 2, events: 9, repertoireItems: 4 });
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-status')?.textContent?.trim()).toBe(
				'season_delete_success {"name":"Season 2027"}'
			);
		});
		expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(loadsBefore);
		expect(q(container, 'season-manage-delete-progress')).toBeNull();
	});

	it('arming one row then another leaves only the second armed', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(rowTrash(container, SEASON_ID)).not.toBeNull();
		});
		await fireEvent.click(rowTrash(container, SEASON_ID) as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-row-delete-confirm')).not.toBeNull();
		});
		expect(rowTrash(container, SEASON_ID), 'the armed row swaps its trashcan for the pair').toBeNull();

		await fireEvent.click(rowTrash(container, NEXT_ID) as HTMLElement);
		await waitFor(() => {
			expect(rowTrash(container, SEASON_ID), 'the first row disarmed').not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid="season-row-delete-confirm"]')).toHaveLength(1);
		expect(rowTrash(container, NEXT_ID)).toBeNull();
		await waitFor(() => {
			expect(q(container, 'season-row-delete-confirm')?.getAttribute('aria-label')).toContain(
				'"name":"Season 2027"'
			);
		});
	});

	it('cancel disarms the row and returns focus to that row’s trashcan', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(rowTrash(container, NEXT_ID)).not.toBeNull();
		});
		await fireEvent.click(rowTrash(container, NEXT_ID) as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-row-delete-cancel')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-row-delete-cancel') as HTMLElement);
		await waitFor(() => {
			expect(document.activeElement).toBe(rowTrash(container, NEXT_ID));
		});
		expect(q(container, 'season-row-delete-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
