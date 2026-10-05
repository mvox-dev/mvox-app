// @vitest-environment happy-dom
// The agenda's season card: one entry per manageable season, and switching between them.
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
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('handle')
);

import { collapseSeasonCard, SEASON_CARD_EXPAND } from '$lib/testing/seasonCard';
import {
	deleteRepertoireItemMock,
	loadFullAgendaMock,
	resolveManageRightsMock,
	updateRepertoireStatusMock
} from '$lib/testing/moduleHandles';
import {
	addSeasonConductorMock,
	deleteEventSeriesMock,
	deleteSeasonMock,
	listEventSeriesForSeasonMock,
	listRepertoireItemsMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG, flush } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	SEASON_B_ID,
	SEASON_ID,
	expandButtons,
	expandFor,
	isoDate,
	upcomingSeason
} from '$lib/testing/pages/seasonPanel';
import { currentSeason, openPanel } from '$lib/testing/pages/seasonManage';
import { renderReady } from '$lib/testing/pages/seasonRender';
import {
	armAndConfirmSeriesDelete,
	editField,
	openPanelForSeason,
	pickConductor,
	seriesA,
	twoSeasonResult,
	useSeasonManagePage
} from '$lib/testing/pages/seasonManagePanel';

useSeasonManagePage();

function seasonPickerSelects(container: HTMLElement): HTMLSelectElement[] {
	return (Array.from(container.querySelectorAll('select')) as HTMLSelectElement[]).filter(
		(sel) =>
			Array.from(sel.querySelectorAll('option')).some((o) => /Season 20\d\d/.test(o.textContent ?? ''))
	);
}

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

// (*MVOX:Tallis*) (*MVOX:Josquin*)
