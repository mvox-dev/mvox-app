// @vitest-environment happy-dom
// Event creation on the agenda page: values inherited from a chosen series.
import { waitFor } from '@testing-library/svelte';
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

import { fillDateTime } from '$lib/testing/timeControls';
import { createEventMock } from '$lib/testing/mocks/events';
import { getSeriesDefaultsMock } from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { fill, openFormFromPanel, selectValue, submit } from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { chooseType, lastCreateInput, useEventCreatePage } from '$lib/testing/pages/eventCreate';

useEventCreatePage();

describe('agenda — selecting a series keeps DESCRIPTIVE placeholders and shows the inherited values as "From series" secondary lines (#208)', () => {
	async function openWithSeries1(container: HTMLElement): Promise<void> {
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');
		await waitFor(() => {
			expect(getSeriesDefaultsMock).toHaveBeenCalledWith(CFG, 'series-1');
		});
	}

	function inherited(container: HTMLElement, field: string): string | null {
		const el = q(container, `event-create-${field}-inherited`);
		return el ? (el.textContent ?? '').trim() : null;
	}

	it('all four placeholders stay the DESCRIPTIVE keys, the VALUES stay empty, and each inherited value renders on its own muted line (exact strings)', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});
		expect(inherited(container, 'duration')).toEqual('event_create_inherited_from_series 90 min');
		expect(inherited(container, 'location')).toEqual(
			'event_create_inherited_from_series Main hall'
		);
		expect(inherited(container, 'description')).toEqual(
			'event_create_inherited_from_series Bring the black folder'
		);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		const location = q(container, 'event-create-location') as HTMLInputElement;
		const description = q(container, 'event-create-description') as HTMLTextAreaElement;
		expect(name.placeholder).toBe('event_create_name_placeholder');
		expect(location.placeholder).toBe('event_create_location_placeholder');
		expect(description.placeholder).toBe('event_create_description_placeholder');
		expect(name.value).toBe('');
		expect(location.value).toBe('');
		expect(description.value).toBe('');
		expect((q(container, 'event-create-end-hour') as HTMLSelectElement).value).toBe('');
		expect((q(container, 'event-create-end-minute') as HTMLSelectElement).value).toBe('');

		for (const field of ['name', 'duration', 'location', 'description']) {
			const line = q(container, `event-create-${field}-inherited`) as HTMLElement;
			expect(line.querySelector('input, select, textarea, button, a'), field).toBeNull();
		}
	});

	it('typing an OVERRIDE keeps the inherited line visible (the viewer sees what they are replacing); CLEARING it keeps the line too', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		const name = q(container, 'event-create-name') as HTMLInputElement;
		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});

		await fill(container, 'event-create-name', 'Extra rehearsal');
		expect(name.value).toBe('Extra rehearsal');
		expect(inherited(container, 'name')).toEqual(
			'event_create_inherited_from_series Monday rehearsals'
		);
		expect(name.placeholder).toBe('event_create_name_placeholder');

		await fill(container, 'event-create-name', '');
		expect(name.value).toBe('');
		expect(inherited(container, 'name')).toEqual(
			'event_create_inherited_from_series Monday rehearsals'
		);
		expect(name.placeholder).toBe('event_create_name_placeholder');
	});

	it('DESELECTING the series (back to "no series") removes ALL FOUR inherited lines', async () => {
		const container = await renderReady();
		await openWithSeries1(container);

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Monday rehearsals'
			);
		});

		await selectValue(container, 'event-create-series', '');

		await waitFor(() => {
			expect(inherited(container, 'name')).toBeNull();
		});
		expect(inherited(container, 'duration')).toBeNull();
		expect(inherited(container, 'location')).toBeNull();
		expect(inherited(container, 'description')).toBeNull();
	});

	it('a series providing ONLY name + duration renders exactly those two lines — no location/description line for values the series does not carry', async () => {
		getSeriesDefaultsMock.mockResolvedValue({
			name: 'Ad-hoc sectionals',
			durationMinutes: 45,
			defaultLocation: '',
			defaultDescription: ''
		});
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-2');

		await waitFor(() => {
			expect(inherited(container, 'name')).toEqual(
				'event_create_inherited_from_series Ad-hoc sectionals'
			);
		});
		expect(inherited(container, 'duration')).toEqual('event_create_inherited_from_series 45 min');
		expect(inherited(container, 'location')).toBeNull();
		expect(inherited(container, 'description')).toBeNull();
	});
});

describe('agenda — the inheritance preview covers DESCRIPTION too (2nd-pass F4, #208 secondary line)', () => {
	it('a series carrying a default_description shows it on the description "From series" line — the placeholder stays descriptive', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await selectValue(container, 'event-create-series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'event-create-description-inherited')?.textContent?.trim()).toBe(
				'event_create_inherited_from_series Bring the black folder'
			);
		});
		expect((q(container, 'event-create-description') as HTMLTextAreaElement).placeholder).toBe(
			'event_create_description_placeholder'
		);
		await chooseType(container, 'concert');
		await fillDateTime(container, 'event-create-datetime', '2027-04-18', '19:00');
		await submit(container);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(lastCreateInput().description).toBeUndefined();
	});
});

describe('#208 — the "From series" secondary line copy', () => {
	function messages(locale: string): Record<string, string> {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as Record<string, string>;
	}

	it('event_create_inherited_from_series carries the {value} slot in en/et/lv/uk', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['event_create_inherited_from_series'];
			expect(msg, `${locale}.json event_create_inherited_from_series lacks {value}`).toContain(
				'{value}'
			);
		}
	});

	it('the en/et copy is the ruled wording (Gama, #208): "From series: {value}" / "Seeriast: {value}"', () => {
		expect(messages('en')['event_create_inherited_from_series']).toBe('From series: {value}');
		expect(messages('et')['event_create_inherited_from_series']).toBe('Seeriast: {value}');
	});

	it('guard: agenda_duration_min (the inherited-duration unit) keeps {minutes} in all four locales', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msg = messages(locale)['agenda_duration_min'];
			expect(msg, `${locale}.json agenda_duration_min lacks {minutes}`).toContain('{minutes}');
		}
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
