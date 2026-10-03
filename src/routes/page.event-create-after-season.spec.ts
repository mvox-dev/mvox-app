// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

const {
	loadFullAgendaMock,
	loadRosterMock,
	createSeasonMock,
	createEventMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock,
	loadWorksByEventIdMock,
	listWorksMock,
	listAllEditionsMock,
	listRepertoireItemsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createSeasonMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn(),
	listWorksMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listRepertoireItemsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: vi.fn(),
	createEvent: createEventMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', () => ({
	listWorks: listWorksMock,
	listAllEditions: listAllEditionsMock,
	listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: listRepertoireItemsMock
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { Season } from '$lib/seasons/types';
import type { WorkRow } from '$lib/repertoire/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const FUTURE_SEASON_ID = 'season-future-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function futureSeason(rights: { owners?: string[]; editors?: string[] } = {}): Season {
	return {
		id: FUTURE_SEASON_ID,
		name: 'Season 2027',
		startDate: isoDate(14),
		endDate: isoDate(200),
		conductors: [],
		owners: rights.owners ?? [],
		editors: rights.editors ?? []
	};
}

function futureOnlyAgenda(season: Season) {
	return fullAgendaResult({
		seasons: [season],
		manageableSeasonId: season.id,
		manageableSeasonOwners: season.owners,
		manageableSeasonEditors: season.editors
	});
}

function emptyAgenda() {
	return fullAgendaResult();
}

const CURRENT_SEASON_ID = 'season-current-1';

function currentSeasonNoVisibleRights(): Season {
	return {
		id: CURRENT_SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(160),
		conductors: [],
		owners: [],
		editors: []
	};
}

function currentSeasonAgenda(season: Season) {
	return fullAgendaResult({
		upcoming: [
			{
				id: 'ev-1',
				name: 'Rehearsal',
				startDatetime: new Date(Date.now() + 3600_000).toISOString(),
				durationMinutes: 90,
				location: '',
				conductors: [],
				owners: [],
				editors: []
			}
		],
		seasonId: season.id,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
	loadRosterMock.mockResolvedValue(toListRead([]));
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listSeriesOptionsForSeasonMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: ''
	});
	loadWorksByEventIdMock.mockResolvedValue({});
	listWorksMock.mockResolvedValue(toListRead([]));
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listRepertoireItemsMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createSeasonMock.mockReset();
	createEventMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listSeriesOptionsForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	listWorksMock.mockReset();
	listAllEditionsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReadyWithRow(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-row-ev-1')).not.toBeNull();
	});
	return container;
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

describe('#167 — event creation controls with a FUTURE-only season', () => {
	it('viewer is the future season’s EDITOR → the season card renders, the panel’s [+ Event] opens the form, and the future season is offerable in its season select', async () => {
		loadFullAgendaMock.mockResolvedValue(
			futureOnlyAgenda(futureSeason({ editors: ['person-p'] }))
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();
		await fireEvent.click(q(container, 'season-card-expand') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		const seasonSelect = q(container, 'event-create-season') as HTMLSelectElement;
		expect(Array.from(seasonSelect.options).map((o) => o.value)).toContain(FUTURE_SEASON_ID);
	});

	it('viewer is the future season’s OWNER → the season card renders (ownership subsumes editing)', async () => {
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason({ owners: ['person-p'] })));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
	});

	it('NO rights visible on the season, but the viewer holds rights on the DATABASE entity → the season card renders (the #167 cause-2 fallback: Mihkel is `_owner` on the database entity)', async () => {
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		expect(resolveManageRightsMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'sampledb' }),
			ORG_EFK,
			'person-p'
		);
	});

	it('fail-closed: no rights on the season AND none on the database entity → neither the season card nor any event entry point renders', async () => {
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReady();

		await flush();
		expect(q(container, 'event-create')).toBeNull();
		expect(q(container, 'season-card-expand')).toBeNull();
	});

	it('SERIES creation reachable: editor of the future season → the season card renders, the panel opens with [+ Series] and [+ Event], and its season-scoped reads target the FUTURE season', async () => {
		loadFullAgendaMock.mockResolvedValue(
			futureOnlyAgenda(futureSeason({ editors: ['person-p'] }))
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-card-expand') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).not.toBeNull();
		});
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(
				expect.anything(),
				FUTURE_SEASON_ID
			);
		});
	});
});

