// @vitest-environment happy-dom
// The agenda page resolves the collective as its database entity.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['season'])
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/entu/request', async (importOriginal) =>
	(await import('$lib/testing/mocks/seasons')).entuRequestModule(importOriginal)
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
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

import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { createSeasonMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { entuFetchMock } from '$lib/testing/mocks/seasons';
import { cleanupClearReset, q } from '$lib/testing/pages/dom';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { fill, isoDate, openSeasonForm } from '$lib/testing/pages/seasonPanel';
import { currentSeason } from '$lib/testing/pages/agenda';
import { CFG } from '$lib/testing/pages/roster';
import { DB_ENTITY } from '$lib/testing/pages/admin';

function agendaResult() {
	const season = currentSeason();
	return fullAgendaResult({
		seasonId: season.id,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: DB_ENTITY
		}
	];
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(DB_ENTITY);
	entuFetchMock.mockRejectedValue(
		new Error(
			'wire disabled in this spec — collective resolution must go through resolveDatabaseEntityId'
		)
	);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
});

afterEach(cleanupClearReset);

describe('main page — season create resolves the DATABASE entity as the collective (#161)', () => {
	it('submit: resolveDatabaseEntityId is consulted and createSeason receives ITS id as the structural parent — no other wire traffic resolves the collective', async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		await fill(container, 'season-create-name', 'Season 2027');
		await fill(container, 'season-create-start', isoDate(70));
		await fill(container, 'season-create-end', isoDate(240));
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});

		expect(resolveDatabaseEntityIdMock).toHaveBeenCalled();
		expect(resolveDatabaseEntityIdMock.mock.calls[0][0]).toMatchObject(CFG);

		expect(createSeasonMock).toHaveBeenCalledWith(
			CFG,
			expect.objectContaining({ name: 'Season 2027', dbEntityId: DB_ENTITY })
		);

		expect(entuFetchMock).not.toHaveBeenCalled();

		expect(q(container, 'season-create-error')).toBeNull();
	});
});

// (*MVOX:Tallis*)
