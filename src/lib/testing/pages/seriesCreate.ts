// Series-create specs: the setup and form helpers their files share.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect } from 'vitest';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fillTime } from '$lib/testing/timeControls';
import type { Season } from '$lib/seasons/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addSeasonConductorMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	NEW_SERIES_ID,
	SEASON_END,
	SEASON_ID,
	SEASON_START,
	fill,
	seriesFixture,
	standaloneFixture
} from '$lib/testing/pages/seasonPanel';

export function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

export function agendaResult(opts: { editor?: boolean } = {}) {
	const { editor = true } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

export async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
}

export async function fillValidTemplate(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
}

export async function settleSeriesRun(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'series-create-form')).toBeNull();
	});
}

export function previewDates(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="series-create-date-"]')].map(
		(el) => el.getAttribute('data-testid')?.replace('series-create-date-', '') ?? ''
	);
}

export function dateChip(container: HTMLElement, iso: string): HTMLButtonElement | null {
	return container.querySelector(`[data-testid="series-create-date-${iso}"]`);
}

export async function toggleDate(container: HTMLElement, iso: string): Promise<void> {
	const chip = dateChip(container, iso);
	expect(chip, `chip series-create-date-${iso} must be rendered`).not.toBeNull();
	await fireEvent.click(chip as HTMLButtonElement);
}

export function useSeriesCreatePage(): void {
	beforeEach(() => {
		loadFullAgendaMock.mockResolvedValue(agendaResult());
		loadRosterMock.mockResolvedValue(toListRead([]));
		createEventSeriesMock.mockResolvedValue(NEW_SERIES_ID);
		createEventMock.mockImplementation(async () => `ev-new-${createEventMock.mock.calls.length}`);
		resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
		resolveManageRightsMock.mockResolvedValue('not-editor');
		findMyMemberIdMock.mockResolvedValue(null);
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
		listEventsForSeasonMock.mockResolvedValue(toListRead(standaloneFixture()));
		updateSeasonFieldMock.mockResolvedValue(undefined);
		addSeasonConductorMock.mockResolvedValue(undefined);
		removeSeasonConductorMock.mockResolvedValue(undefined);
		getSeriesDefaultsMock.mockResolvedValue(null);
	});

	afterEach(() => {
		cleanup();
		loadFullAgendaMock.mockReset();
		loadRosterMock.mockReset();
		createEventSeriesMock.mockReset();
		createEventMock.mockReset();
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
		getSeriesDefaultsMock.mockReset();
		resetAppState();
	});
}

// (*MVOX:Tallis*) (*MVOX:Palestrina*) (*MVOX:Josquin*)
