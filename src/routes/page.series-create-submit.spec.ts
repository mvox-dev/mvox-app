// @vitest-environment happy-dom
// Series creation on the agenda page: submit, refusal and the bulk occurrence run.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule(['series', 'event'])
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageModule()
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { fillTime, optionValues } from '$lib/testing/timeControls';
import type { CreateEventInput } from '$lib/entity/entityCreate';
import { loadFullAgendaMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { createEventMock, createEventSeriesMock } from '$lib/testing/mocks/events';
import { listEventSeriesForSeasonMock } from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	NEW_SERIES_ID,
	SEASON_ID,
	enableMondayGeneration,
	fill,
	lastSeriesInput,
	openSeriesForm,
	selectValue
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { flush } from '$lib/testing/pages/seasonEventCreate';
import { timeFormatStore } from '$lib/preferences/timeFormat';
import {
	fillValidTemplate,
	previewDates,
	settleSeriesRun,
	submit,
	toggleDate,
	useSeriesCreatePage
} from '$lib/testing/pages/seriesCreate';

useSeriesCreatePage();

function eventInput(callIndex: number): CreateEventInput {
	expect(createEventMock.mock.calls.length).toBeGreaterThan(callIndex);
	return createEventMock.mock.calls[callIndex][1] as CreateEventInput;
}

describe('season panel — submit ALWAYS generates (#240): the series wire, full shape', () => {
	it('full flow: createEventSeries(cfg, {…}) ONCE, FULL shape — org from resolveDatabaseEntityId, season in extraParentIds, weekly → intervalDays 7, startDate/endDate = FIRST/LAST OCCURRENCE — and the occurrences ALWAYS follow (no series-only outcome exists); form closes, panel stays open, series list re-reads', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await fill(container, 'series-create-location', 'Main hall');
		await fill(container, 'series-create-description', 'Bring the black folder');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventSeriesMock).toHaveBeenCalledWith(CFG, {
			name: 'Monday rehearsals',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			intervalDays: 7,
			startTime: '19:00',
			durationMinutes: 90,
			startDate: '2026-09-07',
			endDate: '2026-09-21',
			defaultLocation: 'Main hall',
			defaultDescription: 'Bring the black folder'
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
	});

	it('untouched optional location/description arrive BLANK/ABSENT — never an invented "" that would shadow inheritance downstream', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		const input = lastSeriesInput();
		expect(input.defaultLocation ?? '').toBe('');
		expect(input.defaultDescription ?? '').toBe('');
		await settleSeriesRun(container);
	});

	it('#207 AM/PM preference (integration): the store flips the surface to 12h selects — and submit STILL sends the 24h HH:MM wire string', async () => {
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openSeriesForm(container);
			await fill(container, 'series-create-name', 'Evening rehearsals');
			await fill(container, 'series-create-duration', '90');

			const ampm = q(container, 'series-create-time-ampm') as HTMLSelectElement;
			expect(ampm, 'AM/PM mode must render the third select').not.toBeNull();
			expect(optionValues(q(container, 'series-create-time-hour')).filter((v) => v !== '')).toEqual(
				Array.from({ length: 12 }, (_, i) => String(i + 1))
			);
			await fireEvent.change(q(container, 'series-create-time-hour') as HTMLElement, {
				target: { value: '7' }
			});
			await fireEvent.change(q(container, 'series-create-time-minute') as HTMLElement, {
				target: { value: '05' }
			});
			await fireEvent.change(ampm, { target: { value: 'PM' } });

			await fill(container, 'series-create-from', '2026-09-01');
			await fill(container, 'series-create-until', '2026-09-21');
			await enableMondayGeneration(container);
			await submit(container);

			await waitFor(() => {
				expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
			});
			const { defaultLocation, defaultDescription, ...rest } = lastSeriesInput();
			expect(rest).toEqual({
				name: 'Evening rehearsals',
				dbEntityId: ORG_EFK,
				extraParentIds: [SEASON_ID],
				eventType: 'rehearsal',
				intervalDays: 7,
				startTime: '19:05',
				durationMinutes: 90,
				startDate: '2026-09-07',
				endDate: '2026-09-21'
			});
			expect(defaultLocation ?? '').toBe('');
			expect(defaultDescription ?? '').toBe('');
			await settleSeriesRun(container);
		} finally {
			timeFormatStore.set('24h');
		}
	});

	it('the repeat select maps to intervalDays: biweekly → 14 — and still generates (two biweekly Mondays: Sep 7 + Sep 21)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await selectValue(container, 'series-create-repeat', 'biweekly');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().intervalDays).toBe(14);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(2);
		});
		await settleSeriesRun(container);
	});

	it('a FAILED series write: series-create-error (role="alert"), the form stays OPEN with the work still in it, nothing generated', async () => {
		createEventSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'series-create-form')).not.toBeNull();
		expect((q(container, 'series-create-name') as HTMLInputElement).value).toBe(
			'Monday rehearsals'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

describe('season panel — submit bulk-creates the occurrences (generation always on, #240)', () => {
	it('creates the series FIRST, then ONE createEvent per generated date, ascending: each occurrence sets ONLY org/series/season parents + eventType + startDatetime (Tallinn wall clock → UTC instant); name/duration/location/description INHERIT — never copied', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-location', 'Main hall');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		expect(createEventSeriesMock.mock.invocationCallOrder[0]).toBeLessThan(
			createEventMock.mock.invocationCallOrder[0]
		);

		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-09-07T16:00:00.000Z', '2026-09-14T16:00:00.000Z', '2026-09-21T16:00:00.000Z']
		);
		for (let i = 0; i < 3; i += 1) {
			expect(createEventMock.mock.calls[i][0]).toEqual(CFG);
			const input = eventInput(i);
			expect(input.dbEntityId).toBe(ORG_EFK);
			expect(input.seriesId).toBe(NEW_SERIES_ID);
			expect(input.extraParentIds).toEqual([SEASON_ID]);
			expect(input.eventType).toBe('rehearsal');
			expect(input.name ?? '').toBe('');
			expect(input.durationMinutes ?? undefined).toBeUndefined();
			expect(input.location ?? '').toBe('');
			expect(input.description ?? '').toBe('');
			expect(input.conductorRefs ?? []).toEqual([]);
			expect(input.capacity ?? undefined).toBeUndefined();
		}
	});

	it('review F1 — the series carries the FIRST and LAST OCCURRENCE as startDate/endDate, not the search range: Mondays over Tue 2026-09-01 → 2026-09-21 persist 2026-09-07 / 2026-09-21', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventSeriesMock).toHaveBeenCalledWith(CFG, {
			name: 'Monday rehearsals',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			intervalDays: 7,
			startTime: '19:00',
			durationMinutes: 90,
			startDate: '2026-09-07',
			endDate: '2026-09-21'
		});
	});

	it('…and a SKIPPED first/last occurrence moves the bounds with it — the stored range is what was actually created (#215: skipped by tapping its chip)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		await toggleDate(container, '2026-09-07');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		expect(lastSeriesInput().startDate).toBe('2026-09-14');
		expect(lastSeriesInput().endDate).toBe('2026-09-21');
	});

	it('the bulk loop is STRICTLY SERIAL — never two createEvent calls in flight (Entu rate/ordering)', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		createEventMock.mockImplementation(async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 0));
			inFlight -= 1;
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(3);
		expect(maxInFlight).toBe(1);
	});

	it('the occurrences honour the SKIP set: toggling 2026-09-14 OFF creates 2 events, not 3 (#215: the chip IS the skip input)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(previewDates(container)).toHaveLength(3);
		});
		await toggleDate(container, '2026-09-14');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(2);
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-09-07T16:00:00.000Z', '2026-09-21T16:00:00.000Z']
		);
	});

	it('the Tallinn wall clock holds ACROSS the DST fall-back (2026-10-25): 19:00 local is 16:00Z before and 17:00Z after — never a fixed UTC offset', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-from', '2026-10-19');
		await fill(container, 'series-create-until', '2026-11-02');
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			['2026-10-19T16:00:00.000Z', '2026-10-26T17:00:00.000Z', '2026-11-02T17:00:00.000Z']
		);
	});

	it('bulk success: form closes, the panel STAYS OPEN, its series list re-reads (the new series + counts must appear) and the agenda refreshes (the occurrences must land on it)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		const seriesReadsBefore = listEventSeriesForSeasonMock.mock.calls.length;
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock.mock.calls.length).toBeGreaterThan(seriesReadsBefore);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});
});

