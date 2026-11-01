// @vitest-environment happy-dom
// #1049: each failed write on the agenda (create, season manage, deletes) keeps one report,
// filed under the collective the write started in, and a late failure never shows on the next.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['season', 'series', 'event'])
);
vi.mock('$lib/seasons/seasonManage', async () => {
	const seasons = await import('$lib/testing/mocks/seasons');
	return { ...seasons.seasonManageModule(), ...seasons.seasonManageWritesModule({ deleteEvent: false }) };
});
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
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('empty')
);
vi.mock('$lib/files/retention', () => ({
	ensureRetentionSweep: async () => {},
	seedRetentionKeys: () => {}
}));
vi.mock('$lib/files/appByteStore', async () =>
	(await import('$lib/testing/mocks/files')).fakeAppByteStoreModule()
);

import Page from './agenda/+page.svelte';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { selectedCollectiveDbStore, selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { deferred } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock, createSeasonMock } from '$lib/testing/mocks/events';
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
	listSeriesOptionsForSeasonMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import { currentSeason, seriesFixture } from '$lib/testing/pages/seasonManage';
import { editField, pickConductor } from '$lib/testing/pages/seasonManagePanel';
import {
	SEASON_ID,
	enableMondayGeneration,
	fill,
	fixtureRows,
	openEventFormFromPanel,
	openSeasonForm,
	openSeriesForm,
	selectValue,
	standaloneFixture
} from '$lib/testing/pages/seasonPanel';
import { fillValidTemplate } from '$lib/testing/pages/seriesCreate';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { signIn } from '$lib/testing/session';
import { fillDateTime } from '$lib/testing/timeControls';

useKeptProblems();

const A = { db: 'org-a', name: 'Org A', personId: 'person-p' };
const B = { db: 'org-b', name: 'Org B', personId: 'person-p' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// B reuses A's season and series ids, so a stale error keyed by id would show on B.
function agenda(db: string) {
	const season = { ...currentSeason(true), name: db === A.db ? 'Season 2026' : 'Season 2026 B' };
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	signIn({ collectives: [A, B], selected: A.db });
	loadFullAgendaMock.mockImplementation(async () => agenda(get(selectedCollectiveDbStore) ?? ''));
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listSeriesOptionsForSeasonMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue(toListRead(standaloneFixture()));
	getSeriesDefaultsMock.mockResolvedValue(null);
	createSeasonMock.mockResolvedValue('season-new');
	createEventMock.mockResolvedValue('ev-new');
	createEventSeriesMock.mockResolvedValue('series-new');
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 0, events: 0, repertoireItems: 0 });
	deleteEventSeriesMock.mockResolvedValue(0);
	deleteSeasonMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	for (const mock of [
		loadFullAgendaMock,
		loadRosterMock,
		listSectionsMock,
		resolveDatabaseEntityIdMock,
		resolveManageRightsMock,
		findMyMemberIdMock,
		listMyRsvpsMock,
		listEventSeriesForSeasonMock,
		listSeriesOptionsForSeasonMock,
		listEventsForSeasonMock,
		getSeriesDefaultsMock,
		createSeasonMock,
		createEventMock,
		createEventSeriesMock,
		updateSeasonFieldMock,
		addSeasonConductorMock,
		removeSeasonConductorMock,
		countSeriesOccurrencesMock,
		countSeasonScopeMock,
		deleteEventSeriesMock,
		deleteSeasonMock
	]) {
		mock.mockReset();
	}
	vi.restoreAllMocks();
	resetAppState();
});

async function ready(c: HTMLElement, season: string): Promise<void> {
	await waitFor(() => expect(q(c, 'season-card-expand')?.textContent).toContain(season));
}

async function shown(c: HTMLElement, id: string): Promise<void> {
	await waitFor(() => expect(q(c, id)).not.toBeNull());
}

async function click(c: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(q(c, id) as HTMLElement);
}

async function seasonForm(c: HTMLElement): Promise<void> {
	await openSeasonForm(c);
	await fill(c, 'season-create-name', 'Autumn 2026');
	await fill(c, 'season-create-start', '2026-09-01');
	await fill(c, 'season-create-end', '2026-12-20');
}

async function eventForm(c: HTMLElement): Promise<void> {
	await openEventFormFromPanel(c);
	await selectValue(c, 'event-create-season', SEASON_ID);
	await selectValue(c, 'event-create-type', 'rehearsal');
	await fillDateTime(c, 'event-create-datetime', '2026-09-15', '19:00');
	await fill(c, 'event-create-name', 'Extra rehearsal');
}

async function seriesForm(c: HTMLElement): Promise<void> {
	await openSeriesForm(c);
	await fillValidTemplate(c);
	await enableMondayGeneration(c);
}

async function panel(c: HTMLElement): Promise<void> {
	await openSeasonCardPanel(c);
	await shown(c, 'season-manage-series-series-1');
}

