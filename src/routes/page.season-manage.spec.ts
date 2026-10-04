// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

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
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));

import Page from './+page.svelte';
import { collapseSeasonCard, SEASON_CARD_EXPAND } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import {
	deleteRepertoireItemMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	updateRepertoireStatusMock
} from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addSeasonConductorMock,
	countSeasonScopeMock,
	countSeriesOccurrencesMock,
	deleteEventSeriesMock,
	deleteSeasonMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	listRepertoireItemsMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { optionValues, q } from '$lib/testing/pages/dom';
import { CFG, flush } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	SEASON_B_ID,
	SEASON_END,
	SEASON_ID,
	SEASON_START,
	conductorSelect,
	expandButtons,
	expandFor,
	fixtureRows,
	isoDate,
	promptOption,
	setAuthedWithTwoCollectives,
	standaloneFixture,
	upcomingSeason
} from '$lib/testing/pages/seasonPanel';
import {
	agendaResult,
	currentSeason,
	openPanel,
	seriesFixture
} from '$lib/testing/pages/seasonManage';
import { renderReady } from '$lib/testing/pages/seasonRender';

let fakeByteStore: FakeByteStore;

const DISPLAY_FMT = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'UTC',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});
function displayDate(iso: string): string {
	return DISPLAY_FMT.format(new Date(iso));
}

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

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listEventsForSeasonMock.mockResolvedValue(toListRead(standaloneFixture()));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	listRepertoireItemsMock.mockResolvedValue([]);
	deleteRepertoireItemMock.mockResolvedValue(undefined);
	updateRepertoireStatusMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({});
	deleteEventSeriesMock.mockResolvedValue(undefined);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 0, events: 0, repertoireItems: 0 });
	deleteSeasonMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	listRepertoireItemsMock.mockReset();
	deleteRepertoireItemMock.mockReset();
	updateRepertoireStatusMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
	resetAppState();
});

async function editField(container: HTMLElement, field: string, value: string): Promise<void> {
	await fireEvent.click(q(container, `season-edit-btn-${field}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-edit-input-${field}`)).not.toBeNull();
	});
	const input = q(container, `season-edit-input-${field}`) as HTMLInputElement;
	await fireEvent.input(input, { target: { value } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

async function pickConductor(panel: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(panel), { target: { value: personId } });
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

describe('agenda — season fields edit inline (event/[id] per-field pattern)', () => {
	it('name: the panel shows the current name; click-to-edit, Enter-to-save calls updateSeasonField(cfg, seasonId, "name", <value>) ONCE and the display updates IMMEDIATELY — no full agenda refetch', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		});

		await editField(container, 'name', 'Autumn splendour');

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1);
		});
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Autumn splendour');

		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Autumn splendour');
		});
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);
	});

	it('Escape in an open name edit cancels ONLY the edit: input closes, old value stays, NO write — and the PANEL survives (Escape layering)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-name') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Half-typed nonsense' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
	});

	it('start date: the edit input is type="date" pre-filled with the current value; saving calls updateSeasonField(cfg, seasonId, "start_date", <iso date>)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-start_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-start_date') as HTMLInputElement;
		expect(input.type).toBe('date');
		expect(input.value).toBe(SEASON_START);

		await fireEvent.input(input, { target: { value: '2026-10-01' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'start_date', '2026-10-01');
		});
	});

	it('end date: same pattern — updateSeasonField(cfg, seasonId, "end_date", <iso date>)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		expect(input.type).toBe('date');
		expect(input.value).toBe(SEASON_END);

		await fireEvent.input(input, { target: { value: '2027-06-30' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'end_date', '2027-06-30');
		});
	});

	it('the dates render as ISO YYYY-MM-DD (#207 rule 7) and each carries its own VISIBLE label', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(displayDate(SEASON_START)).toBe(SEASON_START);
		expect(displayDate(SEASON_END)).toBe(SEASON_END);
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe(SEASON_START);
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe(SEASON_END);
		expect(panel.textContent).toContain('season_manage_start_date_label');
		expect(panel.textContent).toContain('season_manage_end_date_label');
	});

	it('DST edge: bounds ON the Tallinn spring-forward/fall-back days render as those exact ISO days', async () => {
		const season = currentSeason(true);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			...agendaResult(),
			seasons: [{ ...season, startDate: '2026-03-29', endDate: '2026-10-25' }]
		}));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe('2026-03-29');
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe('2026-10-25');
	});

	it('a season with NO dates set says so — never a bare pencil, and never "Invalid Date"', async () => {
		const season = currentSeason(true);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			...agendaResult(),
			seasons: [{ ...season, startDate: '', endDate: '' }]
		}));
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-manage-start_date')?.textContent).toContain(
			'season_manage_date_unset'
		);
		expect(q(container, 'season-manage-end_date')?.textContent).toContain(
			'season_manage_date_unset'
		);
		expect(panel.textContent).not.toContain('Invalid Date');
		expect(q(container, 'season-edit-btn-start_date')).not.toBeNull();
		expect(q(container, 'season-edit-btn-end_date')).not.toBeNull();
	});

	it('a FAILED save surfaces season-edit-error-name (role="alert") and the display keeps the OLD value — a silently snapped-back edit reads as a bug', async () => {
		updateSeasonFieldMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await editField(container, 'name', 'Doomed rename');

		await waitFor(() => {
			expect(q(container, 'season-edit-error-name')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-name')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Doomed rename');
	});

	it('an END date moved BEFORE the start date is refused: no write, the old value stands, and the error names the RANGE (not the generic save failure)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: isoDate(-90) } }); // before SEASON_START
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-end_date')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-edit-error-end_date')?.textContent).toContain(
			'season_date_range_invalid'
		);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-end_date')?.textContent).toContain(displayDate(SEASON_END));
		expect(q(container, 'season-manage-panel')?.textContent).not.toContain(
			displayDate(isoDate(-90))
		);
	});

	it('a START date moved AFTER the end date is refused the same way — the guard reads BOTH bounds', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-start_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-start_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: isoDate(200) } }); // after SEASON_END
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'season-edit-error-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-start_date')?.textContent).toContain(
			'season_date_range_invalid'
		);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-start_date')?.textContent).toContain(
			displayDate(SEASON_START)
		);
	});

	it('a date edit INSIDE the range still saves, and a save failure still reads as a SAVE error (the two error kinds do not bleed)', async () => {
		updateSeasonFieldMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		const valid = isoDate(90); // after SEASON_START — a legitimate extension
		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: valid } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'end_date', valid);
		});
		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')?.textContent).toContain(
				'season_manage_save_error'
			);
		});
	});
});