describe('#167 — the reported repro: create a season, controls appear', () => {
	it('empty collective → create a FUTURE-dated season via the form → the season card appears after the refresh', async () => {
		loadFullAgendaMock.mockResolvedValueOnce(emptyAgenda());
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason({ owners: ['person-p'] })));
		resolveManageRightsMock.mockResolvedValue('editor');

		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, 'season-card-expand')).toBeNull();
		expect(q(container, 'event-create')).toBeNull();

		await fireEvent.click(q(container, 'season-create') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		await fill(container, 'season-create-name', 'Hooaeg 2027');
		await fill(container, 'season-create-start', isoDate(14));
		await fill(container, 'season-create-end', isoDate(200));
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
	});
});

describe('#167 review F1 — a lapsed season alongside a just-created one', () => {
	it('the panel and [+ Series] target the NEW season, not the lapsed one whose dates have passed', async () => {
		const lapsed: Season = {
			id: 'season-lapsed',
			name: 'Season 2025',
			startDate: isoDate(-400),
			endDate: isoDate(-30),
			conductors: [],
			owners: ['person-p'],
			editors: []
		};
		const created = futureSeason({ owners: ['person-p'] });
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasonId: lapsed.id,
				seasonOwners: lapsed.owners,
				seasonEditors: lapsed.editors,
				seasons: [lapsed, created],
				manageableSeasonId: created.id,
				manageableSeasonOwners: created.owners,
				manageableSeasonEditors: created.editors
			})
		);
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-card-expand') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).not.toBeNull();
		});
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(
				expect.anything(),
				FUTURE_SEASON_ID
			);
		});
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalledWith(expect.anything(), lapsed.id);
	});
});

describe('#167 review F2 — the database-entity answer is not applied to one gate only', () => {
	it('a CURRENT season with no visible rights + `_owner` on the database entity → event creation AND season creation AND repertoire management, not a contradictory mix', async () => {
		loadFullAgendaMock.mockResolvedValue(currentSeasonAgenda(currentSeasonNoVisibleRights()));
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReadyWithRow();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		await waitFor(() => {
			expect(listWorksMock).toHaveBeenCalled();
		});
		expect(listRepertoireItemsMock).toHaveBeenCalledWith(expect.anything(), CURRENT_SEASON_ID);
		await waitFor(() => {
			expect(loadWorksByEventIdMock).toHaveBeenCalledWith(
				expect.anything(),
				['ev-1'],
				CURRENT_SEASON_ID,
				expect.anything(),
				{ includeInactive: true, cache: 'store' }
			);
		});
	});

	it('fail-closed: the same shape with no database-entity rights leaves EVERY gate shut and the works read filtered', async () => {
		loadFullAgendaMock.mockResolvedValue(currentSeasonAgenda(currentSeasonNoVisibleRights()));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReadyWithRow();

		await flush();
		expect(q(container, 'season-card-expand')).toBeNull();
		expect(q(container, 'event-create')).toBeNull();
		expect(q(container, 'season-create')).toBeNull();
		expect(listWorksMock).not.toHaveBeenCalled();
		expect(loadWorksByEventIdMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ includeInactive: true })
		);
	});
});

describe('#167 review F3 — the database-entity probe is not paid per agenda load', () => {
	function setAuthedWithTwoCollectives() {
		signIn({ collectives: [{ db: 'org-a', name: 'Org A', personId: 'person-p' }, { db: 'org-b', name: 'Org B', personId: 'person-p' }] });
	}

	it('switching A → B → A costs ONE probe pair per collective, not one per load (the trigger is every ordinary member’s normal read)', async () => {
		loadFullAgendaMock.mockResolvedValue(futureOnlyAgenda(futureSeason()));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(2);
		});

		selectedCollectiveDbStore.set('org-a');
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await flush();
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(2);
		const databaseEntityProbes = resolveManageRightsMock.mock.calls.filter(
			(c) => c[1] !== 'person-p'
		);
		expect(databaseEntityProbes).toHaveLength(2);
	});
});