async function armSeriesDelete(c: HTMLElement): Promise<void> {
	await panel(c);
	await click(c, 'season-manage-series-delete-series-1');
	await shown(c, 'season-manage-series-delete-confirm-series-1');
}

async function armSeasonDelete(c: HTMLElement): Promise<void> {
	await panel(c);
	await click(c, 'season-manage-delete-season');
	await shown(c, 'season-manage-delete-season-confirm');
}

const alerts = (c: HTMLElement) =>
	Array.from(c.querySelectorAll('[role="alert"]'), (el) => el.textContent?.trim());

interface Row {
	site: string;
	write: () => Mock;
	// 'null': the database entity lookup answers with nothing instead of failing.
	outcome?: 'null';
	// The writes the act makes before the one that fails (series occurrences come one by one).
	before?: number;
	act: (c: HTMLElement) => Promise<void>;
	error: string;
	action: string;
	detail?: string;
	// Opens on B, before the late failure, the place the stale error would show.
	reveal?: (c: HTMLElement) => Promise<void>;
	// A create blocks B's entry points while it runs, so its form opens on B only after it settles.
	after?: (c: HTMLElement) => Promise<void>;
	revealed: string;
}

const NO_DB_ENTITY = 'no database entity is visible in this collective';

const ROWS: Row[] = [
	{
		site: 'season create: the write',
		write: () => createSeasonMock,
		act: async (c) => {
			await seasonForm(c);
			await click(c, 'season-create-submit');
		},
		error: 'season-create-error',
		action: 'creating a season',
		after: seasonForm,
		revealed: 'season-create-form'
	},
	{
		site: 'season create: the database entity lookup throws',
		write: () => resolveDatabaseEntityIdMock,
		act: async (c) => {
			await seasonForm(c);
			await click(c, 'season-create-submit');
		},
		error: 'season-create-error',
		action: 'resolving the database entity for creating a season',
		after: seasonForm,
		revealed: 'season-create-form'
	},
	{
		site: 'season create: no database entity is visible',
		write: () => resolveDatabaseEntityIdMock,
		outcome: 'null',
		act: async (c) => {
			await seasonForm(c);
			await click(c, 'season-create-submit');
		},
		error: 'season-create-error',
		action: 'resolving the database entity for creating a season',
		detail: NO_DB_ENTITY,
		after: seasonForm,
		revealed: 'season-create-form'
	},
	{
		site: 'event create: the write',
		write: () => createEventMock,
		act: async (c) => {
			await eventForm(c);
			await click(c, 'event-create-submit');
		},
		error: 'event-create-error',
		action: 'creating an event',
		after: eventForm,
		revealed: 'event-create-form'
	},
	{
		site: 'series create: the series write',
		write: () => createEventSeriesMock,
		act: async (c) => {
			await seriesForm(c);
			await click(c, 'series-create-submit');
		},
		error: 'series-create-error',
		action: 'creating a series',
		after: seriesForm,
		revealed: 'series-create-form'
	},
	{
		site: 'series create: an occurrence write',
		write: () => createEventMock,
		before: 1,
		act: async (c) => {
			await seriesForm(c);
			await click(c, 'series-create-submit');
		},
		error: 'series-create-error',
		action: 'creating a series occurrence',
		after: seriesForm,
		revealed: 'series-create-form'
	},
	{
		site: 'series create: no database entity is visible',
		write: () => resolveDatabaseEntityIdMock,
		outcome: 'null',
		act: async (c) => {
			await seriesForm(c);
			await click(c, 'series-create-submit');
		},
		error: 'series-create-error',
		action: 'resolving the database entity for creating a series',
		detail: NO_DB_ENTITY,
		after: seriesForm,
		revealed: 'series-create-form'
	},
	{
		site: 'SeasonManageFields: a field save',
		write: () => updateSeasonFieldMock,
		act: async (c) => {
			await panel(c);
			await editField(c, 'name', 'Season 2027');
		},
		error: 'season-edit-error-name',
		action: 'saving the season field name',
		reveal: panel,
		revealed: 'season-manage-panel'
	},
	{
		site: 'SeasonManageConductors: adding a conductor',
		write: () => addSeasonConductorMock,
		act: async (c) => {
			await panel(c);
			await pickConductor(q(c, 'season-manage-panel') as HTMLElement, 'p-ada');
		},
		error: 'season-manage-conductor-error',
		action: 'adding a season conductor',
		reveal: panel,
		revealed: 'season-manage-panel'
	},
	{
		site: 'SeasonManageConductors: removing a conductor',
		write: () => removeSeasonConductorMock,
		act: async (c) => {
			await panel(c);
			await shown(c, 'season-manage-conductor-remove-p-grace');
			await click(c, 'season-manage-conductor-remove-p-grace');
		},
		error: 'season-manage-conductor-error',
		action: 'removing a season conductor',
		reveal: panel,
		revealed: 'season-manage-panel'
	},
	{
		site: 'SeasonManageSeries: deleting a series',
		write: () => deleteEventSeriesMock,
		act: async (c) => {
			await armSeriesDelete(c);
			await click(c, 'season-manage-series-delete-confirm-series-1');
		},
		error: 'season-manage-delete-error',
		action: 'deleting an event series',
		reveal: armSeriesDelete,
		revealed: 'season-manage-series-delete-confirm-series-1'
	},
	{
		site: 'SeasonCardHeader: deleting the season',
		write: () => deleteSeasonMock,
		act: async (c) => {
			await armSeasonDelete(c);
			await click(c, 'season-manage-delete-season-confirm');
		},
		error: 'season-manage-delete-error',
		action: 'deleting a season',
		reveal: armSeasonDelete,
		revealed: 'season-manage-delete-season-confirm'
	}
];