describe('agenda — season conductors are editable in the panel', () => {
	it('the current conductor renders as a chip showing the person’s NAME (from the cached roster), not a raw entity id', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		expect(chip.textContent).toContain('Grace Hopper');
		expect(chip.textContent).not.toContain('p-grace');
	});

	it('a FAILED roster read leaves no raw person id in the chip — not in its text, not in its remove button’s accessible name', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster down'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await waitFor(() => {
			expect(chip.textContent).toContain('season_manage_conductor_unknown');
		});
		expect(chip.textContent).not.toContain('p-grace');
		const remove = chip.querySelector('button') as HTMLElement;
		expect(remove.getAttribute('aria-label')).not.toContain('p-grace');
	});

	it('a conductor who is NOT on the roster (left the collective) reads as an unknown member, never as her entity id', async () => {
		loadRosterMock.mockResolvedValue(toListRead(fixtureRows().filter((row) => row.personId !== 'p-grace')));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await waitFor(() => {
			expect(chip.textContent).toContain('season_manage_conductor_unknown');
		});
		expect(chip.textContent).not.toContain('p-grace');
		expect((chip.querySelector('button') as HTMLElement).getAttribute('aria-label')).not.toContain(
			'p-grace'
		);
	});

	it('the panel holds a NATIVE conductor <select> (#209): named by season_conductor_label, prompt option (value "", disabled selected hidden, the reworded placeholder), then every roster person NOT already a conductor, in roster order', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		expect(select.getAttribute('aria-label')).toBe('season_conductor_label');
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
		expect(select.value).toBe('');

		expect(optionValues(select)).toEqual(['', 'p-ada', 'person-p']);
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual(['season_conductor_placeholder', 'Ada Lovelace', 'Pete Wilson']);
	});

	it('option order is ROSTER order — section, then position within section — not alphabetical (Gama ruling 3)', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ ...fixtureRows()[0], sectionIds: ['sec-t'] }, // Ada → Tenor
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran (excluded anyway)
			{ ...fixtureRows()[2], sectionIds: ['sec-s'] } // Pete → Sopran
		]));
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(optionValues(conductorSelect(panel))).toEqual(['', 'person-p', 'p-ada']);
		});
	});

	it('adding via the panel’s select (change to a person id) calls addSeasonConductor(cfg, seasonId, <personId>), the new chip appears, and the select RESETS to the prompt', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await pickConductor(panel, 'p-ada');

		await waitFor(() => {
			expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-p-ada')?.textContent).toContain('Ada Lovelace');

		const select = conductorSelect(panel);
		await waitFor(() => {
			expect(select.value).toBe('');
		});
		expect(optionValues(select)).toEqual(['', 'person-p']);
	});

	it('EVERY roster person already conducts: the select stays MOUNTED but disabled with prompt text picker_everyone_added (Gama ruling 2)', async () => {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasonId: SEASON_ID,
				seasonConductors: ['p-ada', 'p-grace', 'person-p'],
				seasonEditors: ['person-p'],
				seasons: [
					{
						id: SEASON_ID,
						name: 'Season 2026',
						startDate: SEASON_START,
						endDate: SEASON_END,
						conductors: ['p-ada', 'p-grace', 'person-p'],
						owners: [],
						editors: ['person-p']
					}
				]
			})
		);

		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		await waitFor(() => {
			expect(select.disabled).toBe(true);
		});
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_everyone_added');
	});

	it('the chip’s remove button calls removeSeasonConductor(cfg, seasonId, <personId>) and the chip leaves', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		const remove = chip.querySelector('button') as HTMLElement;
		expect(remove).not.toBeNull();
		await fireEvent.click(remove);

		await waitFor(() => {
			expect(removeSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-grace');
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
		});
	});

	it('a FAILED add reverts the chip AND says so (role="alert") — a silently vanishing chip reads as a bug', async () => {
		addSeasonConductorMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		const panel = await openPanel(container);

		await pickConductor(panel, 'p-ada');

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
	});

	it('a FAILED remove restores the chip AND surfaces the same error slot', async () => {
		removeSeasonConductorMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await fireEvent.click(chip.querySelector('button') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
	});

	it('a SUCCESSFUL attempt after a failed one clears the error — the slot is per-attempt, not sticky', async () => {
		removeSeasonConductorMock.mockRejectedValueOnce(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		await fireEvent.click(
			(q(container, 'season-manage-conductor-p-grace') as HTMLElement).querySelector(
				'button'
			) as HTMLElement
		);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});

		await fireEvent.click(
			(q(container, 'season-manage-conductor-p-grace') as HTMLElement).querySelector(
				'button'
			) as HTMLElement
		);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).toBeNull();
		});
	});
});

