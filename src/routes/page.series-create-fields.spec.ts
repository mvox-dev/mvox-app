// @vitest-environment happy-dom
// Series creation on the agenda page: the form's fields, labels and fieldsets.
import { waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { type MessageFile } from '$lib/testing/messageFile.js';

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
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).rightsModule(await importOriginal())
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
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

import { HOURS_24, MINUTES_5, optionValues } from '$lib/testing/timeControls';
import { q } from '$lib/testing/pages/dom';
import {
	SEASON_END,
	SEASON_START,
	enableMondayGeneration,
	openSeriesForm
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { fillValidTemplate, useSeriesCreatePage } from '$lib/testing/pages/seriesCreate';

useSeriesCreatePage();

describe('season panel — the series form carries every sketch-D field', () => {
	it('name (text), type (#199: canonical select, PRE-SELECTED rehearsal — see page.event-type-picker.spec.ts for the full picker contract), duration (number), location (text), description (TEXTAREA), repeat/day (selects), time, from/until (dates) — NO generate checkbox (#240: generation is always on) and NO skip picker (#215: the chips are the skip mechanism)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const name = q(container, 'series-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.tagName).toBe('INPUT');

		const type = q(container, 'series-create-type') as HTMLSelectElement;
		expect(type).not.toBeNull();
		expect(type.tagName).toBe('SELECT');
		expect(type.value).toBe('rehearsal');

		const duration = q(container, 'series-create-duration') as HTMLInputElement;
		expect(duration.type).toBe('number');

		const location = q(container, 'series-create-location') as HTMLInputElement;
		expect(location.tagName).toBe('INPUT');

		const description = q(container, 'series-create-description') as HTMLElement;
		expect(description.tagName).toBe('TEXTAREA');

		const repeat = q(container, 'series-create-repeat') as HTMLSelectElement;
		expect(repeat.tagName).toBe('SELECT');
		expect([...repeat.querySelectorAll('option')].map((o) => o.value)).toEqual([
			'weekly',
			'biweekly',
			'daily'
		]);
		expect(repeat.value).toBe('weekly');

		const day = q(container, 'series-create-day') as HTMLSelectElement;
		expect(day.tagName).toBe('SELECT');
		expect([...day.querySelectorAll('option')].map((o) => o.value)).toEqual([
			'',
			'1',
			'2',
			'3',
			'4',
			'5',
			'6',
			'0'
		]);
		expect(day.value).toBe('');

		const timeWrapper = q(container, 'series-create-time') as HTMLElement;
		expect(timeWrapper).not.toBeNull();
		expect(timeWrapper.tagName).not.toBe('INPUT');
		const timeHour = q(container, 'series-create-time-hour') as HTMLSelectElement;
		const timeMinute = q(container, 'series-create-time-minute') as HTMLSelectElement;
		expect(timeHour.tagName).toBe('SELECT');
		expect(timeMinute.tagName).toBe('SELECT');
		expect(timeHour.value).toBe('');
		expect(timeMinute.value).toBe('');
		expect(optionValues(timeHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(timeMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'series-create-time-ampm')).toBeNull();
		expect((q(container, 'series-create-from') as HTMLInputElement).type).toBe('date');
		expect((q(container, 'series-create-until') as HTMLInputElement).type).toBe('date');
		expect(q(container, 'series-create-generate')).toBeNull();
		expect(q(container, 'series-create-skip-date')).toBeNull();
		expect(q(container, 'series-create-skip-add')).toBeNull();
		expect(q(container, 'series-create-skip-list')).toBeNull();
		expect(q(container, 'series-create-skip-heading')).toBeNull();
		expect(container.querySelector('[data-testid^="series-create-skip-remove-"]')).toBeNull();
	});

	it('from/until default to the SEASON dates — the sketch-D pin — so a fresh form already spans the season', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expect((q(container, 'series-create-from') as HTMLInputElement).value).toBe(SEASON_START);
		expect((q(container, 'series-create-until') as HTMLInputElement).value).toBe(SEASON_END);
	});
});

