// @vitest-environment happy-dom
// Event creation on the agenda page: submit, refusal, success and late replies.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare', {
		event_created: (p: { name: string; when: string }) => `event_created ${p.name} @ ${p.when}`,
		event_create_inherited_from_series: (p: { value: string }) =>
			`event_create_inherited_from_series ${p.value}`,
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
	})
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule()
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

import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import { loadFullAgendaMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { createEventMock } from '$lib/testing/mocks/events';
import {
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	listSeriesOptionsForSeasonMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	SEASON_ID,
	fill,
	openFormFromPanel,
	selectValue,
	standaloneFixture,
	submit
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { flush } from '$lib/testing/pages/seasonEventCreate';
import {
	UPCOMING_SEASON_ID,
	agendaResult,
	chooseType,
	fillDateTimeAmpm,
	lastCreateInput,
	pickConductor,
	series1Defaults,
	seriesFixture,
	toSeriesOptions,
	useEventCreatePage
} from '$lib/testing/pages/eventCreate';

useEventCreatePage();

function upcomingSeriesFixture() {
	return [{ id: 'series-9', name: 'Autumn sectionals', eventCount: 3 }];
}

function upcomingStandaloneFixture() {
	return [{ id: 'ev-77', name: 'Autumn concert', startDatetime: '2027-11-01T18:00:00.000Z' }];
}

function routeSeasonListsBySeason(): void {
	listEventSeriesForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) => ({
		items: seasonId === SEASON_ID ? seriesFixture() : upcomingSeriesFixture(),
		truncated: false
	}));
	listSeriesOptionsForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) =>
		toSeriesOptions(seasonId === SEASON_ID ? seriesFixture() : upcomingSeriesFixture())
	);
	listEventsForSeasonMock.mockImplementation(async (_cfg: unknown, seasonId: string) => {
		const items = seasonId === SEASON_ID ? standaloneFixture() : upcomingStandaloneFixture();
		return { items, total: items.length, truncated: false };
	});
}

describe('agenda — submit calls createEvent with exactly what the viewer set', () => {
	it('STANDALONE full flow (agenda-opened): every field set → createEvent(cfg, {…}) ONCE, full shape — org from resolveDatabaseEntityId, season in extraParentIds, NO seriesId, Tallinn wall clock converted to the UTC instant', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await fillTime(container, 'event-create-end', '21:00');
		await fill(container, 'event-create-location', 'Estonia Hall');
		await fill(container, 'event-create-description', 'Doors at 18:30');
		await pickConductor(container, 'p-ada');
		await fill(container, 'event-create-capacity', '300');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventMock).toHaveBeenCalledWith(CFG, {
			name: 'Spring concert',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z',
			durationMinutes: 120,
			location: 'Estonia Hall',
			description: 'Doors at 18:30',
			conductorRefs: ['p-ada'],
			capacity: 300
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);

		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('SERIES occurrence, untouched inherited fields (panel-opened): seriesId is the picked series, the season still rides in extraParentIds, and the inherited defaults are NOT copied into the call', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1'
		});
	});

	it('SERIES occurrence with OVERRIDES: the typed name + duration are sent, the untouched location/description still are not (full shape)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await fillTime(container, 'event-create-end', '19:15');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1',
			name: 'Extra rehearsal',
			durationMinutes: 45
		});
	});

	it('SERIES occurrence, ONLY the name overridden: exactly that one extra key rides along', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-07T15:30:00.000Z',
			seriesId: 'series-1',
			name: 'Extra rehearsal'
		});
	});

	it('a PANEL-born create refreshes the panel lists too: after success the season’s series list re-reads (the new occurrence must land in the counts; #313 — there is no standalone list any more), the panel is STILL OPEN to receive them, and the agenda refreshes', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;

		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(
			(q(container, 'season-manage-name') as HTMLElement | null)?.textContent ?? ''
		).not.toBe('');
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
	});

	it('no SEASON chosen (the viewer re-picks the "" placeholder): submit refuses with event-create-error (role="alert"), createEvent is NEVER called, the form stays open — a season-less event is invisible to every agenda read', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', '');
		expect((q(container, 'event-create-series') as HTMLSelectElement).disabled).toBe(true);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Orphan event');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
	});

	it('a FAILED write: event-create-error shows (role="alert"), the form stays OPEN with the work still in it, and nothing refreshes', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'event-create-form')).not.toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).value).toBe('Spring concert');
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		createEventMock.mockResolvedValue('ev-new-1');
		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(2);
		});
	});
});

describe('agenda — event create REFUSES an incomplete form before it writes (review F1)', () => {
	it('NO datetime: refused with the DATETIME message; the input carries aria-invalid + aria-describedby', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_create_datetime_required'
		);
		expect(createEventMock).not.toHaveBeenCalled();
		const wrapper = q(container, 'event-create-datetime') as HTMLElement;
		expect(wrapper.getAttribute('role')).toBe('group');
		expect(wrapper.getAttribute('aria-label')).toBeNull();
		const startLabelledby = wrapper.getAttribute('aria-labelledby');
		expect(startLabelledby, 'the start group is named by a visible label').toBeTruthy();
		const startLabel = container.querySelector(`#${startLabelledby}`) as HTMLElement;
		expect(startLabel).not.toBeNull();
		expect(startLabel.textContent?.trim()).toBe('event_create_start_label');
		for (const testid of [
			'event-create-datetime-date',
			'event-create-datetime-hour',
			'event-create-datetime-minute'
		]) {
			const control = q(container, testid) as HTMLElement;
			expect(['INPUT', 'SELECT'], `${testid} is a real form control`).toContain(control.tagName);
			expect(control.getAttribute('aria-invalid'), testid).toBe('true');
			expect(control.getAttribute('aria-describedby'), testid).toBe('event-create-error');
		}
	});

	it('STANDALONE with no name: refused (a standalone event has no series to inherit a name from)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_create_name_required'
		);
		expect(createEventMock).not.toHaveBeenCalled();
		expect((q(container, 'event-create-name') as HTMLInputElement).getAttribute('aria-invalid')).toBe(
			'true'
		);
	});

	it('a SERIES occurrence with no name is NOT refused — the name is inherited (already pinned above, held here against the new name guard)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(q(container, 'event-create-error')).toBeNull();
	});

	it('the refusal is not sticky: editing the named field clears it, and the next submit re-decides', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});

		await fill(container, 'event-create-name', 'Spring concert');
		expect(q(container, 'event-create-error')).toBeNull();
		expect((q(container, 'event-create-name') as HTMLInputElement).getAttribute('aria-invalid')).toBeNull();

		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
	});
});

