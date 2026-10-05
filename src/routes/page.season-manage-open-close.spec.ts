// @vitest-environment happy-dom
// The agenda's season-manage panel: opening it from the season card, and closing it.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fireEvent, waitFor, within } from '@testing-library/svelte';
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
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule([])
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal(), { writes: true })
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('handle')
);
vi.mock('$lib/files/appByteStore', async () =>
	(await import('$lib/testing/mocks/files')).appByteStoreModule()
);

import { collapseSeasonCard, SEASON_CARD_EXPAND } from '$lib/testing/seasonCard';
import { gotoMock } from '$lib/testing/routeMocks';
import { loadFullAgendaMock, resolveManageRightsMock } from '$lib/testing/moduleHandles';
import {
	addSeasonConductorMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import { SEASON_ID, isoDate } from '$lib/testing/pages/seasonPanel';
import { agendaResult, openPanel } from '$lib/testing/pages/seasonManage';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { editField, useSeasonManagePage } from '$lib/testing/pages/seasonManagePanel';

useSeasonManagePage();

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

describe('agenda — the season-card season-manage entry point', () => {
	it('season editor + current season: season-card-expand renders as a BUTTON whose accessible name says what it DOES *and* which season it is (sr-only verb + visible name), outside any agenda row; merely rendering opens no panel and writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		const expand = q(container, SEASON_CARD_EXPAND) as HTMLElement;
		expect(expand.tagName).toBe('BUTTON');
		expect(expand.hasAttribute('aria-label')).toBe(false);
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2026/ })
		).toBe(expand);
		expect(expand.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(expand.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
		expect(listEventsForSeasonMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no card at all — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
	});

	it('the only season LAPSED yesterday and nothing is queued behind it: the card RENDERS — its panel is the only way to fix that season’s dates', async () => {
		loadFullAgendaMock.mockResolvedValue(lapsedOnlySeasonResult(true));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
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
		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
	});

	it('the card gates INDEPENDENTLY of [+ Season]: with an upcoming season BOTH stay present (#261 reopen — the create affordance is rights-gated only; the current season is still manageable)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
	});

	it('clicking the collapsed card opens season-manage-panel INLINE (no route change), a dialog with an accessible name, and loads the series list for THIS season (#313: no standalone-event read any more)', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(panel.getAttribute('role')).toBe('dialog');
		expect(
			panel.getAttribute('aria-labelledby'),
			'#236/#238 — the dialog is named by the visible card title'
		).toBe('season-manage-label');
		expect(
			panel.hasAttribute('aria-label'),
			'no duplicated aria-label authoring on the panel'
		).toBe(false);
		const panelLabelEl = container.querySelector('[id="season-manage-label"]') as HTMLElement;
		expect(panelLabelEl, 'aria-labelledby must resolve to an element').not.toBeNull();
		expect(panelLabelEl.textContent?.trim()).toBe('Season 2026');

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});
		expect(listEventsForSeasonMock).not.toHaveBeenCalled();
	});

	it('#238/#261 — the header leads with the season NAME: with the panel OPEN the title shows the name, and the retired gear/panel-label keys are consumed NOWHERE', async () => {
		const container = await renderReady();
		await openPanel(container);

		const label = q(container, 'season-manage-label') as HTMLElement;
		expect(label, 'the title element stays mounted with the panel open').not.toBeNull();
		expect(label.textContent?.trim(), 'the title text is the season name').toBe('Season 2026');
		expect(container.innerHTML).not.toContain('season_manage_gear_label');
		expect(container.innerHTML).not.toContain('season_manage_panel_label');
	});
});

describe('agenda — closing the panel, and what survives it', () => {
	it('a TITLE-ROW click dismisses the panel (#261 — the card is the toggle; no internal close button exists); nothing was written by opening + closing', async () => {
		const container = await renderReady();
		await openPanel(container);

		expect(q(container, 'season-manage-close')).toBeNull();
		await collapseSeasonCard(container);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(addSeasonConductorMock).not.toHaveBeenCalled();
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();
	});

	function pressEscapeAtFocus(): Promise<boolean> {
		return fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
	}

	it('opening the panel moves focus INTO the dialog — what role="dialog" promises, and what makes Escape reachable at all', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(document.activeElement).toBe(panel);
		});
	});

	it('Escape AT THE FOCUSED ELEMENT dismisses the panel (no field edit open — the layering test above covers the edit-open case)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
	});

	it('dismissing the panel returns focus to the collapsed card’s EXPAND control (#261 — the gear was the old anchor) — a keyboard user is not dropped at document start', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});

		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
	});

	it('closing through the TITLE ROW hands focus to the expand control that takes its place (#261 — the collapse control unmounts with the open state, like the old × did)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await collapseSeasonCard(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
		});
	});

	it('the two-Escapes-to-leave layering holds through REAL focus: the first Escape (fired at the focused edit input) closes only the edit, the second dismisses the panel', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		expect(document.activeElement).toBe(q(container, 'season-edit-input-name'));

		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();

		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
		await pressEscapeAtFocus();
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
	});

	it('a saved rename PERSISTS across close + reopen — shown from local truth, with NO second save and NO full agenda refetch', async () => {
		const container = await renderReady();
		await openPanel(container);

		await editField(container, 'name', 'Autumn splendour');
		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1);
		});

		await collapseSeasonCard(container);

		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Autumn splendour');
		});
		expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1);
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