describe('#239 — every control carries a visible label that IS its accessible name', () => {
	function labelElementOf(container: HTMLElement, el: HTMLElement): HTMLLabelElement | null {
		const id = el.getAttribute('id');
		if (id) {
			const forLabel = container.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
			if (forLabel) return forLabel;
		}
		return el.closest('label');
	}

	function labelText(label: HTMLElement): string {
		const clone = label.cloneNode(true) as HTMLElement;
		for (const embedded of clone.querySelectorAll('input, select, textarea')) embedded.remove();
		return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	}

	function computedName(container: HTMLElement, el: HTMLElement): string {
		const labelledby = el.getAttribute('aria-labelledby');
		if (labelledby) {
			return labelledby
				.split(/\s+/)
				.map((id) => container.querySelector(`[id="${id}"]`)?.textContent?.trim() ?? '')
				.join(' ')
				.trim();
		}
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel !== null) return ariaLabel.trim();
		const label = labelElementOf(container, el);
		return label ? labelText(label) : '';
	}

	function expectVisibleText(el: HTMLElement, what: string): void {
		expect(el.hasAttribute('hidden'), `${what} must not be [hidden]`).toBe(false);
		expect(el.getAttribute('aria-hidden'), `${what} must not be aria-hidden`).not.toBe('true');
		expect(
			Array.from(el.classList),
			`${what} must be visibly rendered, not screen-reader-only`
		).not.toContain('sr-only');
	}

	const FIELD_LABEL_KEYS: ReadonlyArray<readonly [testid: string, key: string]> = [
		['series-create-name', 'series_create_name_label'],
		['series-create-type', 'series_create_type_label'],
		['series-create-duration', 'series_create_duration_label'],
		['series-create-location', 'series_create_location_label'],
		['series-create-description', 'series_create_description_label'],
		['series-create-repeat', 'series_create_repeat_label'],
		['series-create-day', 'series_create_day_label'],
		['series-create-from', 'series_create_from_label'],
		['series-create-until', 'series_create_until_label']
	];

	it('all nine labelable controls: a visible <label> (for= or wrapping) computes as the accessible name, and the old aria-label is GONE — never a placeholder as the only name', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		for (const [testid, key] of FIELD_LABEL_KEYS) {
			const control = q(container, testid) as HTMLElement;
			expect(control, testid).not.toBeNull();

			expect(
				control.getAttribute('aria-label'),
				`${testid}: aria-label must be dropped once the visible label names it`
			).toBeNull();

			const label = labelElementOf(container, control);
			expect(label, `${testid}: needs a label[for] or wrapping <label>`).not.toBeNull();
			expectVisibleText(label as HTMLElement, `${testid}'s label`);

			expect(
				computedName(container, control),
				`${testid}: computed accessible name must be the visible label's text`
			).toBe(key);
		}
	});

	it('the time composite: the role="group" wrapper is named by a VISIBLE series_create_time_label element (aria-labelledby), its own aria-label gone; the hour/minute selects keep their PART names', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const group = q(container, 'series-create-time') as HTMLElement;
		expect(group).not.toBeNull();
		expect(group.getAttribute('role')).toBe('group');

		expect(
			group.getAttribute('aria-label'),
			'the group must be named by its visible label, not an aria-label'
		).toBeNull();
		const labelledby = group.getAttribute('aria-labelledby');
		expect(labelledby, 'series-create-time needs aria-labelledby').not.toBeNull();
		const nameEl = container.querySelector(`[id="${labelledby}"]`) as HTMLElement | null;
		expect(nameEl, `aria-labelledby="${labelledby}" must resolve inside the form`).not.toBeNull();
		expectVisibleText(nameEl as HTMLElement, "the time group's label");
		expect(computedName(container, group)).toBe('series_create_time_label');

		for (const part of ['series-create-time-hour', 'series-create-time-minute']) {
			const sel = q(container, part) as HTMLSelectElement;
			expect(sel, part).not.toBeNull();
			expect(sel.getAttribute('aria-label')?.trim(), `${part} keeps its part name`).toBeTruthy();
		}
	});
});

