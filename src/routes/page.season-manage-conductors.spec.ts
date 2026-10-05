// @vitest-environment happy-dom
// The agenda's season-manage panel: the season's conductors and their picker.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageWritesModule({ deleteEvent: false })
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
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('handle')
);
vi.mock('$lib/files/appByteStore', async () =>
	(await import('$lib/testing/mocks/files')).appByteStoreModule()
);

import { SEASON_CARD_EXPAND } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	listSectionsMock,
	loadFullAgendaMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { addSeasonConductorMock, removeSeasonConductorMock } from '$lib/testing/mocks/seasons';
import { optionValues, q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import {
	SEASON_END,
	SEASON_ID,
	SEASON_START,
	conductorSelect,
	fixtureRows,
	promptOption
} from '$lib/testing/pages/seasonPanel';
import { openPanel } from '$lib/testing/pages/seasonManage';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { pickConductor, useSeasonManagePage } from '$lib/testing/pages/seasonManagePanel';

useSeasonManagePage();

describe('agenda — season conductors are editable in the panel', () => {
	it('the current conductor renders as a chip showing the person’s NAME (from the cached roster), not a raw entity id', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		expect(chip.textContent).toContain('Grace Hopper');
		expect(chip.textContent).not.toContain('p-grace');
	});

	it('a FAILED roster read leaves no raw person id in the chip — not in its text, not in its remove button’s accessible name', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster down'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await waitFor(() => {
			expect(chip.textContent).toContain('season_manage_conductor_unknown');
		});
		expect(chip.textContent).not.toContain('p-grace');
		const remove = chip.querySelector('button') as HTMLElement;
		expect(remove.getAttribute('aria-label')).not.toContain('p-grace');
	});

	it('a conductor who is NOT on the roster (left the collective) reads as an unknown member, never as her entity id', async () => {
		loadRosterMock.mockResolvedValue(toListRead(fixtureRows().filter((row) => row.personId !== 'p-grace')));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await waitFor(() => {
			expect(chip.textContent).toContain('season_manage_conductor_unknown');
		});
		expect(chip.textContent).not.toContain('p-grace');
		expect((chip.querySelector('button') as HTMLElement).getAttribute('aria-label')).not.toContain(
			'p-grace'
		);
	});

	it('the panel holds a NATIVE conductor <select> (#209): named by season_conductor_label, prompt option (value "", disabled selected hidden, the reworded placeholder), then every roster person NOT already a conductor, in roster order', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		expect(select.getAttribute('aria-label')).toBe('season_conductor_label');
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
		expect(select.value).toBe('');

		expect(optionValues(select)).toEqual(['', 'p-ada', 'person-p']);
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual(['season_conductor_placeholder', 'Ada Lovelace', 'Pete Wilson']);
	});

	it('option order is ROSTER order — section, then position within section — not alphabetical (Gama ruling 3)', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ ...fixtureRows()[0], sectionIds: ['sec-t'] }, // Ada → Tenor
			{ ...fixtureRows()[1], sectionIds: ['sec-s'] }, // Grace → Sopran (excluded anyway)
			{ ...fixtureRows()[2], sectionIds: ['sec-s'] } // Pete → Sopran
		]));
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(optionValues(conductorSelect(panel))).toEqual(['', 'person-p', 'p-ada']);
		});
	});

	it('adding via the panel’s select (change to a person id) calls addSeasonConductor(cfg, seasonId, <personId>), the new chip appears, and the select RESETS to the prompt', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await pickConductor(panel, 'p-ada');

		await waitFor(() => {
			expect(addSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-ada');
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-p-ada')?.textContent).toContain('Ada Lovelace');

		const select = conductorSelect(panel);
		await waitFor(() => {
			expect(select.value).toBe('');
		});
		expect(optionValues(select)).toEqual(['', 'person-p']);
	});

	it('EVERY roster person already conducts: the select stays MOUNTED but disabled with prompt text picker_everyone_added (Gama ruling 2)', async () => {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasonId: SEASON_ID,
				seasonConductors: ['p-ada', 'p-grace', 'person-p'],
				seasonEditors: ['person-p'],
				seasons: [
					{
						id: SEASON_ID,
						name: 'Season 2026',
						startDate: SEASON_START,
						endDate: SEASON_END,
						conductors: ['p-ada', 'p-grace', 'person-p'],
						owners: [],
						editors: ['person-p']
					}
				]
			})
		);

		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		await waitFor(() => {
			expect(select.disabled).toBe(true);
		});
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_everyone_added');
	});

	it('the chip’s remove button calls removeSeasonConductor(cfg, seasonId, <personId>) and the chip leaves', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		const remove = chip.querySelector('button') as HTMLElement;
		expect(remove).not.toBeNull();
		await fireEvent.click(remove);

		await waitFor(() => {
			expect(removeSeasonConductorMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'p-grace');
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).toBeNull();
		});
	});

	it('a FAILED add reverts the chip AND says so (role="alert") — a silently vanishing chip reads as a bug', async () => {
		addSeasonConductorMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		const panel = await openPanel(container);

		await pickConductor(panel, 'p-ada');

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-conductor-p-ada')).toBeNull();
	});

	it('a FAILED remove restores the chip AND surfaces the same error slot', async () => {
		removeSeasonConductorMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		const chip = q(container, 'season-manage-conductor-p-grace') as HTMLElement;
		await fireEvent.click(chip.querySelector('button') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-conductor-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
	});

	it('a SUCCESSFUL attempt after a failed one clears the error — the slot is per-attempt, not sticky', async () => {
		removeSeasonConductorMock.mockRejectedValueOnce(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')).not.toBeNull();
		});
		await fireEvent.click(
			(q(container, 'season-manage-conductor-p-grace') as HTMLElement).querySelector(
				'button'
			) as HTMLElement
		);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});

		await fireEvent.click(
			(q(container, 'season-manage-conductor-p-grace') as HTMLElement).querySelector(
				'button'
			) as HTMLElement
		);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).toBeNull();
		});
	});
});

