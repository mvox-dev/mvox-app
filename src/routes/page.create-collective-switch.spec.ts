// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['season', 'series', 'event'])
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
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

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { createEventMock, createSeasonMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	listSeriesOptionsForSeasonMock
} from '$lib/testing/mocks/seasons';
import { fillDateTime } from '$lib/testing/timeControls';
import { q } from '$lib/testing/pages/dom';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	SEASON_ID,
	currentSeason,
	fill,
	fixtureRows,
	openEventFormFromPanel,
	openSeasonForm,
	selectValue,
	seriesFixture
} from '$lib/testing/pages/seasonPanel';

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

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue({ items: seriesFixture(), truncated: false });
	listSeriesOptionsForSeasonMock.mockResolvedValue(
		seriesFixture().map(({ id, name }) => ({ id, name }))
	);
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: null
	});
	signIn({
		collectives: [
			{ db: 'org-a', name: 'Org A', personId: 'person-p' },
			{ db: 'org-b', name: 'Org B', personId: 'person-p' }
		]
	});
});

afterEach(() => {
	cleanup();
	for (const mock of [
		loadFullAgendaMock,
		loadRosterMock,
		listSectionsMock,
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
		getSeriesDefaultsMock
	]) {
		mock.mockReset();
	}
	resetAppState();
});

async function renderAgenda(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function openSeason(container: HTMLElement): Promise<void> {
	await openSeasonForm(container);
	await fill(container, 'season-create-name', 'Autumn 2026');
	await fill(container, 'season-create-start', '2026-09-01');
	await fill(container, 'season-create-end', '2026-12-20');
}

async function openEvent(container: HTMLElement): Promise<void> {
	await openEventFormFromPanel(container);
	await selectValue(container, 'event-create-season', SEASON_ID);
	await selectValue(container, 'event-create-type', 'rehearsal');
	await fillDateTime(container, 'event-create-datetime', '2026-09-15', '19:00');
	await fill(container, 'event-create-name', 'Extra rehearsal');
}

async function switchToB(container: HTMLElement): Promise<void> {
	selectedCollectiveDbStore.set('org-b');
	await waitFor(() => {
		expect(q(container, 'season-create-form')).toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
	});
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const FLOWS = [
	{
		kind: 'season',
		open: openSeason,
		submit: 'season-create-submit',
		status: 'season-create-status',
		write: createSeasonMock
	},
	{
		kind: 'event',
		open: openEvent,
		submit: 'event-create-submit',
		status: 'event-create-status',
		write: createEventMock
	}
] as const;

describe.each(FLOWS)('$kind create — a collective switch mid-create', (flow) => {
	it('switch while the database entity is being resolved: the write is never issued', async () => {
		const resolvers: Array<(id: string) => void> = [];
		resolveDatabaseEntityIdMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderAgenda();
		await flow.open(container);
		await fireEvent.click(q(container, flow.submit) as HTMLElement);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		await switchToB(container);
		resolvers[0](ORG_EFK);
		await settle();

		expect(flow.write, 'no write may land in the collective the viewer left').not.toHaveBeenCalled();
		expect((q(container, flow.status)?.textContent ?? '').trim()).toBe('');
	});

	it('switch while the write is in flight: nothing is announced and nothing reloads in the new collective', async () => {
		const resolvers: Array<(id: string) => void> = [];
		flow.write.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderAgenda();
		await flow.open(container);
		await fireEvent.click(q(container, flow.submit) as HTMLElement);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		await switchToB(container);
		await settle();
		const loadsAfterSwitch = loadFullAgendaMock.mock.calls.length;
		resolvers[0]('new-1');
		await settle();

		expect((q(container, flow.status)?.textContent ?? '').trim()).toBe('');
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(loadsAfterSwitch);
	});

	it('switch while the write is in flight, then the write rejects: no error shows in the new collective', async () => {
		const rejecters: Array<(e: Error) => void> = [];
		flow.write.mockImplementation(
			() =>
				new Promise<string>((_resolve, reject) => {
					rejecters.push(reject);
				})
		);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderAgenda();
		await flow.open(container);
		await fireEvent.click(q(container, flow.submit) as HTMLElement);
		await waitFor(() => {
			expect(rejecters.length).toBe(1);
		});

		await switchToB(container);
		rejecters[0](new Error('entu down'));
		await settle();
		errorSpy.mockRestore();

		expect(q(container, `${flow.kind}-create-error`)).toBeNull();
		expect((q(container, flow.status)?.textContent ?? '').trim()).toBe('');
	});
});

// (*MVOX:Josquin*)
