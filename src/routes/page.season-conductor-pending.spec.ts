// @vitest-environment happy-dom
// Season-manage conductor add/remove holds a pending state until the write lands.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

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

import type { Season } from '$lib/seasons/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
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
import { cleanupClearReset, q } from '$lib/testing/pages/dom';
import { CFG, flush } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	SEASON_ID,
	fixtureRows,
	isoDate,
	openPanelForSeason,
	seriesFixture
} from '$lib/testing/pages/seasonPanel';
import { openPanel } from '$lib/testing/pages/seasonManage';
import { upcomingSeason } from '$lib/testing/pages/seasonFields';
import { renderReady } from '$lib/testing/pages/seasonRender';

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: ['p-grace'],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function agendaResult() {
	const season = currentSeason(true);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function twoSeasonResult() {
	return fullAgendaResult({ seasons: [currentSeason(true), upcomingSeason()] });
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
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

afterEach(cleanupClearReset);

function conductorSelect(container: HTMLElement): HTMLSelectElement {
	const select = q(container, 'season-manage-conductor-select') as HTMLSelectElement | null;
	expect(select, 'expected the native season-manage-conductor-select').not.toBeNull();
	return select!;
}

async function pickConductor(container: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(container), { target: { value: personId } });
}

describe('#325 conductor — four states at rest (not yet attempted)', () => {
	it('open panel: PERSISTENT empty role="status" region (season-manage-conductor-status, #267 same-node shape), NO pending notice, NO error, select enabled', async () => {
		const container = await renderReady();
		await openPanel(container);

		const status = q(container, 'season-manage-conductor-status');
		expect(status, 'expected the persistent season-manage-conductor-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-error')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

describe('#325 conductor — a write in flight disables the surface (duplicate/lost-remove race closed)', () => {
	it('add in flight: select AND every chip remove button disable; the visible saving notice (caveat-slot paragraph, role="status") shows; a second pick fires NO second POST (a duplicate POST would APPEND a second conductor value); settle → re-enabled, notice gone, saved announced', async () => {
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(1);
		expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');

		await waitFor(() => {
			const notice = q(container, 'season-manage-conductor-pending-notice');
			expect(notice, 'expected the visible pending notice while the write is in flight').not.toBeNull();
			expect(notice!.getAttribute('role')).toBe('status');
			expect(notice!.textContent).toContain('season_manage_conductor_saving');
		});

		expect(conductorSelect(container).disabled).toBe(true);
		expect(
			(q(container, 'season-manage-conductor-remove-p-grace') as HTMLButtonElement).disabled
		).toBe(true);
		const optimisticRemove = q(container, 'season-manage-conductor-remove-p-ada');
		if (optimisticRemove !== null) {
			expect((optimisticRemove as HTMLButtonElement).disabled).toBe(true);
		}

		await pickConductor(container, 'person-p');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		});
		expect(conductorSelect(container).disabled).toBe(false);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-status')?.textContent).toContain(
				'season_manage_conductor_saved'
			);
		});

		await pickConductor(container, 'person-p');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(2);
	});

	it('remove in flight: the select disables and a re-add pick fires NO POST (a re-add the in-flight remove could then delete = the lost-remove race); pending notice shows; settle → saved announced, exactly one DELETE-side call', async () => {
		const d = deferred<undefined>();
		removeSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		expect(removeSeasonConductorMock).toHaveBeenCalledTimes(1);
		expect(removeSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-grace');

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});
		expect(conductorSelect(container).disabled).toBe(true);

		await pickConductor(container, 'p-grace');
		expect(addSeasonConductorMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		});
		expect(removeSeasonConductorMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-status')?.textContent).toContain(
				'season_manage_conductor_saved'
			);
		});
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

describe('#325 conductor — failure text kept, controls re-enabled for retry', () => {
	it('a rejected add keeps the EXISTING season-manage-conductor-error role="alert" (season_manage_save_error), reverts the optimistic chip, drops the pending notice, announces NO saved, and re-enables the select — a retry write fires', async () => {
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValueOnce(d.promise);
		const container = await renderReady();
		await openPanel(container);

		await pickConductor(container, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});

		d.reject(new Error('conductor write rejected'));
		await waitFor(() => {
			const alert = q(container, 'season-manage-conductor-error');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('season_manage_save_error');
		});
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-status')?.textContent ?? '').not.toContain(
			'season_manage_conductor_saved'
		);
		expect(conductorSelect(container).disabled).toBe(false);

		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledTimes(2);
	});
});

describe('#325 conductor — the pending flag does not leak across a season switch', () => {
	it('an add on A still in flight when the admin switches to B: B’s panel shows NO pending notice and an ENABLED select; A’s write settling late announces NOTHING and re-raises NO pending on B (seasonManageSwitchGeneration gates the settle path)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const d = deferred<undefined>();
		addSeasonConductorMock.mockReturnValue(d.promise);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await pickConductor(container, 'p-ada');
		expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-pending-notice')).not.toBeNull();
		});

		await openPanelForSeason(container, 'Season 2027');

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
		expect(q(container, 'season-manage-conductor-status')?.textContent?.trim() ?? '').toBe('');

		d.resolve(undefined);
		await flush();

		expect(q(container, 'season-manage-conductor-pending-notice')).toBeNull();
		expect(q(container, 'season-manage-conductor-status')?.textContent?.trim() ?? '').toBe('');
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
		expect(conductorSelect(container).disabled).toBe(false);
	});
});

// (*MVOX:Tallis*)