function doubledConductorResult(conductors: string[], viewerIsEditor: boolean) {
	const season: Season = {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: SEASON_START,
		endDate: SEASON_END,
		conductors,
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function conductorEntries(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll('[data-testid^="season-manage-conductor-"]')
	).filter((el) => el.tagName === 'LI') as HTMLElement[];
}

function entryKeys(container: HTMLElement): (string | null)[] {
	return conductorEntries(container).map((el) => el.getAttribute('data-conductor-key'));
}

function entryTestids(container: HTMLElement): (string | null)[] {
	return conductorEntries(container).map((el) => el.getAttribute('data-testid'));
}

function removeButtonsFor(container: HTMLElement, personId: string): HTMLElement[] {
	return Array.from(
		container.querySelectorAll(`[data-testid="season-manage-conductor-remove-${personId}"]`)
	) as HTMLElement[];
}

describe('#483 agenda — a season holding the same conductor twice', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let windowErrors: unknown[];
	const onWindowError = (e: ErrorEvent) => {
		windowErrors.push(e.error ?? e.message);
	};
	const onRejection = (e: PromiseRejectionEvent) => {
		windowErrors.push(e.reason);
	};

	beforeEach(() => {
		windowErrors = [];
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		window.addEventListener('error', onWindowError);
		window.addEventListener('unhandledrejection', onRejection);
	});

	afterEach(() => {
		window.removeEventListener('error', onWindowError);
		window.removeEventListener('unhandledrejection', onRejection);
		consoleErrorSpy.mockRestore();
	});

	it('a writer opens the panel WITHOUT a thrown error and sees BOTH p-ada entries (keys p-ada#0, p-ada#1) plus p-grace once', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(() =>
			flushSync(() => (q(container, SEASON_CARD_EXPAND) as HTMLElement).click())
		).not.toThrow();
		const panel = await waitFor(() => {
			const el = q(container, 'season-manage-panel');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-ada#1', 'p-grace#0']);
		});
		expect(panel.isConnected).toBe(true);
		expect(conductorSelect(panel)).not.toBeNull();
		expect(
			Array.from(
				container.querySelectorAll('[data-testid="season-manage-conductor-p-ada"]')
			).map((el) => el.getAttribute('data-conductor-key'))
		).toEqual(['p-ada#0', 'p-ada#1']);
		expect(
			container.querySelectorAll('[data-testid="season-manage-conductor-p-grace"]').length
		).toBe(1);
		expect(entryTestids(container)).toEqual([
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-grace'
		]);
		for (const el of conductorEntries(container).slice(0, 2)) {
			expect(el.textContent).toContain('Ada Lovelace');
		}
		expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		expect(windowErrors).toEqual([]);
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	it('removing the SECOND p-ada calls removeSeasonConductor once (cfg, seasonId, "p-ada") and leaves exactly one p-ada and one p-grace', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[1]);

		await waitFor(() => {
			expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		});
		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0']);
		});
		expect(entryTestids(container)).toEqual([
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-grace'
		]);
		expect(q(container, 'season-manage-conductor-error')).toBeNull();
		expect(windowErrors).toEqual([]);
	});

	it('removal is by POSITION, not by id: with [ada, grace, ada], removing the FIRST ada leaves [grace, ada]', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-grace', 'p-ada'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0', 'p-ada#1']);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[0]);

		await waitFor(() => {
			expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		});
		await waitFor(() => {
			expect(entryTestids(container)).toEqual([
				'season-manage-conductor-p-grace',
				'season-manage-conductor-p-ada'
			]);
		});
		expect(entryKeys(container)).toEqual(['p-grace#0', 'p-ada#0']);
	});

	it('removal is by POSITION, not by id: with [ada, grace, ada], removing the SECOND ada leaves [ada, grace]', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-grace', 'p-ada'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[1]);

		await waitFor(() => {
			expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		});
		await waitFor(() => {
			expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0']);
		});
	});

	it('a FAILED remove of the second p-ada restores BOTH p-ada entries in their original order and surfaces the error slot', async () => {
		removeSeasonConductorMock.mockRejectedValue(new Error('boom'));
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[1]);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(removeSeasonConductorMock.mock.calls).toEqual([[CFG, SEASON_ID, 'p-ada']]);
		expect(entryKeys(container)).toEqual(['p-ada#0', 'p-ada#1', 'p-grace#0']);
		expect(entryTestids(container)).toEqual([
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-ada',
			'season-manage-conductor-p-grace'
		]);
	});

	it('a FAILED remove with [ada, grace, ada] restores the removed copy AT ITS POSITION', async () => {
		removeSeasonConductorMock.mockRejectedValue(new Error('boom'));
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-grace', 'p-ada'], true)
		);
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(removeButtonsFor(container, 'p-ada').length).toBe(2);
		});

		await fireEvent.click(removeButtonsFor(container, 'p-ada')[0]);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-error')).not.toBeNull();
		});
		expect(entryKeys(container)).toEqual(['p-ada#0', 'p-grace#0', 'p-ada#1']);
	});

	it('the add guard stays: p-ada (already present) is NOT offered by the select — no third copy from this tab', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], true)
		);
		const container = await renderReady();
		const panel = await openPanel(container);
		await waitFor(() => {
			expect(optionValues(conductorSelect(panel))).toEqual(['', 'person-p']);
		});
		expect(entryKeys(container)).toEqual(['p-ada#0', 'p-ada#1', 'p-grace#0']);
	});

	it('a NON-editor with the same doubled season never gets the panel (gate unchanged): no card, no conductor entries', async () => {
		loadFullAgendaMock.mockResolvedValue(
			doubledConductorResult(['p-ada', 'p-ada', 'p-grace'], false)
		);
		const container = await renderReady();
		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(
			Array.from(container.querySelectorAll('[data-testid^="season-manage-conductor-"]'))
		).toEqual([]);
	});
});