describe('season panel — bulk creation reports progress and survives partial failure', () => {
	it('series-create-progress (role="status") tracks the loop: current 1 of 3 while the first POST is in flight, advancing as each resolves, gone when the run completes', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		const progress = q(container, 'series-create-progress') as HTMLElement;
		expect(progress).not.toBeNull();
		expect(progress.getAttribute('role')).toBe('status');
		expect(progress.textContent).toContain('series_create_progress');
		expect(progress.textContent).toContain('"current":1');
		expect(progress.textContent).toContain('"total":3');

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		expect(q(container, 'series-create-progress')?.textContent).toContain('"current":2');

		resolvers[1]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(3);
		});
		resolvers[2]('ev-new-3');

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'series-create-progress')).toBeNull();
	});

	it('PARTIAL FAILURE: occurrence 2 of 3 fails → the loop STOPS (no 3rd POST), series-create-error (role="alert") reports created=1 / total=3, and the form stays OPEN; nothing is rolled back', async () => {
		createEventMock.mockImplementation(async () => {
			if (createEventMock.mock.calls.length === 2) throw new Error('boom');
			return `ev-new-${createEventMock.mock.calls.length}`;
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		await flush();
		expect(createEventMock).toHaveBeenCalledTimes(2);
		const error = q(container, 'series-create-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('series_create_bulk_failed');
		expect(error.textContent).toContain('"created":1');
		expect(error.textContent).toContain('"total":3');
		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
	});
});

describe('season panel — series create REFUSES an incomplete form before it writes', () => {
	it('blank NAME: series-create-error names it, createEventSeries never runs, the form stays open', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		const error = q(container, 'series-create-error') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent?.trim()).toBe('series_create_name_required');
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'series-create-form')).not.toBeNull();
	});

	it('review F4 — a refusal is wired to ITS OWN box: aria-invalid + aria-describedby point at the error, and only that field carries them', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.getAttribute('id')).toBe('series-create-error');
		const name = q(container, 'series-create-name') as HTMLInputElement;
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(name.getAttribute('aria-describedby')).toBe('series-create-error');
		for (const testid of [
			'series-create-type',
			'series-create-duration',
			'series-create-time-hour',
			'series-create-time-minute'
		]) {
			const el = q(container, testid) as HTMLElement;
			expect(el.getAttribute('aria-invalid')).toBeNull();
			expect(el.getAttribute('aria-describedby')).toBeNull();
		}

		await fill(container, 'series-create-name', 'Monday rehearsals');
		await waitFor(() => {
			expect(q(container, 'series-create-error')).toBeNull();
		});
		expect(
			(q(container, 'series-create-name') as HTMLInputElement).getAttribute('aria-invalid')
		).toBeNull();
	});

	it('…and a range refusal hands the wiring to the UNTIL box instead', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await fill(container, 'series-create-until', '2026-08-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		const until = q(container, 'series-create-until') as HTMLInputElement;
		expect(until.getAttribute('aria-invalid')).toBe('true');
		expect(until.getAttribute('aria-describedby')).toBe('series-create-error');
		expect(
			(q(container, 'series-create-name') as HTMLInputElement).getAttribute('aria-invalid')
		).toBeNull();
	});

	it('blank TIME: refused with the TIME message — v4E start_time is required and T1 would throw anyway; the page says WHICH field first', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await fill(container, 'series-create-duration', '90');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_time_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('blank DURATION: refused with the DURATION message', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');
		await fillTime(container, 'series-create-time', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_duration_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});

	it('NO day picked on a day-using pattern: refused with the DAY message and NO write at all — the check is unconditional now that generation is (#240) — otherwise a refused form leaves a half-made series behind', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_day_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the refusal is not sticky: filling the named field and re-submitting writes', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await selectValue(container, 'series-create-day', '1');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});

		await fill(container, 'series-create-name', 'Monday rehearsals');
		await submit(container);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		await settleSeriesRun(container);
	});
});