function doubledConductorResult(conductors: string[], viewerIsEditor: boolean) {
	const season: Season = {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors,
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function conductorEntries(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll('[data-testid^="season-manage-conductor-"]')
	).filter((el) => el.tagName === 'LI') as HTMLElement[];
}

function entryKeys(container: HTMLElement): (string | null)[] {
	return conductorEntries(container).map((el) => el.getAttribute('data-conductor-key'));
}

function entryTestids(container: HTMLElement): (string | null)[] {
	return conductorEntries(container).map((el) => el.getAttribute('data-testid'));
}

function removeButtonsFor(container: HTMLElement, personId: string): HTMLElement[] {
	return Array.from(
		container.querySelectorAll(`[data-testid="season-manage-conductor-remove-${personId}"]`)
	) as HTMLElement[];
}

describe('#483 agenda — a season holding the same conductor twice', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let windowErrors: unknown[];
	const onWindowError = (e: ErrorEvent) => {
		windowErrors.push(e.error ?? e.message);
	};
	const onRejection = (e: PromiseRejectionEvent) => {
		windowErrors.push(e.reason);
	};

	beforeEach(() => {
		windowErrors = [];
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		window.addEventListener('error', onWindowError);
		window.addEventListener('unhandledrejection', onRejection);
	});

	afterEach(() => {
		window.removeEventListener('error', onWindowError);
		window.removeEventListener('unhandledrejection', onRejection);
		consoleErrorSpy.mockRestore();
	});

	it('a writer opens the panel WITHOUT a thrown error and sees BOTH p-ada entries (keys p-ada#0, p-ada#1) plus p-grace once', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(() =>
			flushSync(() => (q(container, SEASON_CARD_EXPAND) as HTMLElement).click())
		).not.toThrow();
		const panel = await waitFor(() => {
			const el = q(container, 'season-manage-panel');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-ada#1', 'p-grace#0']);
		});
		expect(panel.isConnected).toBe(true);
		expect(conductorSelect(panel)).not.toBeNull();
		expect(
			Array.from(
				container.querySelectorAll('[data-testid="season-manage-conductor-p-ada"]')
			).map((el) => el.getAttribute('data-conductor-key'))
		).toEqual(['p-ada#0', 'p-ada#1']);
		expect(
			container.querySelectorAll('[data-testid="season-manage-conductor-p-grace"]').length
		).toBe(1);
		expect(entryTestids(container)).toEqual([
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-grace'
		]);
		for (const el of conductorEntries(container).slice(0, 2)) {
			expect(el.textContent).toContain('Ada Lovelace');
		}
		expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		expect(windowErrors).toEqual([]);
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	it('removing the SECOND p-ada calls removeSeasonConductor once (cfg, seasonId, "p-ada") and leaves exactly one p-ada and one p-grace', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[1]);

		await waitFor(() => {
			expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		});
		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0']);
		});
		expect(entryTestids(container)).toEqual([
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-grace'
		]);
		expect(q(container, 'season-manage-conductor-error')).toBeNull();
		expect(windowErrors).toEqual([]);
	});

	it('removal is by POSITION, not by id: with [ada, grace, ada], removing the FIRST ada leaves [grace, ada]', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-grace', 'p-ada'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0', 'p-ada#1']);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[0]);

		await waitFor(() => {
			expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		});
		await waitFor(() => {
			expect(entryTestids(container)).toEqual([
				'season-manage-conductor-p-grace',
				'season-manage-conductor-p-ada'
			]);
		});
		expect(entryKeys(container)).toEqual(['p-grace#0', 'p-ada#0']);
	});

	it('removal is by POSITION, not by id: with [ada, grace, ada], removing the SECOND ada leaves [ada, grace]', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-grace', 'p-ada'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[1]);

		await waitFor(() => {
			expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		});
		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0']);
		});
	});

	it('a FAILED remove of the second p-ada restores BOTH p-ada entries in their original order and surfaces the error slot', async () => {
		removeSeasonConductorMock.mockRejectedValue(new Error('boom'));
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[1]);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		expect(entryKeys(container)).toEqual(['p-ada#0', 'p-ada#1', 'p-grace#0']);
		expect(entryTestids(container)).toEqual([
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-grace'
		]);
	});

	it('a FAILED remove with [ada, grace, ada] restores the removed copy AT ITS POSITION', async () => {
		removeSeasonConductorMock.mockRejectedValue(new Error('boom'));
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-grace', 'p-ada'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[0]);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0', 'p-ada#1']);
	});

	it('the add guard stays: p-ada (already present) is NOT offered by the select — no third copy from this tab', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		const panel = await openPanel(container);
		await waitFor(() => {
			expect(optionValues(conductorSelect(panel))).toEqual(['', 'person-p']);
		});
		expect(entryKeys(container)).toEqual(['p-ada#0', 'p-ada#1', 'p-grace#0']);
	});

	it('a NON-editor with the same doubled season never gets the panel (gate unchanged): no card, no conductor entries', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], false)
		);
		const container = await renderReady();
		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(
			Array.from(container.querySelectorAll('[data-testid^="season-manage-conductor-"]'))
		).toEqual([]);
	});
});

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

