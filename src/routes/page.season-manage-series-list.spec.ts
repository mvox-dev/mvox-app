// @vitest-environment happy-dom
// The agenda's season-manage panel: the list of the season's series and events.
import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageWritesModule({ deleteEvent: false })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { collapseSeasonCard } from '$lib/testing/seasonCard';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { listEventSeriesForSeasonMock } from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import {
	SEASON_B_ID,
	SEASON_ID,
	setAuthedWithTwoCollectives
} from '$lib/testing/pages/seasonPanel';
import { openPanel, seriesFixture } from '$lib/testing/pages/seasonManage';
import { renderReady } from '$lib/testing/pages/seasonRender';
import {
	armAndConfirmSeriesDelete,
	openPanelForSeason,
	seriesA,
	twoSeasonResult,
	useSeasonManagePage
} from '$lib/testing/pages/seasonManagePanel';

useSeasonManagePage();

describe('agenda — the panel lists the season’s series and standalone events', () => {
	it('every series renders a row with its NAME and its EVENT COUNT — including a zero-count series (present with 0, not dropped)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		const row1 = q(container, 'season-manage-series-series-1') as HTMLElement;
		expect(row1.textContent).toContain('Monday rehearsals');
		expect(row1.textContent).toContain('12');

		const row2 = q(container, 'season-manage-series-series-2') as HTMLElement;
		expect(row2).not.toBeNull();
		expect(row2.textContent).toContain('Sectionals');
		expect(row2.textContent).toContain('0');
	});

	it('the event count goes through an i18n message with the count as a PARAM — never a bare, unlabelled number (#132/T3 review F2)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		const row1 = q(container, 'season-manage-series-series-1') as HTMLElement;
		expect(row1.textContent).toContain('season_manage_series_event_count');
		expect(row1.textContent).toContain('"count":12');

		const row2 = q(container, 'season-manage-series-series-2') as HTMLElement;
		expect(row2.textContent).toContain('season_manage_series_event_count');
		expect(row2.textContent).toContain('"count":0');
	});

	it('[+ Series] is present for the editor — T5’s entry point exists NOW, rendered inside the panel', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-add-series')).not.toBeNull();
		});
		expect(panel.contains(q(container, 'season-manage-add-series'))).toBe(true);
	});

	it('[+ Event] — T4’s entry point — is present inside the panel (#313: the standalone-event LIST itself is gone; events are managed on their own pages)', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});
		expect(panel.contains(q(container, 'season-manage-add-event'))).toBe(true);
	});

	it('a FAILED series read surfaces an error (role="alert") — NOT an empty list indistinguishable from "no series yet"', async () => {
		listEventSeriesForSeasonMock.mockRejectedValue(new Error('read down'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-series-series-1')).toBeNull();
	});

	it('a failed read does not stick: reopening after a recovery shows the rows and no error', async () => {
		listEventSeriesForSeasonMock.mockRejectedValueOnce(new Error('read down'));
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});

		await collapseSeasonCard(container);
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-error')).toBeNull();
	});

	it('a failed reopen keeps the rows already read for the season, with the error (#598)', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});

		listEventSeriesForSeasonMock.mockRejectedValueOnce(new Error('read down'));
		await collapseSeasonCard(container);
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
	});

	it('a failed first read for another season shows only the error, never the previous season’s rows (#598)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		listEventSeriesForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) =>
			seasonId === SEASON_B_ID
				? Promise.reject(new Error('read down'))
				: Promise.resolve({ items: seriesA, truncated: false })
		);
		const container = await renderReady();
		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-a1')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});
		expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		expect(q(container, 'season-manage-series-series-a1')).toBeNull();
	});
});

describe('agenda — the panel’s reads respect the page-wide requestId guard', () => {
	it('a series read still in flight when the collective changes never repopulates the panel', async () => {
		let resolveStale!: (result: { items: ReturnType<typeof seriesFixture>; truncated: boolean }) => void;
		listEventSeriesForSeasonMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveStale = resolve as typeof resolveStale;
				})
		);
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanel(container);
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});

		resolveStale({ items: seriesFixture(), truncated: false });
		await new Promise((r) => setTimeout(r, 0));

		await openPanel(container);
		expect(q(container, 'season-manage-series-series-1')).toBeNull();
		expect(q(container, 'season-manage-series-series-2')).toBeNull();
	});
});

const PARTIAL_NOTICE = 'season-manage-partial-notice';

function truncatedSeriesRead() {
	return { items: seriesFixture(), truncated: true };
}

describe('#321 review F1 — the season-manage panel’s partial notice', () => {
	it('a SEASON switch drops the notice with the rows it described — before the new season’s read has landed', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		listEventSeriesForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) =>
			seasonId === SEASON_B_ID
				? new Promise(() => {})
				: Promise.resolve({ items: seriesA, truncated: true })
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, PARTIAL_NOTICE)).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		expect(q(container, PARTIAL_NOTICE)).toBeNull();
	});

	it('a failed refresh keeps the rows and the partial notice, with the error (#632)', async () => {
		listEventSeriesForSeasonMock.mockResolvedValueOnce(truncatedSeriesRead());
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, PARTIAL_NOTICE)).not.toBeNull();
		});

		listEventSeriesForSeasonMock.mockRejectedValue(new Error('read down'));
		await armAndConfirmSeriesDelete(container, 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-series-error')).not.toBeNull();
		});
		expect(listEventSeriesForSeasonMock).toHaveBeenCalledTimes(2);
		expect(q(container, PARTIAL_NOTICE)).not.toBeNull();
		expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
	});

	it('a COLLECTIVE switch does not carry A’s truncation onto B’s panel', async () => {
		let pendingReads = 0;
		listEventSeriesForSeasonMock.mockImplementation(() =>
			pendingReads++ === 0
				? Promise.resolve(truncatedSeriesRead())
				: // org-b's read is held pending, same reasoning as the season pin.
					new Promise(() => {})
		);
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, PARTIAL_NOTICE)).not.toBeNull();
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await openPanel(container);

		expect(q(container, PARTIAL_NOTICE)).toBeNull();
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