describe('season panel — DAILY generation needs no day of week', () => {
	it('daily HIDES the inert day select and previews immediately: generateEventDates ignores dayOfWeek for daily, so demanding one would gate generation behind a field with no effect', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-04');
		await selectValue(container, 'series-create-repeat', 'daily');

		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});
		expect(q(container, 'series-create-day')).toBeNull();
		expect(previewDates(container)).toEqual([
			'2026-09-01',
			'2026-09-02',
			'2026-09-03',
			'2026-09-04'
		]);
	});

	it('…and submits without a day: one occurrence per calendar day, no day_required refusal', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Festival week');
		await fill(container, 'series-create-duration', '90');
		await fillTime(container, 'series-create-time', '19:00');
		await fill(container, 'series-create-from', '2026-09-01');
		await fill(container, 'series-create-until', '2026-09-04');
		await selectValue(container, 'series-create-repeat', 'daily');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(q(container, 'series-create-error')).toBeNull();
		expect(lastSeriesInput().intervalDays).toBe(1);
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(createEventMock.mock.calls.map((c) => (c[1] as CreateEventInput).startDatetime)).toEqual(
			[
				'2026-09-01T16:00:00.000Z',
				'2026-09-02T16:00:00.000Z',
				'2026-09-03T16:00:00.000Z',
				'2026-09-04T16:00:00.000Z'
			]
		);
	});

	it('a day-using pattern still demands one — switching back to weekly restores the select and the refusal', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await selectValue(container, 'series-create-repeat', 'daily');
		await selectValue(container, 'series-create-repeat', 'weekly');

		await waitFor(() => {
			expect(q(container, 'series-create-day')).not.toBeNull();
		});
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'series-create-error')).not.toBeNull();
		});
		expect(q(container, 'series-create-error')?.textContent?.trim()).toBe(
			'series_create_day_required'
		);
		expect(createEventSeriesMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
