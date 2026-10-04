// @vitest-environment happy-dom
// The saved cue on season-manage name and date edits.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageWritesModule({ deleteEvent: false })
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule([])
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

import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
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
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addSeasonConductorMock,
	countSeasonScopeMock,
	countSeriesOccurrencesMock,
	deleteEventSeriesMock,
	deleteSeasonMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	listRepertoireItemsMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';
import { cleanupClearReset, q } from '$lib/testing/pages/dom';
import { CFG, flush } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import { SEASON_ID, isoDate, openPanelForSeason } from '$lib/testing/pages/seasonPanel';
import { fixtureRows, upcomingSeason } from '$lib/testing/pages/seasonFields';
import { renderReady } from '$lib/testing/pages/seasonRender';

function currentSeason(): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: ['p-grace'],
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

function twoSeasonResult() {
	return fullAgendaResult({ seasons: [currentSeason(), upcomingSeason()] });
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
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
});

afterEach(cleanupClearReset);

async function beginFieldEdit(
	container: HTMLElement,
	field: 'name' | 'start_date' | 'end_date'
): Promise<HTMLInputElement> {
	await waitFor(() => {
		expect(q(container, `season-edit-btn-${field}`), `season-edit-btn-${field}`).not.toBeNull();
	});
	await fireEvent.click(q(container, `season-edit-btn-${field}`) as HTMLElement);
	return await waitFor(() => {
		const el = q(container, `season-edit-input-${field}`);
		expect(el, `season-edit-input-${field} missing after tapping edit`).not.toBeNull();
		return el as HTMLInputElement;
	});
}

async function commitFieldEdit(
	container: HTMLElement,
	field: 'name' | 'start_date' | 'end_date',
	value: string
): Promise<void> {
	const input = await beginFieldEdit(container, field);
	await fireEvent.input(input, { target: { value } });
	await fireEvent.blur(input);
}

describe('#328 season fields — the saved-cue region exists from first render', () => {
	it('open panel: a PERSISTENT empty role="status" aria-live="polite" region (season-edit-status) is mounted BEFORE any write — and it is its OWN node, not the conductor half’s', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		const status = q(container, 'season-edit-status');
		expect(status, 'expected the persistent season-edit-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		expect(container.querySelectorAll('[data-testid="season-edit-status"]')).toHaveLength(1);

		const conductorStatus = q(container, 'season-manage-conductor-status');
		expect(conductorStatus, 'the #325 conductor region must still exist').not.toBeNull();
		expect(status).not.toBe(conductorStatus);
	});
});

describe('#328 season fields — a write that reconciles announces saved', () => {
	it('name blur-commit: NOTHING announced while the write is in flight; the settle sets season_manage_saved into season-edit-status; no error node; the field stays editable', async () => {
		const d = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValue(d.promise);
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'name', 'Renamed 2026');
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed 2026');

		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
		expect(q(container, 'season-edit-error-name')).toBeNull();
		expect((q(container, 'season-edit-btn-name') as HTMLButtonElement).disabled).toBe(false);
	});

	it('start_date commit announces into the SAME season-edit-status region — one node per surface, shared by all three fields', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'start_date', isoDate(-10));
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'start_date', isoDate(-10));
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
		expect(container.querySelectorAll('[data-testid="season-edit-status"]')).toHaveLength(1);
	});

	it('the cue describes the LATEST write: by the time a second edit is in flight the region is blank again, and its settle re-announces', async () => {
		const first = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValueOnce(first.promise);
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'name', 'Renamed 2026');
		first.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});

		const second = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValueOnce(second.promise);
		await commitFieldEdit(container, 'name', 'Renamed again');
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');

		second.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
	});
});

describe('#328 season fields — failure handling stays byte-identical', () => {
	it('a rejected name write still reverts the value and renders season-edit-error-name role="alert" (season_manage_save_error) — and season-edit-status announces NOTHING', async () => {
		const d = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValueOnce(d.promise);
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'name', 'Renamed 2026');
		d.reject(new Error('season write rejected'));

		await waitFor(() => {
			const alert = q(container, 'season-edit-error-name');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('season_manage_save_error');
		});
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Renamed 2026');
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
	});

	it('a refused RANGE edit (no wire call at all) still shows the range alert and never announces saved', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'end_date', isoDate(-60));
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
	});

	it('#328 review R2-F2 — a refusal AFTER a successful write clears the region: no stale “saved” standing beside the fresh range alert', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await commitFieldEdit(container, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-edit-status')?.textContent).toContain('season_manage_saved');
		});
		updateSeasonFieldMock.mockClear();

		await commitFieldEdit(container, 'end_date', isoDate(-60));
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
	});
});

describe('#328 season fields — a late settle never announces onto the NEW season’s panel', () => {
	it('a name save on A still in flight when the admin switches to B: B starts blank; A’s write settling late announces NOTHING, paints NO value and raises NO error on B (seasonManageSwitchGeneration gates the settle)', async () => {
		loadFullAgendaMock.mockResolvedValue(twoSeasonResult());
		const d = deferred<undefined>();
		updateSeasonFieldMock.mockReturnValue(d.promise);
		const container = await renderReady();

		await openPanelForSeason(container, 'Season 2026');
		await commitFieldEdit(container, 'name', 'Renamed 2026');
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Renamed 2026');
		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Renamed 2026');
		});

		await openPanelForSeason(container, 'Season 2027');

		const status = q(container, 'season-edit-status');
		expect(status, 'expected the persistent season-edit-status region on B').not.toBeNull();
		expect(status!.textContent?.trim()).toBe('');
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');

		d.resolve(undefined);
		await flush();

		expect(q(container, 'season-edit-status')?.textContent?.trim()).toBe('');
		expect(q(container, 'season-edit-error-name')).toBeNull();
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2027');
		expect((q(container, 'season-edit-btn-name') as HTMLButtonElement).disabled).toBe(false);
	});
});

// (*MVOX:Tallis*)