describe('agenda — the season-manage conductor select tells its empties apart (#209 review F1)', () => {
	it('roster read STILL IN FLIGHT: disabled with the LOADING prompt, never picker_everyone_added', async () => {
		loadRosterMock.mockReturnValue(new Promise<never>(() => {})); // never settles

		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		expect(select.disabled).toBe(true);
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE — the same failure the chips already report as "unknown", never "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(panel)).textContent?.trim()).toBe(
				'picker_roster_unavailable'
			);
		});
		expect(conductorSelect(panel).disabled).toBe(true);
	});

	it('SECTION read failed: the select stays usable in the roster’s own name order and says so', async () => {
		listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-order-note')).not.toBeNull();
		});
		const select = conductorSelect(panel);
		expect(select.disabled).toBe(false);
		expect(optionValues(select)).toEqual(['', 'p-ada', 'person-p']);
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
	});
});

async function openPanelForSeason(container: HTMLElement, seasonName: string): Promise<HTMLElement> {
	await waitFor(() => {
		expect(expandFor(container, seasonName), `an entry for ${seasonName}`).not.toBeNull();
	});
	await fireEvent.click(expandFor(container, seasonName) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe(seasonName);
	});
	return q(container, 'season-manage-panel') as HTMLElement;
}

function seasonPickerSelects(container: HTMLElement): HTMLSelectElement[] {
	return (Array.from(container.querySelectorAll('select')) as HTMLSelectElement[]).filter(
		(sel) =>
			Array.from(sel.querySelectorAll('option')).some((o) => /Season 20\d\d/.test(o.textContent ?? ''))
	);
}

function twoSeasonResult(opts: { aEditor?: boolean; bEditor?: boolean } = {}) {
	const { aEditor = true, bEditor = true } = opts;
	return fullAgendaResult({
		seasons: [currentSeason(aEditor), { ...upcomingSeason(), editors: bEditor ? ['person-p'] : [] }]
	});
}

