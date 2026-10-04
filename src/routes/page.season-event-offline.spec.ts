// @vitest-environment happy-dom
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
} = vi.hoisted(() => ({
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn(),
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock,
	countSeasonScope: countSeasonScopeMock,
	deleteSeason: deleteSeasonMock
}));
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule()
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
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));

import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	isWriteDisabled
} from '$lib/testing/networkSignal';
import type { Season } from '$lib/seasons/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
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
import { createEventMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { listRepertoireItemsMock } from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	SEASON_ID,
	conductorSelect,
	fixtureRows,
	standaloneFixture
} from '$lib/testing/pages/seasonPanel';
import { agendaResult, openPanel, seriesFixture } from '$lib/testing/pages/seasonManage';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { REASON } from '$lib/testing/pages/event';

let fakeByteStore: FakeByteStore;

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
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
	listRepertoireItemsMock.mockResolvedValue([]);
	deleteRepertoireItemMock.mockResolvedValue(undefined);
	updateRepertoireStatusMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({});
	deleteEventSeriesMock.mockResolvedValue(undefined);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 0, events: 0, repertoireItems: 0 });
	deleteSeasonMock.mockResolvedValue(undefined);
	createEventMock.mockResolvedValue('ev-new-1');
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
	listSeriesOptionsForSeasonMock.mockReset();
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
	createEventMock.mockReset();
	resetOnLine();
	resetAppState();
});

async function renderPanelOnline(): Promise<{ container: HTMLElement; panel: HTMLElement }> {
	await goOnline();
	const container = await renderReady();
	const panel = await openPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-edit-btn-name')).not.toBeNull();
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		expect(conductorSelect(panel)).not.toBeNull();
		expect(q(container, 'season-manage-conductor-remove-p-grace')).not.toBeNull();
	});
	return { container, panel };
}

function seasonWriteControls(container: HTMLElement): HTMLElement[] {
	return [
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="season-edit-btn-"]')),
		...Array.from(
			container.querySelectorAll<HTMLElement>('[data-testid^="season-manage-conductor-remove-"]')
		),
		q(container, 'season-manage-conductor-select') as HTMLElement,
		q(container, 'season-manage-delete-season') as HTMLElement
	];
}

describe('agenda — season management while offline (#434 slice 6)', () => {
	it('offline: every season write control is disabled and the reason is visible in the panel', async () => {
		const { container, panel } = await renderPanelOnline();
		expect(seasonWriteControls(container).length).toBeGreaterThanOrEqual(6);
		await goOffline();

		await waitFor(() => {
			for (const c of seasonWriteControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(true);
			}
		});
		expectVisibleReason(panel, 'season-manage-write-unavailable', REASON);
		expect(panel.querySelectorAll('[data-testid="season-manage-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: edit, conductor add/remove and delete write nothing', async () => {
		const { container, panel } = await renderPanelOnline();
		await goOffline();

		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await settle();
		expect(q(container, 'season-edit-input-name'), 'no edit input opens').toBeNull();

		await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
		await settle();
		expect(q(container, 'season-manage-delete-season-confirm'), 'no delete arms').toBeNull();

		await fireEvent.change(conductorSelect(panel), { target: { value: 'p-ada' } });
		await fireEvent.click(q(container, 'season-manage-conductor-remove-p-grace') as HTMLElement);
		await settle();

		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(addSeasonConductorMock).not.toHaveBeenCalled();
		expect(removeSeasonConductorMock).not.toHaveBeenCalled();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('a signal drop mid-edit KEEPS the typed season name — the draft is not discarded', async () => {
		const { container, panel } = await renderPanelOnline();
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		const input = await waitFor(() => {
			const el = q(container, 'season-edit-input-name') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Season of Rain' } });
		await goOffline();

		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();

		const still = q(container, 'season-edit-input-name') as HTMLInputElement | null;
		expect(still, 'the editor stays open on her text').not.toBeNull();
		expect(still!.value).toBe('Season of Rain');
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expectVisibleReason(panel, 'season-edit-held-offline', '[write_held_no_signal]');
	});

	it('the held season draft commits on one more Enter once the signal is back', async () => {
		const { container } = await renderPanelOnline();
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		const input = await waitFor(() => {
			const el = q(container, 'season-edit-input-name') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el as HTMLInputElement;
		});
		await fireEvent.input(input, { target: { value: 'Season of Rain' } });
		await goOffline();
		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();

		await goOnline();
		await settle();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(q(container, 'season-edit-held-offline')).toBeNull();

		const held = q(container, 'season-edit-input-name') as HTMLInputElement;
		expect(held.value).toBe('Season of Rain');
		await fireEvent.keyDown(held, { key: 'Enter' });

		await waitFor(() => expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1));
		expect(JSON.stringify(updateSeasonFieldMock.mock.calls[0])).toContain('Season of Rain');
	});

	it('back online: the controls enable again and the reason is gone', async () => {
		const { container } = await renderPanelOnline();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			for (const c of seasonWriteControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(false);
			}
		});
		expect(q(container, 'season-manage-write-unavailable')).toBeNull();
		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => expect(q(container, 'season-edit-input-name')).not.toBeNull());
	});
});

async function openFilledEventForm(container: HTMLElement): Promise<void> {
	await waitFor(() => expect(q(container, 'season-manage-add-event')).not.toBeNull());
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => expect(q(container, 'event-create-form')).not.toBeNull());
	await fireEvent.change(q(container, 'event-create-season') as HTMLElement, {
		target: { value: SEASON_ID }
	});
	await fireEvent.change(q(container, 'event-create-type') as HTMLElement, {
		target: { value: 'concert' }
	});
	await fireEvent.input(q(container, 'event-create-name') as HTMLElement, {
		target: { value: 'Spring concert' }
	});
	await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
	await fillTime(container, 'event-create-end', '21:00');
}

describe('agenda — event creation while offline (#434 slice 6)', () => {
	it('offline: submit is disabled and the reason is visible inside the form', async () => {
		const { container } = await renderPanelOnline();
		await openFilledEventForm(container);
		await goOffline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'event-create-submit') as HTMLElement)).toBe(true);
		});
		expectVisibleReason(
			q(container, 'event-create-form') as HTMLElement,
			'event-create-write-unavailable',
			REASON
		);
	});

	it('offline: a submit click never calls createEvent and the typed work stays in the form', async () => {
		const { container } = await renderPanelOnline();
		await openFilledEventForm(container);
		await goOffline();

		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
		await settle();

		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).value).toBe('Spring concert');
	});

	it('back online: submit enabled, reason gone, and the same form submits', async () => {
		const { container } = await renderPanelOnline();
		await openFilledEventForm(container);
		await goOffline();
		await goOnline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'event-create-submit') as HTMLElement)).toBe(false);
		});
		expect(q(container, 'event-create-write-unavailable')).toBeNull();
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
		await waitFor(() => expect(createEventMock).toHaveBeenCalledTimes(1));
	});
});

// (*MVOX:Tallis*)