describe('#239 — the form is grouped into four native fieldsets with visible legends', () => {
	function formFieldsets(container: HTMLElement): HTMLFieldSetElement[] {
		const form = q(container, 'series-create-form') as HTMLElement;
		expect(form).not.toBeNull();
		return [...form.querySelectorAll<HTMLFieldSetElement>('fieldset')];
	}

	const GROUP_LEGEND_KEYS = [
		'series_create_group_general_label',
		'series_create_group_location_label',
		'series_create_group_schedule_label',
		'series_create_group_preview_label'
	] as const;

	it('exactly four <fieldset>s, unnested, in the PO-ruled order, each led by a visible <legend> carrying its group key', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const fieldsets = formFieldsets(container);
		expect(fieldsets, 'the form must hold exactly four fieldsets').toHaveLength(4);

		fieldsets.forEach((fieldset, i) => {
			expect(
				fieldset.parentElement?.closest('fieldset'),
				`fieldset ${i} must not nest inside another`
			).toBeNull();
			const legend = fieldset.firstElementChild as HTMLElement | null;
			expect(legend?.tagName, `fieldset ${i} must LEAD with its <legend>`).toBe('LEGEND');
			expect((legend as HTMLElement).textContent?.trim()).toBe(GROUP_LEGEND_KEYS[i]);
			expect(
				(legend as HTMLElement).hasAttribute('hidden') ||
					(legend as HTMLElement).getAttribute('aria-hidden') === 'true' ||
					Array.from((legend as HTMLElement).classList).includes('sr-only'),
				`fieldset ${i}'s legend must be visible — the heading is the point`
			).toBe(false);
		});
	});

	it('membership: general(name,type,description) · location(location,duration) · schedule(repeat,day,time,from,until)', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const fieldsets = formFieldsets(container);
		expect(fieldsets).toHaveLength(4);

		const MEMBERSHIP: ReadonlyArray<readonly [testid: string, group: number]> = [
			['series-create-name', 0],
			['series-create-type', 0],
			['series-create-description', 0],
			['series-create-location', 1],
			['series-create-duration', 1],
			['series-create-repeat', 2],
			['series-create-day', 2], // weekly default → rendered
			['series-create-time', 2],
			['series-create-from', 2],
			['series-create-until', 2]
		];
		for (const [testid, group] of MEMBERSHIP) {
			const control = q(container, testid) as HTMLElement;
			expect(control, testid).not.toBeNull();
			expect(
				control.closest('fieldset'),
				`${testid} belongs in fieldset ${group} (${GROUP_LEGEND_KEYS[group]})`
			).toBe(fieldsets[group]);
		}
	});

	it('group 4 (Loodavad sündmused): the live preview and the submit button sit under the preview legend — and no generate control returns to anchor it', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidTemplate(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(q(container, 'series-create-preview')).not.toBeNull();
		});

		const fieldsets = formFieldsets(container);
		expect(fieldsets).toHaveLength(4);
		const previewFieldset = fieldsets[3];

		expect((q(container, 'series-create-preview') as HTMLElement).closest('fieldset')).toBe(
			previewFieldset
		);
		expect((q(container, 'series-create-preview-count') as HTMLElement).closest('fieldset')).toBe(
			previewFieldset
		);
		expect((q(container, 'series-create-submit') as HTMLElement).closest('fieldset')).toBe(
			previewFieldset
		);
		expect(q(container, 'series-create-generate')).toBeNull();
	});

	it('375px stays fluid (class contract, happy-dom computes no layout): every fieldset carries min-w-0 — the UA default min-inline-size:min-content would floor the row — and no legend or label text is whitespace-nowrap', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		const fieldsets = formFieldsets(container);
		expect(fieldsets).toHaveLength(4);
		for (const fieldset of fieldsets) {
			expect(
				Array.from(fieldset.classList),
				'a fieldset defaults to min-inline-size:min-content — min-w-0 keeps it shrinkable at 375px'
			).toContain('min-w-0');
		}
		const form = q(container, 'series-create-form') as HTMLElement;
		for (const el of form.querySelectorAll<HTMLElement>('legend, label')) {
			expect(
				Array.from(el.classList),
				'long lv/uk copy must be allowed to wrap, not overflow the card'
			).not.toContain('whitespace-nowrap');
		}
	});
});

describe('#239 — locale files: group keys verbatim (et/en)', () => {

	function messageFile(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolvePath(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it('et carries the PO-ruled copy VERBATIM', () => {
		const file = messageFile('et');
		expect(file['series_create_group_general_label']).toBe('Üldandmed');
		expect(file['series_create_group_location_label']).toBe('Koht ja kestus');
		expect(file['series_create_group_schedule_label']).toBe('Kordumine ja ajad');
		expect(file['series_create_group_preview_label']).toBe('Loodavad sündmused');
	});

	it('en carries the PO-ruled copy VERBATIM', () => {
		const file = messageFile('en');
		expect(file['series_create_group_general_label']).toBe('General');
		expect(file['series_create_group_location_label']).toBe('Place and duration');
		expect(file['series_create_group_schedule_label']).toBe('Repeat and dates');
		expect(file['series_create_group_preview_label']).toBe('Events to create');
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