const seriesA = [
	{ id: 'series-a1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] }
];
const seriesB = [
	{ id: 'series-b1', name: 'Thursday sectionals', eventCount: 4, ownerIds: ['person-p'] }
];
const repertoireA = [
	{ id: 'rep-a1', workId: 'work-a1', editionId: '', status: 'active', name: 'Kyrie' }
];
const repertoireB = [
	{ id: 'rep-b1', workId: 'work-b1', editionId: '', status: 'active', name: 'Sanctus' }
];

function serveSeriesPerSeason(): void {
	listEventSeriesForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) =>
		Promise.resolve({ items: seasonId === SEASON_B_ID ? seriesB : seriesA, truncated: false })
	);
}

describe('season card #277 — one entry per manageable season, not a picker', () => {
	it('TWO manageable seasons: TWO collapsed entries in season order, each a BUTTON naming its own season (sr-only verb + visible name), and NO season <select> anywhere; merely rendering opens no panel and reads nothing', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const container = await renderReady();

		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		const [first, second] = expandButtons(container);
		expect(first.tagName).toBe('BUTTON');
		expect(second.tagName).toBe('BUTTON');
		expect(first.textContent).toContain('Season 2026');
		expect(second.textContent).toContain('Season 2027');
		expect(first.hasAttribute('aria-label')).toBe(false);
		expect(second.hasAttribute('aria-label')).toBe(false);
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2026/ })
		).toBe(first);
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2027/ })
		).toBe(second);
		expect(seasonPickerSelects(container)).toEqual([]);

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
		expect(listRepertoireItemsMock).toHaveBeenCalledWith(CFG, SEASON_ID);
	});

	it('ONE manageable season: EXACTLY one entry — today’s #261 face, no new control, no picker (criterion 5)', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		const only = expandButtons(container)[0];
		expect(only.getAttribute('aria-expanded')).toBe('false');
		expect(only.textContent).toContain('Season 2026');
		expect(only.hasAttribute('aria-label')).toBe(false);
		expect(seasonPickerSelects(container)).toEqual([]);
	});

	it('opening the UPCOMING season’s entry loads THAT season: series + repertoire reads use ITS id, the fields are ITS fields, and the visible label names it (criteria 1+2)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2027');

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		await waitFor(() => {
			expect(listRepertoireItemsMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		});
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe(isoDate(61));
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe(isoDate(240));
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-series-a1')).toBeNull();
		expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
	});

	it('with the panel OPEN for one season the OTHER season’s entry stays reachable — the panel names its season while more than one is manageable (criterion 2)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');

		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2026');
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandFor(container, 'Season 2027')).not.toBeNull();
	});
});

describe('season card #277 — switching the managed season is a context switch', () => {
	it('A open → click B’s entry: the panel now holds B’s fields and B’s series; NOTHING of A survives — fields, rows, chips (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-a1')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		});
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-series-a1')).toBeNull();
		expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
		await waitFor(() => {
			expect(listRepertoireItemsMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
	});

	it('race (a): a series read for A still in flight when the admin switches to B NEVER repopulates B’s panel', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		let resolveStaleA!: (result: { items: typeof seriesA; truncated: boolean }) => void;
		listEventSeriesForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId === SEASON_ID)
				return new Promise((resolve) => {
					resolveStaleA = resolve as typeof resolveStaleA;
				});
			return new Promise(() => {}); // B's own read stays pending: anything visible is stale
		});
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});

		await openPanelForSeason(container, 'Season 2027');
		resolveStaleA({ items: seriesA, truncated: false });
		await flush();

		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2027');
		expect(q(container, 'season-manage-series-series-a1')).toBeNull();
		expect(q(container, 'season-manage-series-error')).toBeNull();
	});

	it('race (b): a field edit on A REJECTING after the switch neither clobbers B’s field nor leaks into B’s error slot — and the field is still editable (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let rejectStaleWrite!: (e: Error) => void;
		updateSeasonFieldMock.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectStaleWrite = reject as typeof rejectStaleWrite;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await editField(container, 'name', 'Renamed A');
		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed A');
		});

		await openPanelForSeason(container, 'Season 2027');
		rejectStaleWrite(new Error('boom, late'));
		await flush();

		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Season 2026');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Renamed A');
		expect(q(container, 'season-edit-error-name')).toBeNull();
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
	});

	it('race (c): an in-flight conductor add on A rejecting after the switch leaves B’s chips and error slot untouched (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let rejectStaleAdd!: (e: Error) => void;
		addSeasonConductorMock.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectStaleAdd = reject as typeof rejectStaleAdd;
				})
		);
		const container = await renderReady();

		const panelA = await openPanelForSeason(container, 'Season 2026');
		await pickConductor(panelA, 'p-ada');
		await waitFor(() => {
			expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		});

		await openPanelForSeason(container, 'Season 2027');
		rejectStaleAdd(new Error('boom, late'));
		await flush();

		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
		expect(q(container, 'season-manage-conductor-error')).toBeNull();
	});

	it('race (d): a season delete ARMED on A is DISARMED by the switch — B’s title row shows the idle trashcan, never a live confirm (resetSeasonManage keeps covering it)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season-confirm')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).toBeNull();
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('race (e): a panel repertoire REMOVE on A rejecting after the switch never paints A’s row under B’s heading (criterion 3)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let bReads = 0;
		listRepertoireItemsMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId !== SEASON_B_ID) return Promise.resolve(repertoireA);
			bReads += 1;
			return bReads === 1 ? Promise.resolve(repertoireB) : new Promise(() => {});
		});
		let rejectStaleDelete!: (e: Error) => void;
		deleteRepertoireItemMock.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectStaleDelete = reject as typeof rejectStaleDelete;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Kyrie');
		});
		const removeA = q(q(container, 'season-manage-repertoire') as HTMLElement, 'work-manage-remove');
		expect(removeA, 'the panel row’s remove control').not.toBeNull();
		await fireEvent.click(removeA as HTMLElement);
		await waitFor(() => {
			expect(deleteRepertoireItemMock).toHaveBeenCalledWith(CFG, 'rep-a1');
		});

		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Sanctus');
		});

		rejectStaleDelete(new Error('boom, late'));
		await flush();

		const section = q(container, 'season-manage-repertoire') as HTMLElement;
		expect(section.textContent).toContain('Sanctus');
		expect(section.textContent).not.toContain('Kyrie');
		expect(section.querySelectorAll('[data-testid="work-manage-remove"]')).toHaveLength(1);
	});
});

