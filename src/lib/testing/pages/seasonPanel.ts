// Root page season panel harness: dates, fixtures and panel helpers its specs had word for word.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import type { CreateEventSeriesInput } from '$lib/entity/entityCreate';
import type { RosterRow } from '$lib/roster/rosterData';
import type { Season } from '$lib/seasons/types';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { createEventSeriesMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addSeasonConductorMock,
	countSeasonScopeMock,
	countSeriesOccurrencesMock,
	deleteEventMock,
	deleteEventSeriesMock,
	deleteSeasonMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { signIn } from '$lib/testing/session';
import { q } from './dom';
import { ORG_EFK } from './rosterFixtures';

export const SEASON_ID = 'season-1';

export const SEASON_B_ID = 'season-2';

export function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export const SEASON_START = isoDate(-30);

export const SEASON_END = isoDate(60);

export const NEW_SERIES_ID = 'series-new-1';

export const CARD = 'agenda-admin-card';

export type PageOnProgress = (current: number, total: number, kind: string) => void;

export function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

export function upcomingSeason(): Season {
	return {
		id: 'season-2',
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

export function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-grace',
			personId: 'p-grace',
			name: 'Grace Hopper',
			email: 'grace@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

export function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

export function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

export function noSeasonsResult() {
	return fullAgendaResult();
}

export function setAuthedWithTwoCollectives(): void {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'org-b', name: 'Org B', personId: 'person-p' }
		]
	});
}

export async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

export async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

export async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
}

export async function enableMondayGeneration(container: HTMLElement): Promise<void> {
	await selectValue(container, 'series-create-day', '1');
}

export async function openSeasonForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-create-form')).not.toBeNull();
	});
}

export async function openSeriesForm(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
}

export async function openFormFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

export async function openEventFormFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

// The season trashcan lives on the opened title row (#261), so open the card first.
export async function armSeasonDelete(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season-confirm')).not.toBeNull();
	});
}

export async function openPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
}

export function expandButtons(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll('[data-testid="season-card-expand"]')
	) as HTMLElement[];
}

export function expandFor(container: HTMLElement, seasonName: string): HTMLElement | null {
	return expandButtons(container).find((b) => b.textContent?.includes(seasonName)) ?? null;
}

export async function openPanelForSeason(container: HTMLElement, seasonName: string): Promise<void> {
	await waitFor(() => {
		expect(expandFor(container, seasonName), `an entry for ${seasonName}`).not.toBeNull();
	});
	await fireEvent.click(expandFor(container, seasonName) as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe(seasonName);
	});
}

export function promptOption(select: HTMLSelectElement): HTMLOptionElement {
	const prompt = select.querySelector('option') as HTMLOptionElement;
	expect(prompt, 'expected a first (prompt) option').not.toBeNull();
	expect(prompt.value).toBe('');
	expect(prompt.disabled).toBe(true);
	expect(prompt.hidden).toBe(true);
	return prompt;
}

export function conductorSelect(panel: HTMLElement): HTMLSelectElement {
	const select = panel.querySelector(
		'[data-testid="season-manage-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'expected the native season-manage-conductor-select').not.toBeNull();
	expect(select.tagName).toBe('SELECT');
	return select;
}

export function lastSeriesInput(): CreateEventSeriesInput {
	const calls = createEventSeriesMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventSeriesInput;
}

export function cleanupResetSeasonDeleteMocks(): void {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
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
	deleteEventMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
	resetAppState();
}

// (*MVOX:Josquin*)
