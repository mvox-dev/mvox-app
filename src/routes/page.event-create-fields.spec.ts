// @vitest-environment happy-dom
// Event creation on the agenda page: the form's fields and their visible labels.
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

import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import { HOURS_24, MINUTES_5, optionValues } from '$lib/testing/timeControls';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import {
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock
} from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import {
	SEASON_ID,
	openFormFromPanel,
	promptOption,
	selectValue
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import {
	UPCOMING_SEASON_ID,
	agendaResult,
	conductorSelect,
	useEventCreatePage
} from '$lib/testing/pages/eventCreate';

useEventCreatePage();

function typeSelect(container: HTMLElement): HTMLSelectElement {
	const select = q(container, 'event-create-type') as HTMLSelectElement;
	expect(select).not.toBeNull();
	return select;
}

describe('agenda — the event creation form carries every sketch-C field', () => {
	it('name (text), datetime (datetime-local), duration + capacity (number), location (text), description (TEXTAREA), a type picker (#199 canonical select) and a native conductor select (#209)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		expect(name.tagName).toBe('INPUT');

		const datetime = q(container, 'event-create-datetime') as HTMLElement;
		expect(datetime).not.toBeNull();
		expect(datetime.tagName).not.toBe('INPUT');
		const dtDate = q(container, 'event-create-datetime-date') as HTMLInputElement;
		expect(dtDate).not.toBeNull();
		expect(dtDate.type).toBe('date');
		const dtHour = q(container, 'event-create-datetime-hour') as HTMLSelectElement;
		const dtMinute = q(container, 'event-create-datetime-minute') as HTMLSelectElement;
		expect(dtHour.tagName).toBe('SELECT');
		expect(dtMinute.tagName).toBe('SELECT');
		expect(optionValues(dtHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(dtMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'event-create-datetime-ampm'), '24h is the default').toBeNull();

		expect(q(container, 'event-create-duration'), '#243 removed the duration input').toBeNull();
		const end = q(container, 'event-create-end') as HTMLElement;
		expect(end, '#243: the end composite (event-create-end)').not.toBeNull();
		expect(end.tagName).not.toBe('INPUT');
		const endDate = q(container, 'event-create-end-date') as HTMLInputElement;
		expect(endDate, 'native end date input (native pickers stay, #207 Option 1)').not.toBeNull();
		expect(endDate.type).toBe('date');
		const endHour = q(container, 'event-create-end-hour') as HTMLSelectElement;
		const endMinute = q(container, 'event-create-end-minute') as HTMLSelectElement;
		expect(endHour.tagName, 'end time is the shipped TimeSelect (rule 5)').toBe('SELECT');
		expect(endMinute.tagName).toBe('SELECT');
		expect(optionValues(endHour).filter((v) => v !== '')).toEqual(HOURS_24);
		expect(optionValues(endMinute).filter((v) => v !== '')).toEqual(MINUTES_5);
		expect(q(container, 'event-create-end-ampm'), '24h is the default').toBeNull();

		const capacity = q(container, 'event-create-capacity') as HTMLInputElement;
		expect(capacity).not.toBeNull();
		expect(capacity.type).toBe('number');

		const location = q(container, 'event-create-location') as HTMLInputElement;
		expect(location).not.toBeNull();
		expect(location.tagName).toBe('INPUT');

		const description = q(container, 'event-create-description') as HTMLElement;
		expect(description).not.toBeNull();
		expect(description.tagName).toBe('TEXTAREA');

		expect(typeSelect(container).tagName).toBe('SELECT');
		const conductors = conductorSelect(container);
		expect(
			conductors.getAttribute('aria-label'),
			'#249 — the visible label replaced the aria-label'
		).toBeNull();
		expect(
			conductors.closest('label'),
			'#249 — the conductor select is named by a wrapping visible <label>'
		).not.toBeNull();
		expect(promptOption(conductors).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
		expect(conductors.value).toBe('');
	});

	it('the season select offers EVERY known season (value = id, its NAME visible) behind a "" placeholder option', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromPanel(container);

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		const options = [...season.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', SEASON_ID, UPCOMING_SEASON_ID]);
		expect(options[1].textContent).toContain('Season 2026');
		expect(options[2].textContent).toContain('Season 2027');
	});

	it('choosing a season (agenda-opened) loads THAT season’s series — listSeriesOptionsForSeason(cfg, <the selected id>) — and enables the series select with a "" (no-series) option first', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();
		await openFormFromPanel(container);

		await selectValue(container, 'event-create-season', UPCOMING_SEASON_ID);

		await waitFor(() => {
			expect(listSeriesOptionsForSeasonMock).toHaveBeenCalledWith(CFG, UPCOMING_SEASON_ID);
		});
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		await waitFor(() => {
			expect(series.disabled).toBe(false);
		});
		const options = [...series.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['', 'series-1', 'series-2']);
		expect(options[1].textContent).toContain('Monday rehearsals');
		expect(options[2].textContent).toContain('Sectionals');
	});

	it('opening the form makes one series read, the options-only one (#594)', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});
		const panelReads = listEventSeriesForSeasonMock.mock.calls.length;

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			const series = q(container, 'event-create-series');
			expect(series?.querySelector('[value="series-1"]')).not.toBeNull();
		});

		expect(listSeriesOptionsForSeasonMock.mock.calls).toEqual([[CFG, SEASON_ID]]);
		expect(listEventSeriesForSeasonMock.mock.calls.length).toBe(panelReads);
	});
});