describe('season card #277 — rights are re-derived per season', () => {
	it('editor on the CURRENT season only: exactly one entry, the current season’s — the upcoming season the viewer cannot edit gets NONE (criterion 4, fail-closed)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: true, bEditor: false }));
		const container = await renderReady();

		await waitFor(() => {
			expect(expandFor(container, 'Season 2026')).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandFor(container, 'Season 2027')).toBeNull();
	});

	it('switching cannot CARRY A’s editor onto B: with rights on A only, opening A leaves NO switch target for B', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: true, bEditor: false }));
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');

		expect(expandFor(container, 'Season 2027')).toBeNull();
		expect(expandButtons(container)).toHaveLength(0);
	});

	it('editor on the UPCOMING season only: ITS entry renders even though the automatic pick (the current season) is unmanageable — and it opens ITS panel (criterion 1)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: false, bEditor: true }));
		serveSeriesPerSeason();
		const container = await renderReady();

		await waitFor(() => {
			expect(expandFor(container, 'Season 2027')).not.toBeNull();
		});
		expect(expandFor(container, 'Season 2026')).toBeNull();
		expect(expandButtons(container)).toHaveLength(1);

		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_B_ID);
		});
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalledWith(CFG, SEASON_ID);
	});

	it('rights on ZERO not-lapsed seasons: no entries, no card, no panel — absent, not disabled (and the DB probe’s not-editor answer is no grant)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: false, bEditor: false }));
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalledWith(CFG, ORG_EFK, 'person-p');
		});
		expect(expandButtons(container)).toHaveLength(0);
		expect(q(container, 'agenda-admin-card')).toBeNull();
		expect(q(container, 'season-manage-panel')).toBeNull();
	});

	it('the DB-entity fallback promotes UNIFORMLY: no per-season rights visible anywhere + database-entity editor → EVERY not-lapsed season gets an entry (collective-level grant)', async () => {
		resolveManageRightsMock.mockResolvedValue('editor');
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult({ aEditor: false, bEditor: false }));
		const container = await renderReady();

		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		expect(expandFor(container, 'Season 2026')).not.toBeNull();
		expect(expandFor(container, 'Season 2027')).not.toBeNull();
	});

	it('a LAPSED season alongside a current one gets NO entry even for its editor — the set is not-lapsed seasons only (the automatic pick’s lapsed FALLBACK case stays covered by the existing single-season specs)', async () => {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [
					{
						id: 'season-0',
						name: 'Season 2025',
						startDate: isoDate(-300),
						endDate: isoDate(-100),
						conductors: [],
						owners: [],
						editors: ['person-p']
					},
					currentSeason(true)
				]
			})
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(expandFor(container, 'Season 2026')).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandFor(container, 'Season 2025')).toBeNull();
	});
});

