// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

const {
	loadFullAgendaMock,
	loadRosterMock,
	createEventSeriesMock,
	createEventMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createEventSeriesMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: createEventSeriesMock,
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
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
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
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { Season } from '$lib/seasons/types';
import type { CreateEventInput, CreateEventSeriesInput } from '$lib/entity/entityCreate';
import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';

const CANONICAL_EVENT_TYPES = [
	'rehearsal',
	'concert',
	'service',
	'festival',
	'retreat',
	'trip',
	'workshop',
	'meeting',
	'social',
	'other'
];

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const SEASON_ID = 'season-1';
const NEW_SERIES_ID = 'series-new-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

const SEASON_START = isoDate(-30);
const SEASON_END = isoDate(60);

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors: [],
		owners: [],
		editors: ['person-p']
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

function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

function standaloneFixture() {
	return [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
}

function setAuthedWithOneCollective() {
	signIn();
}

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
	listSeriesOptionsForSeasonMock.mockResolvedValue(
		seriesFixture().map(({ id, name }) => ({ id, name }))
	);
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
	listSeriesOptionsForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
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

async function openSeriesForm(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
}

async function openEventFormFromPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

function optionPairs(select: HTMLSelectElement): Array<[string, string]> {
	return [...select.querySelectorAll('option')].map((o) => [o.value, (o.textContent ?? '').trim()]);
}

function canonicalPairs(): Array<[string, string]> {
	return CANONICAL_EVENT_TYPES.map((key) => [key, `event_type_${key}`]);
}

function eventPickerPairs(): Array<[string, string]> {
	return [['', 'event_create_type_placeholder'], ...canonicalPairs()];
}

async function fillValidSeriesTemplate(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
	await selectValue(container, 'series-create-day', '1');
}

function lastSeriesInput(): CreateEventSeriesInput {
	const calls = createEventSeriesMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventSeriesInput;
}

function lastEventInput(): CreateEventInput {
	const calls = createEventMock.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][1] as CreateEventInput;
}

describe('series form — series-create-type is a localized canonical picker', () => {
	it('renders a <select>, not a text input', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type');
		expect(type).not.toBeNull();
		expect(type?.tagName).toBe('SELECT');
	});

	it('offers EXACTLY the 10 canonical types (#266), pinned order, canonical keys as values and the paraglide event_type_* messages as labels — no "" placeholder, no free-text prior types mixed in', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(optionPairs(type)).toEqual(canonicalPairs());
	});

	it('defaults to rehearsal — as the PICKER’s selection (the old shape, a text input pre-filled "rehearsal", is not this contract)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(type.tagName).toBe('SELECT');
		expect(type.value).toBe('rehearsal');
	});

	it('an untouched PICKER submits the canonical DEFAULT: createEventSeries gets eventType "rehearsal"', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		expect((q(container, 'series-create-type') as HTMLElement).tagName).toBe('SELECT');
		await fillValidSeriesTemplate(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().eventType).toBe('rehearsal');
	});

	it('#242 guard — the series picker is UNTOUCHED by the standalone empty-start ruling: still defaults to rehearsal, still no "" placeholder option', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(type.value).toBe('rehearsal');
		expect(optionPairs(type)).toEqual(canonicalPairs());
	});

	it('a PICKED type stores the canonical ENGLISH key — the viewer who sees "Kontsert" writes "concert", onto the series AND every generated occurrence', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeriesTemplate(container);
		await selectValue(container, 'series-create-type', 'concert');
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});
		expect(lastSeriesInput().eventType).toBe('concert');
		for (const call of createEventMock.mock.calls) {
			expect((call[1] as CreateEventInput).eventType).toBe('concert');
		}
	});
});

describe('event form — event-create-type is a localized canonical picker that STARTS EMPTY (#242)', () => {
	it('renders a <select> with the "" placeholder FIRST (labeled by the NEW event_create_type_placeholder message) then the 10 canonical types (#266), localized labels, on the real event-create form — #242 flips the old exactly-8 pin', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		const type = q(container, 'event-create-type');
		expect(type).not.toBeNull();
		expect(type?.tagName).toBe('SELECT');
		expect(optionPairs(type as HTMLSelectElement)).toEqual(eventPickerPairs());
	});

	it('STARTS EMPTY — no preselected type (#242 ruling; the old "defaults to rehearsal / Crede needs no type interaction" pin is retired): the "" placeholder is the initial selection', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		expect((q(container, 'event-create-type') as HTMLSelectElement).value).toBe('');
	});

	it('an untouched picker REFUSES the submit (#242 flips the old "untouched submits rehearsal" pin): createEvent is NEVER called, event_create_type_required RENDERS in event-create-error, and the select is aria-invalid + aria-describedby=event-create-error — #199\'s dead "defensive floor" becomes the reachable path', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fill(container, 'event-create-name', 'Tuesday rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-08', '18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		const error = q(container, 'event-create-error') as HTMLElement;
		expect(error.textContent?.trim()).toBe('event_create_type_required');
		expect(error.getAttribute('role')).toBe('alert');
		const select = q(container, 'event-create-type') as HTMLSelectElement;
		expect(select.getAttribute('aria-invalid')).toBe('true');
		expect(select.getAttribute('aria-describedby')).toBe('event-create-error');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
	});

	it('REOPENING the form after a close starts empty again — the ruling\'s "a reset will quietly reintroduce the default" hazard: all three rehearsal literal sites (initial $state + open-form reset + close reset) are flipped', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await selectValue(container, 'event-create-type', 'concert');
		expect((q(container, 'event-create-type') as HTMLSelectElement).value).toBe('concert');

		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect((q(container, 'event-create-type') as HTMLSelectElement).value).toBe('');
	});

	it('a PICKED type stores the canonical ENGLISH key: choose workshop (shown localized) → createEvent gets eventType "workshop"', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await selectValue(container, 'event-create-type', 'workshop');
		await fill(container, 'event-create-name', 'Score-reading workshop');
		await fillDateTime(container, 'event-create-datetime', '2026-09-10', '18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastEventInput().eventType).toBe('workshop');
	});

	it('choose a type, submit → succeeds with the chosen type on the wire: the FULL createEvent payload, byte-exact (partial assertions hide bugs)', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await selectValue(container, 'event-create-type', 'concert');
		await fill(container, 'event-create-name', 'Autumn concert');
		await fillDateTime(container, 'event-create-datetime', '2026-09-10', '18:30');
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventMock).toHaveBeenCalledWith(
			{ db: 'sampledb', token: 'jwt-abc' },
			{
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'concert',
				startDatetime: '2026-09-10T15:30:00.000Z',
				name: 'Autumn concert'
			}
		);
	});
});

describe('both forms — the type picker carries a VISIBLE label, not an aria-label alone (review F4)', () => {
	it('series-create-type sits inside a <label> whose visible text is the localized field name', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const caption = q(container, 'series-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('series_create_type_label');
		const label = caption.closest('label');
		expect(label).not.toBeNull();
		expect((q(container, 'series-create-type') as HTMLElement).closest('label')).toBe(label);
	});

	it('event-create-type sits inside a <label> whose visible text is the localized field name — and NOW carries the "" placeholder option first (#242 supersedes the old "gains NO empty option" pin)', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		const caption = q(container, 'event-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('event_create_type_label');
		const label = caption.closest('label');
		expect(label).not.toBeNull();
		const select = q(container, 'event-create-type') as HTMLSelectElement;
		expect(select.closest('label')).toBe(label);
		expect(optionPairs(select)).toEqual(eventPickerPairs());
	});
});

// (*MVOX:Tallis*)