describe('agenda — every event-create field keeps a VISIBLE label (review F4 + F5)', () => {
	it('#208: a series providing ONLY a name — every placeholder stays the static descriptive hint, and only the NAME gets a "From series" line', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: 'Ad-hoc sectionals',
			durationMinutes: null,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');

		await waitFor(() => {
			expect(q(container, 'event-create-name-inherited')?.textContent?.trim()).toBe(
				'event_create_inherited_from_series Ad-hoc sectionals'
			);
		});
		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
		expect(q(container, 'event-create-duration-inherited')).toBeNull();
		expect(q(container, 'event-create-location-inherited')).toBeNull();
		expect(q(container, 'event-create-description-inherited')).toBeNull();
	});

	it('capacity and description carry placeholders, not an aria-label alone — capacity sits beside a duration box that has one', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		expect((q(container, 'event-create-capacity') as HTMLInputElement).placeholder).toBe(
			'event_create_capacity_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
	});
});

describe('#249 — every event-create control carries a visible label that IS its accessible name', () => {
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
		['event-create-season', 'event_create_season_label'],
		['event-create-series', 'event_create_series_label'],
		['event-create-name', 'event_create_name_label'],
		['event-create-capacity', 'event_create_capacity_label'],
		['event-create-location', 'event_create_location_label'],
		['event-create-description', 'event_create_description_label'],
		['event-create-conductor-select', 'event_create_conductor_label']
	];

	async function openReadyForm(): Promise<HTMLElement> {
		const container = await renderReady();
		await openFormFromPanel(container);
		return container;
	}

	it('all seven aria-only controls: a visible <label> (for= or wrapping) computes as the accessible name, and the old aria-label is GONE — never a placeholder as the only name', async () => {
		const container = await openReadyForm();

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

	it("event-create-type sheds its redundant aria-label (the #205 F1 double-naming shape, Gama's scope note on #242): the visible label STAYS and is the only authored name", async () => {
		const container = await openReadyForm();

		const type = q(container, 'event-create-type') as HTMLSelectElement;
		expect(type).not.toBeNull();
		expect(
			type.getAttribute('aria-label'),
			'the wrapping label already names the select — the same-key aria-label is redundant'
		).toBeNull();

		const caption = q(container, 'event-create-type-label') as HTMLElement;
		expect(caption).not.toBeNull();
		expect(caption.textContent?.trim()).toBe('event_create_type_label');
		expectVisibleText(caption, "event-create-type's label");
		expect(type.closest('label')).toBe(caption.closest('label'));
		expect(computedName(container, type)).toBe('event_create_type_label');
	});

	it('the already-labeled start/end groups are UNTOUCHED: still named by their visible spans via aria-labelledby, still no aria-label (done-when 7)', async () => {
		const container = await openReadyForm();

		for (const [testid, key] of [
			['event-create-datetime', 'event_create_start_label'],
			['event-create-end', 'event_create_end_label']
		] as const) {
			const group = q(container, testid) as HTMLElement;
			expect(group, testid).not.toBeNull();
			expect(group.getAttribute('role'), testid).toBe('group');
			expect(group.getAttribute('aria-label'), `${testid}: #205 F1 trap stays fixed`).toBeNull();
			expect(computedName(container, group), testid).toBe(key);
		}
	});

	it('labels are ADDITIVE (rule 4): every placeholder/prompt survives exactly as it was', async () => {
		const container = await openReadyForm();

		expect((q(container, 'event-create-name') as HTMLInputElement).placeholder).toBe(
			'event_create_name_placeholder'
		);
		expect((q(container, 'event-create-capacity') as HTMLInputElement).placeholder).toBe(
			'event_create_capacity_placeholder'
		);
		expect((q(container, 'event-create-location') as HTMLInputElement).placeholder).toBe(
			'event_create_location_placeholder'
		);
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);

		const season = q(container, 'event-create-season') as HTMLSelectElement;
		expect(season.querySelector('option[value=""]')?.textContent?.trim()).toBe(
			'event_create_season_placeholder'
		);
		const series = q(container, 'event-create-series') as HTMLSelectElement;
		expect(series.querySelector('option[value=""]')?.textContent?.trim()).toBe(
			'event_create_series_none'
		);
		const conductors = conductorSelect(container);
		expect(promptOption(conductors).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
	});

	it("#248's location datalist wiring is untouched: the location input keeps list= resolving to a real <datalist>, INSIDE its new label", async () => {
		const container = await openReadyForm();

		const location = q(container, 'event-create-location') as HTMLInputElement;
		const listId = location.getAttribute('list');
		expect(listId, 'the location input must keep its list= attribute').toBeTruthy();
		expect(
			document.querySelector(`datalist[id="${listId}"]`),
			`<datalist id="${listId}"> must still exist in the page`
		).not.toBeNull();
	});

	it('NO fieldsets/legends: grouping is explicitly deferred (done-when 5) — labels ship alone', async () => {
		const container = await openReadyForm();

		const form = q(container, 'event-create-form') as HTMLElement;
		expect(form).not.toBeNull();
		expect(
			form.querySelectorAll('fieldset').length,
			"#239's four legends must NOT be copied across mechanically"
		).toBe(0);
		expect(form.querySelectorAll('legend').length).toBe(0);
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
