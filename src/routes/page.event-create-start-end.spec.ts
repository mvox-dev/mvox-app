// @vitest-environment happy-dom
// Event creation on the agenda page: the start/end pair and the derived duration.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import { createEventMock } from '$lib/testing/mocks/events';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	SEASON_ID,
	fill,
	openFormFromPanel,
	selectValue,
	submit
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import {
	chooseType,
	fillDateTimeAmpm,
	lastCreateInput,
	useEventCreatePage
} from '$lib/testing/pages/eventCreate';

useEventCreatePage();

describe('#243 — visible labels on the start/end pair (Gama on-issue addition, #239 idiom)', () => {
	it('the END group: role="group", named by a VISIBLE label via aria-labelledby, NO aria-label on the wrapper; inner per-control labels name the parts', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const end = q(container, 'event-create-end') as HTMLElement;
		expect(end.getAttribute('role')).toBe('group');
		expect(end.getAttribute('aria-label'), 'no aria-label on the group — #205 F1 trap').toBeNull();
		const labelledby = end.getAttribute('aria-labelledby');
		expect(labelledby, 'named by a visible label').toBeTruthy();
		const label = container.querySelector(`#${labelledby}`) as HTMLElement;
		expect(label, 'the aria-labelledby target exists').not.toBeNull();
		expect(label.textContent?.trim()).toBe('event_create_end_label');
		expect(label.classList.contains('sr-only')).toBe(false);
		expect(
			(q(container, 'event-create-end-date') as HTMLElement).getAttribute('aria-label')
		).toBe('time_select_date_label');
	});

	it('the START group flips to the same idiom: visible label, no aria-label', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const start = q(container, 'event-create-datetime') as HTMLElement;
		expect(start.getAttribute('role')).toBe('group');
		expect(start.getAttribute('aria-label')).toBeNull();
		const labelledby = start.getAttribute('aria-labelledby');
		expect(labelledby).toBeTruthy();
		const label = container.querySelector(`#${labelledby}`) as HTMLElement;
		expect(label).not.toBeNull();
		expect(label.textContent?.trim()).toBe('event_create_start_label');
		expect(label.classList.contains('sr-only')).toBe(false);
	});
});

describe('#243 — the end date MIRRORS the start date until touched (Done-when 4)', () => {
	it('filling/changing the start date writes the end date too — until the viewer touches the end date, after which it stays put', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const endDate = q(container, 'event-create-end-date') as HTMLInputElement;
		await fill(container, 'event-create-datetime-date', '2027-04-18');
		expect(endDate.value, 'end date mirrors the start date').toBe('2027-04-18');

		await fill(container, 'event-create-datetime-date', '2027-04-19');
		expect(endDate.value, 'the mirror keeps following').toBe('2027-04-19');

		await fill(container, 'event-create-end-date', '2027-04-20');
		await fill(container, 'event-create-datetime-date', '2027-04-21');
		expect(endDate.value, 'a touched end date is never silently overwritten').toBe('2027-04-20');
	});

	it('cancel + reopen re-arms the mirror (the latch resets with the rest of the form)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await fill(container, 'event-create-end-date', '2027-04-20');
		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect((q(container, 'event-create-end-date') as HTMLInputElement).value).toBe('');
		await fill(container, 'event-create-datetime-date', '2027-05-01');
		expect((q(container, 'event-create-end-date') as HTMLInputElement).value).toBe('2027-05-01');
	});
});

describe('#243 — duration_minutes is DERIVED, DST-safe (two independent UTC conversions)', () => {
	async function standaloneReady(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Autumn camp');
	}

	it('October FALL-BACK camp: 2026-10-24 10:00 → 2026-10-25 15:00 = 1800 real minutes (naive wall-clock says 1740) — FULL wire shape, and NO end prop of any spelling', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-10-24', '10:00');
		await fill(container, 'event-create-end-date', '2026-10-25');
		await fillTime(container, 'event-create-end', '15:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-10-24T07:00:00.000Z',
			durationMinutes: 1800
		});
		expect(Object.keys(lastCreateInput()).filter((k) => /end/i.test(k))).toEqual([]);
	});

	it('March SPRING-FORWARD camp: 2026-03-28 10:00 → 2026-03-29 15:00 = 1680 real minutes (naive says 1740)', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-03-28', '10:00');
		await fill(container, 'event-create-end-date', '2026-03-29');
		await fillTime(container, 'event-create-end', '15:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-03-28T08:00:00.000Z',
			durationMinutes: 1680
		});
	});

	it('the 25-HOUR DAY itself: 2026-10-25 00:00 → 2026-10-26 00:00 = 1500 min, exactly', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2026-10-25', '00:00');
		await fill(container, 'event-create-end-date', '2026-10-26');
		await fillTime(container, 'event-create-end', '00:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2026-10-24T21:00:00.000Z',
			durationMinutes: 1500
		});
	});

	it('a BLANK end time sends NO durationMinutes key at all — the optionality that carries series inheritance survives (full shape, phantom-key scan)', async () => {
		const container = await renderReady();
		await standaloneReady(container);
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput()).toEqual({
			name: 'Autumn camp',
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'concert',
			startDatetime: '2027-04-18T16:00:00.000Z'
		});
		expect(Object.keys(lastCreateInput()).filter((k) => /end|duration/i.test(k))).toEqual([]);
	});
});