describe('agenda — a successful event create SAYS SO (review F3)', () => {
	it('event-create-status is mounted (empty) from first render and carries the result after the write — the form vanishing is otherwise the same signal Cancel gives', async () => {
		const container = await renderReady();
		const status = q(container, 'event-create-status') as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent?.trim()).toBe('');

		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toContain('event_created');
		});
	});

	it('#207 rule 7: the success toast renders the event start as "YYYY-MM-DD HH:MM" (ISO date + 24h time, Tallinn wall clock)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Spring concert @ 2027-04-18 19:00'
			);
		});
	});

	it('#208 guard: an untouched SERIES occurrence is announced under the SERIES name (no own name typed)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Monday rehearsals @ 2026-09-07 18:30'
			);
		});
	});

	it('#208 guard: an OWN typed name beats the series name in the announcement', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await fill(container, 'event-create-name', 'Extra rehearsal');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created Extra rehearsal @ 2026-09-07 18:30'
			);
		});
	});

	it('#208 guard: a series with NO name of its own falls back to the TYPE value in the announcement', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: '',
			durationMinutes: 45,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');
		await chooseType(container, 'rehearsal');
		await fillDateTime(container, 'event-create-datetime', '2026-09-07', '18:30');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
				'event_created rehearsal @ 2026-09-07 18:30'
			);
		});
	});

	it('a FAILED write announces nothing — the status slot stays empty', async () => {
		createEventMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Spring concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-status')?.textContent?.trim()).toBe('');
	});
});

describe("agenda — a panel-born create refreshes the PANEL's season, not the form's (2nd-pass F2)", () => {
	it('the form’s season switched away: the panel keeps showing ITS OWN season’s series and events', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ withUpcomingSeason: true }));
		routeSeasonListsBySeason();
		const container = await renderReady();
		await openFormFromPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});

		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Autumn opener');
		await fillDateTime(container, 'event-create-datetime', '2027-10-04', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().extraParentIds).toEqual([UPCOMING_SEASON_ID]);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await flush();

		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-9')).toBeNull();
	});
});

describe('agenda — the event-create form drops async replies that no longer belong to it (2nd-pass F3)', () => {
	it('the season switched while its series read is in flight: the select never offers the PREVIOUS season’s series', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ withUpcomingSeason: true }));
		let releaseSlow: (list: unknown) => void = () => {};
		listSeriesOptionsForSeasonMock.mockImplementation((_cfg: unknown, seasonId: string) => {
			if (seasonId === SEASON_ID) {
				return new Promise((resolve) => {
					releaseSlow = resolve;
				});
			}
			return Promise.resolve(toSeriesOptions(upcomingSeriesFixture()));
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID); // …hangs
		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID); // …answers

		const select = () => q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(select().querySelector('option[value="series-9"]')).not.toBeNull();
		});

		releaseSlow(toSeriesOptions(seriesFixture()));
		await flush();
		expect(select().querySelector('option[value="series-1"]')).toBeNull();
		expect(select().querySelector('option[value="series-9"]')).not.toBeNull();
	});

	it('the form dismissed and REOPENED while a series-defaults read is in flight: the fresh form shows the static hints, not the dead form’s inherited ones', async () => {
		let releaseDefaults: (defaults: unknown) => void = () => {};
		getSeriesDefaultsMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseDefaults = resolve;
				})
		);
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');

		await fireEvent.keyDown(q(container, 'event-create-form') as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});

		releaseDefaults(series1Defaults());
		await flush();
		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect(q(container, 'event-create-name-inherited')).toBeNull();
		expect(q(container, 'event-create-duration-inherited')).toBeNull();
		expect(q(container, 'event-create-location-inherited')).toBeNull();
		expect(q(container, 'event-create-description-inherited')).toBeNull();
	});
});

describe('#220 — AM/PM preference on the event-created toast (and NOT on the wire)', () => {
	it("'ampm': the toast renders 'event_created Spring concert @ 2027-04-18 7:00 PM' — ISO date half untouched (rule 7), time half through the shared formatter", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			await submit(container);

			await waitFor(() => {
				expect(q(container, 'event-create-status')?.textContent?.trim()).toBe(
					'event_created Spring concert @ 2027-04-18 7:00 PM'
				);
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it("'ampm' wire guard: createEvent STILL receives the untouched UTC instant — the preference is display-only, stored/submitted values never change", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			await submit(container);

			await waitFor(() => {
				expect(createEventMock).toHaveBeenCalledTimes(1);
			});
			expect(createEventMock).toHaveBeenCalledWith(CFG, {
				name: 'Spring concert',
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'concert',
				startDatetime: '2027-04-18T16:00:00.000Z'
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