const kept = (row: Row) => [{ area: 'agenda', action: row.action, detail: row.detail ?? 'Error: boom-a' }];

async function renderPage(): Promise<HTMLElement> {
	const { container } = render(Page);
	await ready(container, 'Season 2026');
	return container;
}

describe('agenda — a failed write keeps one report (#1049)', () => {
	it.each(ROWS.map((row) => [row.site, row] as const))('%s', async (_, row) => {
		const c = await renderPage();
		const calls = row.write().mock.calls.length;
		if (row.before) row.write().mockResolvedValueOnce('ev-first');
		row.write().mockImplementationOnce(() =>
			row.outcome === 'null' ? Promise.resolve(null) : Promise.reject(new Error('boom-a'))
		);

		await row.act(c);

		await waitFor(() => expect(row.write().mock.calls.length).toBeGreaterThan(calls));
		await shown(c, row.error);
		await waitFor(async () => expect(await keptProblems()).toEqual(kept(row)));
	});

	it.each(ROWS.map((row) => [row.site, row] as const))(
		'%s, settling after a switch: kept under the collective it started in, nothing on the new one',
		async (_, row) => {
			const held = deferred<null>();
			const c = await renderPage();
			// The load may read through the same mock (the database entity), so count from here.
			const calls = row.write().mock.calls.length + (row.before ?? 0) + 1;
			if (row.before) row.write().mockResolvedValueOnce('ev-first');
			row.write().mockImplementationOnce(() => held.promise);
			const identityA = get(selectedCollectiveIdentityStore);
			await row.act(c);
			await waitFor(() => expect(row.write()).toHaveBeenCalledTimes(calls));

			selectedCollectiveDbStore.set(B.db);
			await ready(c, 'Season 2026 B');
			const identityB = get(selectedCollectiveIdentityStore);
			await row.reveal?.(c);
			const alertsOnB = alerts(c);
			if (row.outcome === 'null') held.resolve(null);
			else held.reject(new Error('boom-a'));
			await settle();
			await row.after?.(c);

			expect(await keptProblems(identityA)).toEqual(kept(row));
			expect(await keptProblems(identityB)).toEqual([]);
			expect(q(c, row.error)).toBeNull();
			expect(alerts(c)).toEqual(alertsOnB);
			expect(q(c, row.revealed)).not.toBeNull();
		}
	);

	it('a series delete for A failing after a switch leaves B’s own running delete busy', async () => {
		const heldA = deferred<number>();
		const heldB = deferred<number>();
		const c = await renderPage();
		deleteEventSeriesMock.mockImplementationOnce(() => heldA.promise);
		deleteEventSeriesMock.mockImplementationOnce(() => heldB.promise);
		await armSeriesDelete(c);
		await click(c, 'season-manage-series-delete-confirm-series-1');

		selectedCollectiveDbStore.set(B.db);
		await ready(c, 'Season 2026 B');
		await armSeriesDelete(c);
		await click(c, 'season-manage-series-delete-confirm-series-1');
		await waitFor(() => expect(deleteEventSeriesMock).toHaveBeenCalledTimes(2));
		heldA.reject(new Error('boom-a'));
		await settle();

		const confirm = q(c, 'season-manage-series-delete-confirm-series-1') as HTMLButtonElement;
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		expect(confirm.disabled).toBe(true);
	});

	it('a season field save refused for an expired session shows its error and keeps nothing', async () => {
		const c = await renderPage();
		updateSeasonFieldMock.mockRejectedValueOnce(new AuthExpiredError());

		await panel(c);
		await editField(c, 'name', 'Season 2027');

		await shown(c, 'season-edit-error-name');
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('a page that loads and opens the panel without failing keeps nothing', async () => {
		const c = await renderPage();

		await panel(c);
		await settle();
		expect(await keptProblems()).toEqual([]);
	});
});

// (*MVOX:Josquin*)
