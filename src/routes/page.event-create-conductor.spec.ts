// @vitest-environment happy-dom
// Event creation on the agenda page: the conductor select and picker.
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

import { optionValues } from '$lib/testing/timeControls';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { q } from '$lib/testing/pages/dom';
import { fixtureRows, openFormFromPanel, promptOption } from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { conductorSelect, pickConductor, useEventCreatePage } from '$lib/testing/pages/eventCreate';

useEventCreatePage();

describe('agenda — the conductor select (#209) is fed from the cached roster', () => {
	it('the roster loads at most ONCE (through getRoster), only when the form opens; the select offers every roster person; a picked conductor renders as a NAMED chip and the select resets to the prompt', async () => {
		const container = await renderReady();
		expect(loadRosterMock).not.toHaveBeenCalled();

		await openFormFromPanel(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		const select = conductorSelect(container);
		await waitFor(() => {
			expect(optionValues(select)).toEqual(['', 'p-ada', 'p-grace', 'person-p']);
		});
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual([
			'event_create_conductor_placeholder',
			'Ada Lovelace',
			'Grace Hopper',
			'Pete Wilson'
		]);

		await pickConductor(container, 'p-ada');

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'event-create-conductor-p-ada')?.textContent).toContain('Ada Lovelace');

		await waitFor(() => {
			expect(conductorSelect(container).value).toBe('');
		});
		expect(optionValues(conductorSelect(container))).toEqual(['', 'p-grace', 'person-p']);

		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('option order is ROSTER order — section (listSections tree order), then position within section, Unassigned last — NOT alphabetical (Gama ruling 3)', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ ...fixtureRows()[0], sectionIds: ['sec-t'] }, // Ada → Tenor
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran
			{ ...fixtureRows()[2], sectionIds: [] } // Pete → Unassigned
		]));
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(optionValues(conductorSelect(container))).toEqual([
				'',
				'p-grace',
				'p-ada',
				'person-p'
			]);
		});
	});

	it('EVERYONE picked: the select stays MOUNTED but disabled and its prompt text becomes picker_everyone_added (Gama ruling 2)', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);

		await pickConductor(container, 'p-ada');
		await pickConductor(container, 'p-grace');
		await pickConductor(container, 'person-p');

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-person-p')).not.toBeNull();
		});
		const select = conductorSelect(container);
		await waitFor(() => {
			expect(select.disabled).toBe(true);
		});
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_everyone_added');

		await fireEvent.click(q(container, 'event-create-conductor-remove-p-ada') as HTMLElement);
		await waitFor(() => {
			expect(conductorSelect(container).disabled).toBe(false);
		});
		expect(optionValues(conductorSelect(container))).toEqual(['', 'p-ada']);
		expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
			'event_create_conductor_placeholder'
		);
	});
});

describe('agenda — the event-create conductor select tells its empties apart (#209 review F1)', () => {
	it('roster read STILL IN FLIGHT: disabled with the LOADING prompt, never picker_everyone_added', async () => {
		loadRosterMock.mockReturnValue(new Promise<never>(() => {})); // never settles

		const container = await renderReady();
		await openFormFromPanel(container);

		const select = conductorSelect(container);
		expect(select.disabled).toBe(true);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE, permanently visible rather than reading as "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(container)).textContent?.trim()).toBe(
				'picker_roster_unavailable'
			);
		});
		expect(conductorSelect(container).disabled).toBe(true);
	});

	it('SECTION read failed: the select stays usable in the roster’s own name order and says so', async () => {
		listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(q(container, 'event-create-conductor-order-note')).not.toBeNull();
		});
		const select = conductorSelect(container);
		expect(select.disabled).toBe(false);
		expect(promptOption(select).textContent?.trim()).toBe('event_create_conductor_placeholder');
	});
});

describe('the event-create conductor picker (#321 review F2)', () => {
	const NOTICE = '[data-testid="event-create-conductor-partial-notice"]';

	it('a truncated roster read renders the shared role="status" notice beside the picker', async () => {
		loadRosterMock.mockResolvedValue({ items: fixtureRows(), total: 500, truncated: true });
		const container = await renderReady();
		await openFormFromPanel(container);

		await waitFor(() => {
			expect(container.querySelector(NOTICE)).not.toBeNull();
		});
		const notice = container.querySelector(NOTICE)!;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
	});

	it('a complete roster read leaves it ABSENT from the DOM', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await waitFor(() => {
			expect(conductorSelect(container).options.length).toBeGreaterThan(1);
		});

		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

describe('#361 — event-create conductor chip: the member name is marked', () => {
	it('a picked conductor chip renders the name through PersonName — marked, and marked once', async () => {
		const container = await renderReady();
		await openFormFromPanel(container);
		await waitFor(() => {
			expect(optionValues(conductorSelect(container))).toContain('p-ada');
		});
		await pickConductor(container, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'event-create-conductor-p-ada')).not.toBeNull();
		});
		expectNameMarkedOnce(
			q(container, 'event-create-conductor-p-ada') as HTMLElement,
			'Ada Lovelace',
			'in the event-create conductor chip'
		);
	});
});

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