describe('#167 review round 2, F1 — the upgraded works read is not clobbered by the filtered one it raced', () => {
	const retiredRow: WorkRow = {
		id: 'ri-retired',
		kind: 'repertoire',
		workId: 'w-1',
		editionId: '',
		workName: 'Vana laul',
		composer: '',
		status: 'retired',
		editionName: '',
		ordinal: null,
		fileId: '',
		fileName: '',
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};

	it('the FILTERED read settling LAST does not drop the retired rows the database-entity upgrade fetched', async () => {
		loadFullAgendaMock.mockResolvedValue(currentSeasonAgenda(currentSeasonNoVisibleRights()));
		resolveManageRightsMock.mockResolvedValue('editor');

		let releaseFiltered: (value: Record<string, WorkRow[]>) => void = () => {};
		const filtered = new Promise<Record<string, WorkRow[]>>((resolve) => {
			releaseFiltered = resolve;
		});
		loadWorksByEventIdMock.mockImplementation(
			(
				_cfg: unknown,
				_ids: unknown,
				_seasonId: unknown,
				_fetch: unknown,
				opts: { includeInactive: boolean }
			) => (opts.includeInactive ? Promise.resolve({ 'ev-1': [retiredRow] }) : filtered)
		);

		const container = await renderReadyWithRow();

		await waitFor(() => {
			expect(q(container, 'works-line')).not.toBeNull();
		});

		releaseFiltered({});
		await flush();

		expect(q(container, 'works-line')).not.toBeNull();
		expect(q(container, 'works-manage-empty')).toBeNull();
	});
});

describe('#167 review round 2, F2 — a visible grant on the manageable season does not suppress the probe', () => {
	it('lapsed current season with NO visible rights + a future season that HAS them: the database entity is still asked, so repertoire management is not left dead under live controls', async () => {
		const lapsed: Season = {
			id: 'season-lapsed',
			name: 'Season 2025',
			startDate: isoDate(-400),
			endDate: isoDate(-30),
			conductors: [],
			owners: [],
			editors: []
		};
		const created = futureSeason({ owners: ['person-p'] });
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				upcoming: [
					{
						id: 'ev-1',
						name: 'Rehearsal',
						startDatetime: new Date(Date.now() + 3600_000).toISOString(),
						durationMinutes: 90,
						location: '',
						conductors: [],
						owners: [],
						editors: []
					}
				],
				seasons: [lapsed, created]
			})
		);
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReadyWithRow();

		await waitFor(() => {
			expect(q(container, 'season-card-expand')).not.toBeNull();
		});

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'sampledb' }),
				ORG_EFK,
				'person-p'
			);
		});
		await waitFor(() => {
			expect(listWorksMock).toHaveBeenCalled();
		});
		expect(listRepertoireItemsMock).toHaveBeenCalledWith(expect.anything(), lapsed.id);
		await waitFor(() => {
			expect(loadWorksByEventIdMock).toHaveBeenCalledWith(
				expect.anything(),
				['ev-1'],
				lapsed.id,
				expect.anything(),
				{ includeInactive: true, cache: 'store' }
			);
		});
	});

	it('fail-closed on the same shape: no database-entity grant leaves the current season’s repertoire surface read-only and filtered', async () => {
		const lapsed: Season = {
			id: 'season-lapsed',
			name: 'Season 2025',
			startDate: isoDate(-400),
			endDate: isoDate(-30),
			conductors: [],
			owners: [],
			editors: []
		};
		const created = futureSeason({ owners: ['person-p'] });
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				upcoming: [
					{
						id: 'ev-1',
						name: 'Rehearsal',
						startDatetime: new Date(Date.now() + 3600_000).toISOString(),
						durationMinutes: 90,
						location: '',
						conductors: [],
						owners: [],
						editors: []
					}
				],
				seasons: [lapsed, created]
			})
		);
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReadyWithRow();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		await flush();
		expect(q(container, 'season-card-expand')).not.toBeNull();
		expect(loadWorksByEventIdMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ includeInactive: true })
		);
	});
});

// (*MVOX:Tallis*)