async function armAndConfirmSeriesDelete(container: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(q(container, `season-manage-series-delete-${id}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-manage-series-delete-confirm-${id}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `season-manage-series-delete-confirm-${id}`) as HTMLElement);
}

function entryNames(container: HTMLElement): string[] {
	return expandButtons(container).map(
		(b) => b.querySelector('span:last-of-type')?.textContent?.trim() ?? ''
	);
}

describe('season card #277 review F1 — a panel-preserving reload keeps the panel on ITS season', () => {
	it('a series delete inside B’s panel reloads the agenda with the panel kept: the panel stays B’s, the next field edit writes B, and B is NOT listed as a collapsed entry while it is open', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		});

		await armAndConfirmSeriesDelete(container, 'series-b1');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await flush();

		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe('Season 2027');
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		await editField(container, 'name', 'Renamed B');
		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_B_ID, 'name', 'Renamed B');
		});
		expect(updateSeasonFieldMock).not.toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed B');
		expect(entryNames(container)).toEqual(['Season 2026']);
	});

	it('the panel’s repertoire section reconciles after that reload even when its own re-read settles BEFORE the agenda load', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let panelItems = [
			{ id: 'rep-b1', workId: 'work-b1', editionId: '', status: 'active', name: 'Kyrie' }
		];
		listRepertoireItemsMock.mockImplementation((_cfg: unknown, seasonId: string) =>
			Promise.resolve(seasonId === SEASON_B_ID ? panelItems : [])
		);
		const container = await renderReady();
		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Kyrie');
		});

		panelItems = [
			{ id: 'rep-b2', workId: 'work-b2', editionId: '', status: 'active', name: 'Sanctus' }
		];
		loadFullAgendaMock.mockImplementation(() => new Promise(() => {}));
		await armAndConfirmSeriesDelete(container, 'series-b1');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});

		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Sanctus');
		});
		expect(q(container, 'season-manage-repertoire')?.textContent).not.toContain('Kyrie');
	});

	it('review 2 F1 — a panel repertoire WRITE settling during that reload reconciles its own section too: the blanked `manageableSeasonId` is a reload, not a switch', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let bReads = 0;
		listRepertoireItemsMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId !== SEASON_B_ID) return Promise.resolve([]);
			bReads += 1;
			return Promise.resolve(
				bReads >= 3
					? [{ id: 'rep-b1', workId: 'work-b1', editionId: '', status: 'retired', name: 'Gloria' }]
					: repertoireB
			);
		});
		let resolveStatusWrite!: () => void;
		updateRepertoireStatusMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveStatusWrite = resolve as typeof resolveStatusWrite;
				})
		);
		const container = await renderReady();
		await openPanelForSeason(container, 'Season 2027');
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Sanctus');
		});

		await fireEvent.click(
			q(q(container, 'season-manage-repertoire') as HTMLElement, 'work-status-retired') as HTMLElement
		);
		await waitFor(() => {
			expect(updateRepertoireStatusMock).toHaveBeenCalledWith(CFG, 'rep-b1', 'retired');
		});

		loadFullAgendaMock.mockImplementation(() => new Promise(() => {}));
		await armAndConfirmSeriesDelete(container, 'series-b1');
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(bReads).toBe(2);
		});

		resolveStatusWrite();

		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')?.textContent).toContain('Gloria');
		});
		expect(bReads).toBe(3);
	});
});

describe('season card #277 review F3 — a series cascade that resolves after a switch', () => {
	it('the delete of A’s series landing AFTER the switch announces nothing, splices no row of B’s, and fires no reload', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let resolveCascade!: (count: number) => void;
		deleteEventSeriesMock.mockImplementation(
			() =>
				new Promise<number>((resolve) => {
					resolveCascade = resolve as typeof resolveCascade;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-a1')).not.toBeNull();
		});
		await armAndConfirmSeriesDelete(container, 'series-a1');
		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalled();
		});

		await openPanelForSeason(container, 'Season 2027');
		const agendaLoadsBeforeLanding = loadFullAgendaMock.mock.calls.length;
		resolveCascade(3);
		await flush();

		expect(q(container, 'season-manage-delete-status')?.textContent?.trim()).toBe('');
		expect(q(container, 'season-manage-delete-error')).toBeNull();
		expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(agendaLoadsBeforeLanding);
	});

	it('a REJECTED cascade for A after the switch paints no error slot in B’s panel', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		let rejectCascade!: (e: Error) => void;
		deleteEventSeriesMock.mockImplementation(
			() =>
				new Promise<number>((_resolve, reject) => {
					rejectCascade = reject as typeof rejectCascade;
				})
		);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-a1')).not.toBeNull();
		});
		await armAndConfirmSeriesDelete(container, 'series-a1');
		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalled();
		});

		await openPanelForSeason(container, 'Season 2027');
		rejectCascade(new Error('boom, late'));
		await flush();

		expect(q(container, 'season-manage-delete-error')).toBeNull();
		expect(q(container, 'season-manage-series-series-b1')).not.toBeNull();
	});
});

describe('season card #277 review F4 — the in-play entry carries the panel’s live name', () => {
	it('ONE manageable season: a rename in the panel then a collapse shows the NEW name on the entry (the collapse keeps the panel’s fields)', async () => {
		const container = await renderReady();
		await openPanel(container);
		await editField(container, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});

		await collapseSeasonCard(container);

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(expandButtons(container)).toHaveLength(1);
		expect(expandButtons(container)[0].textContent).toContain('Renamed 2026');
		expect(expandButtons(container)[0].textContent).not.toContain('Season 2026');
	});

	it('the OTHER seasons’ entries keep reading the season list: renaming the open season touches only its own entry', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		serveSeriesPerSeason();
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await editField(container, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});
		expect(entryNames(container)).toEqual(['Season 2027']);

		await collapseSeasonCard(container);

		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		expect(entryNames(container)).toEqual(['Renamed 2026', 'Season 2027']);
	});
});

describe('season card #277 — [+ Season] alongside the entries', () => {
	it('[+ Hooaeg] stays present above TWO manageable entries, and a created season JOINS the entries after the existing post-create reload', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const container = await renderReady();
		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(2);
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-create') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'season-create-name') as HTMLInputElement, {
			target: { value: 'Season 2028' }
		});
		await fireEvent.input(q(container, 'season-create-start') as HTMLInputElement, {
			target: { value: isoDate(241) }
		});
		await fireEvent.input(q(container, 'season-create-end') as HTMLInputElement, {
			target: { value: isoDate(400) }
		});
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasons: [
					currentSeason(true),
					upcomingSeason(),
					{
						id: 'season-3',
						name: 'Season 2028',
						startDate: isoDate(241),
						endDate: isoDate(400),
						conductors: [],
						owners: [],
						editors: ['person-p']
					}
				]
			})
		);
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(expandButtons(container)).toHaveLength(3);
		});
		expect(expandFor(container, 'Season 2028')).not.toBeNull();
	});
});

const PARTIAL_NOTICE = 'season-manage-partial-notice';

function truncatedSeriesRead() {
	return { items: seriesFixture(), truncated: true };
}

describe('#321 review F1 — the season-manage panel’s partial notice', () => {
	it('a truncated series read renders a VISIBLE, persistent role="status" notice with the i18n copy, directly above the rows', async () => {
		listEventSeriesForSeasonMock.mockResolvedValue(truncatedSeriesRead());
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, PARTIAL_NOTICE)).not.toBeNull();
		});
		const notice = q(container, PARTIAL_NOTICE) as HTMLElement;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toContain('sr-only');
		expect(notice.textContent?.trim()).toBe('season_manage_partial_notice');
		expect(panel.contains(notice)).toBe(true);
		const firstRow = q(container, 'season-manage-series-series-1') as HTMLElement;
		expect(
			notice.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		await flush();
		expect(q(container, PARTIAL_NOTICE)).not.toBeNull();
	});

	it('a complete read leaves the notice ABSENT from the DOM (not hidden)', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});

		expect(q(container, PARTIAL_NOTICE)).toBeNull();
	});

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

// (*MVOX:Tallis*)
// (*MVOX:Tallis*)
describe('#321 review F2 — the panel\u2019s conductor picker states a truncated roster', () => {
	const NOTICE = 'season-manage-conductor-partial-notice';

	it('a truncated roster read renders the shared role="status" notice beside the picker', async () => {
		loadRosterMock.mockResolvedValue({ items: fixtureRows(), total: 500, truncated: true });
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, NOTICE)).not.toBeNull();
		});
		const notice = q(container, NOTICE) as HTMLElement;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
	});

	it('a complete roster read leaves it ABSENT from the DOM', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);
		await waitFor(() => {
			expect(conductorSelect(panel).options.length).toBeGreaterThan(1);
		});

		expect(q(container, NOTICE)).toBeNull();
	});
});

// (*MVOX:Josquin*)
// (*MVOX:Tallis*)

describe('#361 — season-manage conductor chip: the member name is marked', () => {
	it('the current conductor chip renders the name (seasonConductorLabel) through PersonName — marked, and marked once', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')?.textContent).toContain(
				'Grace Hopper'
			);
		});
		expectNameMarkedOnce(
			q(container, 'season-manage-conductor-p-grace') as HTMLElement,
			'Grace Hopper',
			'in the season-manage conductor chip'
		);
	});
});

// (*MVOX:Tallis*)