describe('#243 — an end at or before the start is refused BEFORE any write (Done-when 5)', () => {
	async function readySameDay(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-season', SEASON_ID);
		await chooseType(container, 'concert');
		await fill(container, 'event-create-name', 'Inverted event');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
	}

	it('end time EARLIER the same day: refused with event_end_before_start, createEvent never called, the end controls carry aria-invalid + aria-describedby', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '18:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(q(container, 'event-create-error')?.getAttribute('role')).toBe('alert');
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'event-create-form')).not.toBeNull();
		for (const testid of [
			'event-create-end-date',
			'event-create-end-hour',
			'event-create-end-minute'
		]) {
			const control = q(container, testid) as HTMLElement;
			expect(control.getAttribute('aria-invalid'), testid).toBe('true');
			expect(control.getAttribute('aria-describedby'), testid).toBe('event-create-error');
		}
	});

	it('end EQUAL to start: refused too — the rule is end <= start on DATETIMES, which is why the date-flavoured copy could not be reused', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('end DATE before the start date (a touched mirror the viewer then out-ran): refused, loud — never a silent fix-up of the end date', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fill(container, 'event-create-end-date', '2027-04-17');
		await fillTime(container, 'event-create-end', '20:00');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
		expect(q(container, 'event-create-error')?.textContent?.trim()).toBe(
			'event_end_before_start'
		);
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('the refusal is not sticky: editing the end time clears it, and the corrected submit writes', async () => {
		const container = await renderReady();
		await readySameDay(container);
		await fillTime(container, 'event-create-end', '18:00');
		await submit(container);
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});

		await fillTime(container, 'event-create-end', '21:00');
		expect(q(container, 'event-create-error')).toBeNull();
		await submit(container);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().durationMinutes).toBe(120);
	});
});

describe('#243 — the end time honours the AM/PM preference (rule 5, shipped TimeSelect)', () => {
	it("'ampm': the end composite grows its -ampm select; 7:00 PM → 9:00 PM writes durationMinutes 120 on an unchanged wire", async () => {
		const { timeFormatStore } = await import('$lib/preferences/timeFormat');
		timeFormatStore.set('ampm');
		try {
			const container = await renderReady();
			await openFormFromPanel(container);
			await selectValue(container, 'event-create-season', SEASON_ID);
			await chooseType(container, 'concert');
			await fill(container, 'event-create-name', 'Spring concert');
			await fillDateTimeAmpm(container, 'event-create-datetime', '2027-04-18', '7', '00', 'PM');
			expect(q(container, 'event-create-end-ampm'), 'end TimeSelect in ampm mode').not.toBeNull();
			await fireEvent.change(q(container, 'event-create-end-hour') as HTMLElement, {
				target: { value: '9' }
			});
			await fireEvent.change(q(container, 'event-create-end-minute') as HTMLElement, {
				target: { value: '00' }
			});
			await fireEvent.change(q(container, 'event-create-end-ampm') as HTMLElement, {
				target: { value: 'PM' }
			});
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
				durationMinutes: 120
			});
		} finally {
			timeFormatStore.set('24h');
		}
	});
});

describe('#243 — the start/end labels and the range error copy', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('the detail editor’s field name follows the field: event_edit_duration_minutes_aria_label no longer says "Edit duration" (the KEY stays — a rename would break the derived-key a11y suite)', () => {
		expect(messages('en')['event_edit_duration_minutes_aria_label']).not.toBe('Edit duration');
		expect(messages('et')['event_edit_duration_minutes_aria_label']).not.toBe('Muuda kestust');
	});

	it('event_end_before_start is its OWN copy, not a byte-copy of the date-flavoured keys it deliberately does not reuse', () => {
		for (const locale of ['en', 'et']) {
			const msgs = messages(locale);
			expect(msgs['event_end_before_start']).not.toBe(msgs['season_date_range_invalid']);
			expect(msgs['event_end_before_start']).not.toBe(msgs['series_create_until_before_from']);
			expect(msgs['event_end_before_start']).not.toBe(msgs['event_convert_end_before_start']);
		}
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
