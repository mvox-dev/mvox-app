// Season-manage panel specs: the setup and fixtures their files share.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect } from 'vitest';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { createFakeByteStore } from '$lib/testing/byteStoreFakes';
import { setAppByteStore } from '$lib/testing/mocks/files';
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
import { q } from '$lib/testing/pages/dom';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	conductorSelect,
	expandFor,
	fixtureRows,
	standaloneFixture,
	upcomingSeason
} from '$lib/testing/pages/seasonPanel';
import { agendaResult, currentSeason, seriesFixture } from '$lib/testing/pages/seasonManage';

export async function editField(container: HTMLElement, field: string, value: string): Promise<void> {
	await fireEvent.click(q(container, `season-edit-btn-${field}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-edit-input-${field}`)).not.toBeNull();
	});
	const input = q(container, `season-edit-input-${field}`) as HTMLInputElement;
	await fireEvent.input(input, { target: { value } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

export async function pickConductor(panel: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(panel), { target: { value: personId } });
}

export async function openPanelForSeason(container: HTMLElement, seasonName: string): Promise<HTMLElement> {
	await waitFor(() => {
		expect(expandFor(container, seasonName), `an entry for ${seasonName}`).not.toBeNull();
	});
	await fireEvent.click(expandFor(container, seasonName) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe(seasonName);
	});
	return q(container, 'season-manage-panel') as HTMLElement;
}

export function twoSeasonResult(opts: { aEditor?: boolean; bEditor?: boolean } = {}) {
	const { aEditor = true, bEditor = true } = opts;
	return fullAgendaResult({
		seasons: [currentSeason(aEditor), { ...upcomingSeason(), editors: bEditor ? ['person-p'] : [] }]
	});
}

export const seriesA = [
	{ id: 'series-a1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] }
];

export async function armAndConfirmSeriesDelete(container: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(q(container, `season-manage-series-delete-${id}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-manage-series-delete-confirm-${id}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `season-manage-series-delete-confirm-${id}`) as HTMLElement);
}

export function useSeasonManagePage(): void {
	beforeEach(() => {
		setAppByteStore(createFakeByteStore());
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
}

// (*MVOX:Tallis*) (*MVOX:Josquin*)