describe('agenda — the season-manage conductor select tells its empties apart (#209 review F1)', () => {
	it('roster read STILL IN FLIGHT: disabled with the LOADING prompt, never picker_everyone_added', async () => {
		loadRosterMock.mockReturnValue(new Promise<never>(() => {})); // never settles

		const container = await renderReady();
		const panel = await openPanel(container);

		const select = conductorSelect(panel);
		expect(select.disabled).toBe(true);
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('picker_roster_loading');
	});

	it('roster read FAILED: the prompt says the member list is UNAVAILABLE — the same failure the chips already report as "unknown", never "everyone is already added"', async () => {
		loadRosterMock.mockRejectedValue(new Error('roster boom'));

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(promptOption(conductorSelect(panel)).textContent?.trim()).toBe(
				'picker_roster_unavailable'
			);
		});
		expect(conductorSelect(panel).disabled).toBe(true);
	});

	it('SECTION read failed: the select stays usable in the roster’s own name order and says so', async () => {
		listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-order-note')).not.toBeNull();
		});
		const select = conductorSelect(panel);
		expect(select.disabled).toBe(false);
		expect(optionValues(select)).toEqual(['', 'p-ada', 'person-p']);
		expect(promptOption(select).textContent?.trim()).toBe('season_conductor_placeholder');
	});
});

describe('#321 review F2 — the panel\u2019s conductor picker states a truncated roster', () => {
	const NOTICE = 'season-manage-conductor-partial-notice';

	it('a truncated roster read renders the shared role="status" notice beside the picker', async () => {
		loadRosterMock.mockResolvedValue({ items: fixtureRows(), total: 500, truncated: true });
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, NOTICE)).not.toBeNull();
		});
		const notice = q(container, NOTICE) as HTMLElement;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
	});

	it('a complete roster read leaves it ABSENT from the DOM', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);
		await waitFor(() => {
			expect(conductorSelect(panel).options.length).toBeGreaterThan(1);
		});

		expect(q(container, NOTICE)).toBeNull();
	});
});

describe('#361 — season-manage conductor chip: the member name is marked', () => {
	it('the current conductor chip renders the name (seasonConductorLabel) through PersonName — marked, and marked once', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-p-grace')?.textContent).toContain(
				'Grace Hopper'
			);
		});
		expectNameMarkedOnce(
			q(container, 'season-manage-conductor-p-grace') as HTMLElement,
			'Grace Hopper',
			'in the season-manage conductor chip'
		);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
