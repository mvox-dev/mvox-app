// Event-create specs: the setup, fixtures and form helpers their files share.
import { cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, expect } from 'vitest';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { Season } from '$lib/seasons/types';
import type { CreateEventInput } from '$lib/entity/entityCreate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { createEventMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addSeasonConductorMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	listSeriesOptionsForSeasonMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	currentSeason,
	fixtureRows,
	isoDate,
	selectValue,
	standaloneFixture
} from '$lib/testing/pages/seasonPanel';

export const UPCOMING_SEASON_ID = 'season-2';

export function upcomingSeason(): Season {
	return {
		id: UPCOMING_SEASON_ID,
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

export function agendaResult(opts: { editor?: boolean; withUpcomingSeason?: boolean } = {}) {
	const { editor = true, withUpcomingSeason = false } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: withUpcomingSeason ? [season, upcomingSeason()] : [season]
	});
}

export function seriesFixture() {
	return [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0 }
	];
}

export function series1Defaults() {
	return {
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: 'Bring the black folder'
	};
}

export function toSeriesOptions(rows: Array<{ id: string; name: string }>) {
	return rows.map(({ id, name }) => ({ id, name }));
}

export async function chooseType(container: HTMLElement, type: string): Promise<void> {
	await selectValue(container, 'event-create-type', type);
}

export function conductorSelect(container: HTMLElement): HTMLSelectElement {
	const field = q(container, 'event-create-conductors-field') as HTMLElement;
	expect(field).not.toBeNull();
	const select = field.querySelector(
		'[data-testid="event-create-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'expected the native event-create-conductor-select').not.toBeNull();
	expect(select.tagName).toBe('SELECT');
	return select;
}

export async function pickConductor(container: HTMLElement, personId: string): Promise<void> {
	await fireEvent.change(conductorSelect(container), { target: { value: personId } });
}

export function lastCreateInput(): CreateEventInput {
	const calls = createEventMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventInput;
}

export async function fillDateTimeAmpm(
	container: HTMLElement,
	prefix: string,
	date: string,
	hour12: string,
	minute: string,
	ampm: 'AM' | 'PM'
): Promise<void> {
	await fireEvent.input(q(container, `${prefix}-date`) as HTMLElement, { target: { value: date } });
	await fireEvent.change(q(container, `${prefix}-hour`) as HTMLElement, {
		target: { value: hour12 }
	});
	await fireEvent.change(q(container, `${prefix}-minute`) as HTMLElement, {
		target: { value: minute }
	});
	await fireEvent.change(q(container, `${prefix}-ampm`) as HTMLElement, { target: { value: ampm } });
}

export function useEventCreatePage(): void {
	beforeEach(() => {
		loadFullAgendaMock.mockResolvedValue(agendaResult());
		loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
		listSectionsMock.mockResolvedValue([]);
		createEventMock.mockResolvedValue('ev-new-1');
		resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
		resolveManageRightsMock.mockResolvedValue('not-editor');
		findMyMemberIdMock.mockResolvedValue(null);
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
		listSeriesOptionsForSeasonMock.mockResolvedValue(toSeriesOptions(seriesFixture()));
		listEventsForSeasonMock.mockResolvedValue(toListRead(standaloneFixture()));
		updateSeasonFieldMock.mockResolvedValue(undefined);
		addSeasonConductorMock.mockResolvedValue(undefined);
		removeSeasonConductorMock.mockResolvedValue(undefined);
		getSeriesDefaultsMock.mockResolvedValue(series1Defaults());
	});

	afterEach(() => {
		cleanup();
		loadFullAgendaMock.mockReset();
		loadRosterMock.mockReset();
		listSectionsMock.mockReset();
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
		resetAppState();
	});
}

// (*MVOX:Tallis*) (*MVOX:Palestrina*) (*MVOX:Josquin*)
