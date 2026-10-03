// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);

const {
	loadRosterMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock,
	deleteEventMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn(),
	deleteEventMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEvent: deleteEventMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock,
	countSeasonScope: countSeasonScopeMock,
	deleteSeason: deleteSeasonMock
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: vi.fn()
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
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
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';
const VIEWER = 'person-p';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: ['cond-1'],
		owners: [],
		editors: [VIEWER]
	};
}

function agendaResult() {
	const season = currentSeason();
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

interface OwnedSeriesRow {
	id: string;
	name: string;
	eventCount: number;
	ownerIds: string[];
}

function threeSeries(): OwnedSeriesRow[] {
	return [
		{ id: 'series-mine', name: 'Monday rehearsals', eventCount: 12, ownerIds: [VIEWER, 'person-x'] },
		{ id: 'series-theirs', name: 'Sectionals', eventCount: 3, ownerIds: ['person-other'] },
		{ id: 'series-opaque', name: 'Concert week', eventCount: 0, ownerIds: [] }
	];
}

let seriesRows: OwnedSeriesRow[] = [];

function setAuthedWithOneCollective(): void {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: VIEWER }] });
}

beforeEach(() => {
	seriesRows = threeSeries();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockImplementation(async () => toSeriesRead([...seriesRows]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: '',
		durationMinutes: null,
		defaultLocation: '',
		defaultDescription: ''
	});
	deleteEventMock.mockResolvedValue(undefined);
	deleteEventSeriesMock.mockResolvedValue(0);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
	deleteSeasonMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
});

afterEach(() => {
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
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function openPanelWithRows(container: HTMLElement): Promise<HTMLElement> {
	const panel = await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, `season-manage-series-${seriesRows[0].id}`)).not.toBeNull();
	});
	return panel;
}

function allSeriesDeleteAffordances(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid^="season-manage-series-delete-"]'));
}

describe('agenda — #400 series-delete renders only with _owner on the series itself (integration: real route)', () => {
	it('a series whose _owner includes the caller keeps its delete trigger', async () => {
		const container = await renderReady();
		const panel = await openPanelWithRows(container);

		const btn = q(container, 'season-manage-series-delete-series-mine') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.tagName).toBe('BUTTON');
		expect(btn.getAttribute('aria-label') || btn.textContent?.trim()).toBeTruthy();
		expect(panel.contains(btn)).toBe(true);
	});

	it('a series whose _owner EXCLUDES the caller renders NO delete trigger — while the row itself (name, event count) stays', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		const row = q(container, 'season-manage-series-series-theirs') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.textContent).toContain('Sectionals');
		expect(row.textContent).toContain('season_manage_series_event_count');

		expect(q(container, 'season-manage-series-delete-series-theirs')).toBeNull();
	});

	it('a series whose _owner came back ABSENT (private bucket withheld — no visible grant) renders NO delete trigger: fail closed', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		expect(q(container, 'season-manage-series-series-opaque')).not.toBeNull();
		expect(q(container, 'season-manage-series-delete-series-opaque')).toBeNull();
	});

	it('mixed list: EXACTLY one delete trigger on the page, inside the owned series’ own row', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		const affordances = allSeriesDeleteAffordances(container);
		expect(affordances).toHaveLength(1);
		expect(affordances[0].getAttribute('data-testid')).toBe(
			'season-manage-series-delete-series-mine'
		);
		expect(
			affordances[0].closest('[data-testid="season-manage-series-series-mine"]')
		).not.toBeNull();
	});
});

describe('agenda — #400 the forbidden fallback is unreachable from a rendered control', () => {
	it('with only NOT-owned series in the list there is NO series-delete affordance anywhere, and the delete write is never called', async () => {
		seriesRows = [
			{ id: 'series-theirs', name: 'Sectionals', eventCount: 3, ownerIds: ['person-other'] },
			{ id: 'series-opaque', name: 'Concert week', eventCount: 0, ownerIds: [] }
		];
		const container = await renderReady();
		await openPanelWithRows(container);

		expect(allSeriesDeleteAffordances(container)).toHaveLength(0);
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(countSeriesOccurrencesMock).not.toHaveBeenCalled();
	});
});

describe('agenda — #400 the season-level gate still wraps every other control unchanged', () => {
	it('a season editor with NO grant on any listed series still gets: panel entry, season delete, name/date edit, conductor chip + × + select, add-series, add-event', async () => {
		seriesRows = [
			{ id: 'series-theirs', name: 'Sectionals', eventCount: 3, ownerIds: ['person-other'] }
		];
		const container = await renderReady();
		await openPanelWithRows(container);

		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		expect(q(container, 'season-edit-btn-name')).not.toBeNull();
		expect(q(container, 'season-edit-btn-start_date')).not.toBeNull();
		expect(q(container, 'season-edit-btn-end_date')).not.toBeNull();
		expect(q(container, 'season-manage-conductor-cond-1')).not.toBeNull();
		expect(q(container, 'season-manage-conductor-remove-cond-1')).not.toBeNull();
		expect(q(container, 'season-manage-conductor-select')).not.toBeNull();
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
});

// (*MVOX:Tallis*)
