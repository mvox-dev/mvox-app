// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw', {
		season_manage_delete_progress: (p: { current: number; total: number }) =>
			`Kustutan ${p.current} / ${p.total}…`,
	})
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
// The season-management data layer — the ONE seam the panel may read/write
// through. #197 widens it with the two delete functions.
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageWritesModule({ deleteEvent: true })
);
vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/events')).entityCreateModule([])
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
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
// Supplementary page data, irrelevant here — mocked so no real fetch fires.
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
// The viewer IS a season editor here, so the page's loadManagePickers fires —
// stub its reads or they hit the network.
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireDataModule('empty')
);

import Page from './+page.svelte';
// NOT mocked (and deliberately not part of the seasonManage mock above): the
// refusal discriminators live in their own module precisely so the page can
// read them while `$lib/seasons/seasonManage` is replaced wholesale.
import { CascadePartialError, EntityDeleteForbiddenError } from '$lib/seasons/deleteErrors';
import {
	openSeasonCardPanel,
	collapseSeasonCard,
	SEASON_CARD_EXPAND,
	SEASON_CARD_COLLAPSE
} from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock
} from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	addSeasonConductorMock,
	countSeasonScopeMock,
	countSeriesOccurrencesMock,
	deleteEventMock,
	deleteEventSeriesMock,
	deleteSeasonMock,
	getSeriesDefaultsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	removeSeasonConductorMock,
	updateSeasonFieldMock
} from '$lib/testing/mocks/seasons';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function agendaResult(opts: { editor?: boolean } = {}) {
	const { editor = true } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

interface SeriesRow {
	id: string;
	name: string;
	eventCount: number;
	ownerIds: string[];
}
interface EventRow {
	id: string;
	name: string;
	startDatetime: string;
}

let seriesRows: SeriesRow[] = [];
let eventRows: EventRow[] = [];

let liveOccurrenceCount: Record<string, number> = {};
let cascadeDeletedCount: Record<string, number> = {};

function resetRows(): void {
	seriesRows = [
		{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12, ownerIds: ['person-p'] },
		{ id: 'series-2', name: 'Sectionals', eventCount: 0, ownerIds: ['person-p'] }
	];
	eventRows = [{ id: 'ev-9', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }];
	liveOccurrenceCount = { 'series-1': 14, 'series-2': 0 };
	cascadeDeletedCount = { 'series-1': 9, 'series-2': 0 };
}

function setAuthedWithOneCollective(): void {
	signIn();
}

beforeEach(() => {
	resetRows();
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockImplementation(async () => ({ items: [...seriesRows], truncated: false }));
	listEventsForSeasonMock.mockImplementation(async () => toListRead([...eventRows]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: '',
		durationMinutes: null,
		defaultLocation: '',
		defaultDescription: ''
	});
	deleteEventMock.mockImplementation(async (_cfg: unknown, eventId: string) => {
		eventRows = eventRows.filter((row) => row.id !== eventId);
	});
	deleteEventSeriesMock.mockImplementation(async (_cfg: unknown, seriesId: string) => {
		seriesRows = seriesRows.filter((row) => row.id !== seriesId);
		return cascadeDeletedCount[seriesId] ?? 0;
	});
	countSeriesOccurrencesMock.mockImplementation(
		async (_cfg: unknown, seriesId: string) => liveOccurrenceCount[seriesId] ?? 0
	);
	countSeasonScopeMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
	deleteSeasonMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	deleteEventMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function armAndConfirmDelete(
	container: HTMLElement,
	kind: 'series' | 'event',
	id: string
): Promise<void> {
	await fireEvent.click(q(container, `season-manage-${kind}-delete-${id}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `season-manage-${kind}-delete-confirm-${id}`)).not.toBeNull();
	});
	await fireEvent.click(
		q(container, `season-manage-${kind}-delete-confirm-${id}`) as HTMLElement
	);
}

/** #261 — expand the season card (the gear is gone; routed through the ONE
 *  shared helper), wait for the panel AND its series list (#313: the panel
 *  has no standalone-event list any more). */
async function openPanelWithRows(container: HTMLElement): Promise<HTMLElement> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});
	return q(container, 'season-manage-panel') as HTMLElement;
}

// ── #197: the delete affordances exist, inside the rights-gated panel ───────────

describe('agenda — #197 delete buttons render in the season-manage panel (integration: real route)', () => {
	it('editor expands the season card: EVERY series row carries its own delete BUTTON with an accessible name, inside the panel; merely rendering deletes nothing', async () => {
		const container = await renderReady();
		const panel = await openPanelWithRows(container);

		// One delete per series row, INSIDE that row.
		for (const seriesId of ['series-1', 'series-2']) {
			const btn = q(container, `season-manage-series-delete-${seriesId}`) as HTMLElement;
			expect(btn).not.toBeNull();
			expect(btn.tagName).toBe('BUTTON');
			// Icon-only affordance MUST carry a name a screen reader can announce.
			expect(btn.getAttribute('aria-label') || btn.textContent?.trim()).toBeTruthy();
			expect(btn.closest(`[data-testid="season-manage-series-${seriesId}"]`)).not.toBeNull();
			expect(panel.contains(btn)).toBe(true);
		}

		// Rendering the affordances wrote nothing.
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no card, no panel — and no delete affordance ANYWHERE on the page (fail-closed)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(container.querySelector('[data-testid^="season-manage-series-delete-"]')).toBeNull();
	});
});

// ── #197: clicking delete calls the data layer and the row leaves ───────────────

describe('agenda — #197 clicking delete removes the series / event', () => {
	it('a series row’s delete calls deleteEventSeries(cfg, seriesId) ONCE; the row leaves the display, the OTHER series survives', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		// #216 — the page now hands the cascade its progress sink: the counter is
		// driven by the data layer's own ticks, so the call carries the options
		// object (fetchImpl stays the unsupplied third positional).
		expect(deleteEventSeriesMock).toHaveBeenCalledWith(CFG, 'series-1', undefined, {
			onProgress: expect.any(Function)
		});
		// Never the sibling write — a series id goes to the SERIES delete only.
		expect(deleteEventMock).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});
		expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
	});

	it('a SUCCESSFUL delete refetches the agenda the page is showing — the panel survives the reload', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);
		const agendaLoadsBefore = loadFullAgendaMock.mock.calls.length;

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(agendaLoadsBefore);
		});
		// The panel the editor is standing in is NOT torn down by that reload.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
		});
	});

	it('a deleted row STAYS gone across panel close + reopen — local truth and the (mock-)backend agree', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});

		// #261 — the panel has no internal close; the title row folds it shut.
		await collapseSeasonCard(container);

		await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-series-1')).toBeNull();
	});

	// #197 review F5 — a successful delete used to say nothing at all: the row
	// just went. Same WCAG 4.1.3 gap `roster-section-remove-status` closes.
	it('announces the removal by name in a visually-hidden role="status" region', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		const status = q(container, 'season-manage-delete-status') as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.className).toContain('sr-only');
		expect(status.textContent?.trim()).toBe(''); // mounted EMPTY — a live region announces changes

		await armAndConfirmDelete(container, 'series', 'series-2');

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-status') as HTMLElement).textContent
			).toContain('Sectionals');
		});
	});

	it('announces how many occurrences the CASCADE deleted, not the count the list was showing', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-status') as HTMLElement).textContent
			).toContain('Monday rehearsals');
		});
		const announced = (q(container, 'season-manage-delete-status') as HTMLElement).textContent ?? '';
		expect(announced).toContain('9');
		expect(announced).not.toContain('12');
		expect(announced).not.toContain('14');
	});

	it('a cascade that deleted NOTHING (an empty series) announces the plain removal — no phantom count', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-2');

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-status') as HTMLElement).textContent
			).toContain('Sectionals');
		});
		const announced = (q(container, 'season-manage-delete-status') as HTMLElement).textContent ?? '';
		expect(announced).toContain('season_manage_deleted');
		expect(announced).not.toContain('season_manage_series_deleted');
	});
});

// ── #197 review F2: the two-step confirm ────────────────────────────────────────

describe('agenda — #197 delete is a TWO-step confirm, never a single tap', () => {
	it('tapping the series × writes NOTHING — it swaps in confirm/cancel, and the confirm carries the LIVE occurrence count, not the list’s stale one', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);

		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-delete-cancel-series-1')).not.toBeNull();
		// The × itself is GONE while armed — one control, one meaning.
		expect(q(container, 'season-manage-series-delete-series-1')).toBeNull();

		await waitFor(() => {
			expect(countSeriesOccurrencesMock).toHaveBeenCalledWith(CFG, 'series-1');
		});
		await waitFor(() => {
			const confirm = q(container, 'season-manage-series-delete-confirm-series-1') as HTMLElement;
			const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
			expect(shown).toContain('14');
			expect(shown).not.toContain('12');
		});
		// …and the row's own count is corrected to match, so the panel never shows
		// two different numbers for the same series.
		expect(q(container, 'season-manage-series-series-1')?.textContent).toContain('14');
		// A COUNT is a read: arming still wrote nothing.
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	// The count read is a network call like any other, and it must not be able to
	// block a delete. A failure leaves the confirm COUNT-FREE — never falling back
	// to the stale figure, which would be the exact lie this re-read removes.
	it('a failed live-count read leaves a count-free confirm that still deletes', async () => {
		countSeriesOccurrencesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await waitFor(() => {
			expect(countSeriesOccurrencesMock).toHaveBeenCalled();
		});
		const confirm = q(container, 'season-manage-series-delete-confirm-series-1') as HTMLElement;
		const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
		expect(shown).not.toContain('12');
		expect(shown).not.toContain('14');

		await fireEvent.click(confirm);
		await waitFor(() => {
			// #216 — the options object rides on every series delete now.
			expect(deleteEventSeriesMock).toHaveBeenCalledWith(CFG, 'series-1', undefined, {
				onProgress: expect.any(Function)
			});
		});
	});

	it('cancel disarms: the × comes back and nothing was written', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await fireEvent.click(
			q(container, 'season-manage-series-delete-cancel-series-1') as HTMLElement
		);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});

	it('arming a SECOND row disarms the first — only one delete is ever live', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await fireEvent.click(q(container, 'season-manage-series-delete-series-2') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-2')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();
	});

	it('closing the panel (via the title row, #261) disarms — reopening does not present a primed Delete where the row’s × was', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		// #261 — the panel has no internal close; the title row folds it shut.
		await collapseSeasonCard(container);

		await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();
		expect(q(container, 'season-manage-series-delete-series-1')).not.toBeNull();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
	});

	it('the confirm is disabled while its DELETE is in flight — a double-tap cannot fire two', async () => {
		let release: (() => void) | undefined;
		deleteEventSeriesMock.mockImplementation(
			async () =>
				await new Promise<number>((resolve) => {
					release = () => {
						seriesRows = seriesRows.filter((row) => row.id !== 'series-1');
						resolve(9);
					};
				})
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-1')).not.toBeNull();
		});
		const confirm = q(container, 'season-manage-series-delete-confirm-series-1') as HTMLButtonElement;
		await fireEvent.click(confirm);

		await waitFor(() => {
			expect(
				(q(container, 'season-manage-series-delete-confirm-series-1') as HTMLButtonElement)
					.disabled
			).toBe(true);
		});
		// A second tap on the still-mounted confirm writes nothing more.
		await fireEvent.click(
			q(container, 'season-manage-series-delete-confirm-series-1') as HTMLElement
		);
		expect(deleteEventSeriesMock).toHaveBeenCalledTimes(1);

		release?.();
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});
	});
});

// ── #197: failed deletes fail loudly, and the row stays ─────────────────────────

describe('agenda — #197 a FAILED delete surfaces an error and keeps the row', () => {
	it('a rejected deleteEventSeries surfaces season-manage-delete-error (role="alert") and the series row STAYS', async () => {
		deleteEventSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-error')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});

	// #197 review F5 — the ONE shared slot lived under the standalone-EVENTS
	// list, so a failed SERIES delete printed its message below a list that had
	// nothing to do with it. The alert belongs under the list that failed.
	it('the error renders under the list that FAILED — series failure inside the series sub-panel, not the events one', async () => {
		deleteEventSeriesMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const alert = q(container, 'season-manage-delete-error') as HTMLElement;
		const seriesSubPanel = (
			q(container, 'season-manage-series-series-1') as HTMLElement
		).parentElement;
		expect(seriesSubPanel?.contains(alert)).toBe(true);
	});

	it('a 403 gets its own copy — a permission refusal, not a retry prompt', async () => {
		deleteEventSeriesMock.mockRejectedValue(new EntityDeleteForbiddenError('series-1'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const text = q(container, 'season-manage-delete-error')?.textContent ?? '';
		expect(text).toContain('season_manage_delete_forbidden');
		expect(text).not.toContain('season_manage_delete_error');
	});

	it('a cascade that stopped part-way says how many events went and that the series is still there', async () => {
		deleteEventSeriesMock.mockRejectedValue(
			new CascadePartialError('series', 'series-1', 5, 12, new Error('boom'))
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const text = q(container, 'season-manage-delete-error')?.textContent ?? '';
		expect(text).toContain('season_manage_delete_partial');
		expect(text).toContain('5');
		expect(text).toContain('12');
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
	});

	// (#313 — the EVENT-cascade-partial copy lost its panel surface with the
	// standalone-event rows; the event page's own delete carries that story.)

	// A 403 nested inside a cascade failure is still a permission story, however
	// deep it sits (series → occurrence → the occurrence's own child).
	it('a 403 nested two cascades deep still reads as a permission refusal', async () => {
		deleteEventSeriesMock.mockRejectedValue(
			new CascadePartialError(
				'series',
				'series-1',
				0,
				3,
				new CascadePartialError('event', 'occ-1', 0, 1, new EntityDeleteForbiddenError('pi-1'))
			)
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-error')?.textContent ?? '').toContain(
			'season_manage_delete_forbidden'
		);
	});

	it('a SUCCESSFUL delete after a failed one clears the error — the slot is per-attempt, not sticky', async () => {
		deleteEventSeriesMock.mockRejectedValueOnce(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});

		// Second try — this one resolves. A failed delete leaves the row ARMED
		// (nothing was destroyed), so the confirm is right there to re-tap.
		await fireEvent.click(
			q(container, 'season-manage-series-delete-confirm-series-1') as HTMLElement
		);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});
		expect(q(container, 'season-manage-delete-error')).toBeNull();
	});
});

describe('agenda — #313 the panel lists series only; the standalone-event rows are removed', () => {
	it('opening the panel renders the series rows but NO season-manage-event-* node — and never reads the standalone list at all', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		// No row, no convert ⟳, no delete ×/confirm/cancel — the trailing dash
		// keeps `season-manage-events-error` (asserted separately) and
		// `season-manage-add-event` out of the match.
		expect(container.querySelectorAll('[data-testid^="season-manage-event-"]').length).toBe(0);
		// The state and its fetch are gone with the rows, not merely hidden.
		expect(listEventsForSeasonMock).not.toHaveBeenCalled();
		// The standalone list's own error slot went with it.
		expect(q(container, 'season-manage-events-error')).toBeNull();
	});

	it('the removal is surgical: [+ Event], [+ Series] and the series list still stand', async () => {
		const container = await renderReady();
		const panel = await openPanelWithRows(container);

		expect(q(container, 'season-manage-add-event')).not.toBeNull();
		expect(panel.contains(q(container, 'season-manage-add-event'))).toBe(true);
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-1')).not.toBeNull();
		expect(q(container, 'season-manage-series-series-2')).not.toBeNull();
	});
});

type PageOnProgress = (current: number, total: number, kind: string) => void;
interface PageScope {
	series: number;
	events: number;
	repertoireItems: number;
}

/** Tap the season's own trashcan (#261: it lives on the OPENED title row, so
 *  expand the card first), wait for the confirm that replaces it. */
async function armSeasonDelete(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season-confirm')).not.toBeNull();
	});
}

async function armAndConfirmSeasonDelete(container: HTMLElement): Promise<void> {
	await armSeasonDelete(container);
	await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
}

/** deleteSeason mock the tests drive by hand: captures the page's onProgress
 *  sink and resolves only when told to — the ONLY way to observe the counter's
 *  intermediate states from outside. */
function hangingDeleteSeason() {
	let onProgress: PageOnProgress | undefined;
	let resolveWith!: (scope: PageScope) => void;
	let rejectWith!: (reason: unknown) => void;
	deleteSeasonMock.mockImplementation(
		async (_cfg: unknown, _seasonId: string, _impl: unknown, opts?: { onProgress?: PageOnProgress }) => {
			onProgress = opts?.onProgress;
			return await new Promise<PageScope>((res, rej) => {
				resolveWith = res;
				rejectWith = rej;
			});
		}
	);
	return {
		tick: (current: number, total: number, kind: string) => onProgress?.(current, total, kind),
		finish: (scope: PageScope) => resolveWith(scope),
		fail: (reason: unknown) => rejectWith(reason)
	};
}

describe("agenda — #261 the SEASON's delete control lives on the OPENED title row", () => {
	it('editor, card COLLAPSED: NO season-manage-delete-season anywhere — the collapsed face carries no controls beyond the expand target (#261 reverses #236’s collapsed reachability)', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(q(container, 'season-manage-panel'), 'the panel stays closed').toBeNull();
		expect(
			q(container, 'season-manage-delete-season'),
			'#261 — the trashcan is OFF the collapsed face entirely'
		).toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();

		expect(deleteSeasonMock).not.toHaveBeenCalled();
		expect(countSeasonScopeMock).not.toHaveBeenCalled();
	});

	it('editor, panel OPEN: the delete renders on the title row as a real RED-trashcan button with the same accessible name — NOT a descendant of the panel (no <h2> inside the panel either)', async () => {
		const container = await renderReady();
		const panel = await openPanelWithRows(container);

		const btn = q(container, 'season-manage-delete-season') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.tagName).toBe('BUTTON');
		expect(panel.contains(btn), '#261 — title row, never panel internals').toBe(false);
		// The title row is where the collapse control lives — same row.
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		expect(collapse, 'the opened title row exists').not.toBeNull();
		expect(
			btn.parentElement?.contains(collapse),
			'#261 — the delete sits ON the title row, beside the name'
		).toBe(true);
		// #217 review F3 — the name comes from the SEASON's own key, not the
		// event row's. #261 keeps testid AND aria-label byte-identical.
		const label = btn.getAttribute('aria-label') ?? '';
		expect(label).toContain('season_manage_season_delete');
		expect(label).toContain('Season 2026');
		// #236 — a red TRASHCAN, not the old ×.
		expect(Array.from(btn.classList), '#236 — red from text-red-700').toContain('text-red-700');
		expect(btn.textContent ?? '', '#236 — the × glyph is retired').not.toContain('×');
		// The panel's own header row stays gone: no <h2> left inside it.
		expect(panel.querySelector('h2'), '#236 — the panel h2 row is deleted').toBeNull();

		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no season delete affordance ANYWHERE on the page (fail-closed — the title row rides the card’s rights gate)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'season-manage-delete-season')).toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
	});
});

describe('agenda — #217 season delete is a TWO-step confirm quoting the LIVE scope', () => {
	it('arming calls countSeasonScope(cfg, seasonId) and the confirm quotes ALL THREE of its numbers; the × is gone while armed; nothing is written', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armSeasonDelete(container);

		expect(q(container, 'season-manage-delete-season')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).not.toBeNull();
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});

		await waitFor(() => {
			const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
			const visible = confirm.textContent ?? '';
			expect(visible).toContain('season_delete_confirm_scope_short');
			expect(visible).toContain('"series":3');
			expect(visible).toContain('"events":21');
			expect(visible).toContain('"repertoire":6');
		});

		// #217 review F2 — and the accessible name still NAMES the season, as
		// every sibling confirm does, on top of the same three numbers.
		const armed = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const label = armed.getAttribute('aria-label') ?? '';
		expect(label).toContain('season_delete_confirm_scope ');
		expect(label).toContain('"name":"Season 2026"');
		expect(label).toContain('"series":3');
		expect(label).toContain('"events":21');
		expect(label).toContain('"repertoire":6');

		expect(deleteSeasonMock).not.toHaveBeenCalled();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
		expect(deleteEventMock).not.toHaveBeenCalled();
	});

	it('cancel disarms: the × comes back and nothing was written', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await armSeasonDelete(container);
		await fireEvent.click(q(container, 'season-manage-delete-season-cancel') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('ONE armed context: arming the season disarms an armed series row, and arming a series row disarms the armed season', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		// Arm a series row first…
		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-1')).not.toBeNull();
		});

		// …then the season: the series confirm dies.
		await armSeasonDelete(container);
		expect(q(container, 'season-manage-series-delete-confirm-series-1')).toBeNull();

		// …and a series row's arming kills the season confirm right back.
		await fireEvent.click(q(container, 'season-manage-series-delete-series-2') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-2')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
	});

	it('a failed scope read leaves a scope-free confirm (the existing name-only copy) that still deletes — a read must never block the delete', async () => {
		countSeasonScopeMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armSeasonDelete(container);
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalled();
		});

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
		// Never a phantom scope: no scoped copy, none of the scope numbers.
		expect(shown).not.toContain('season_delete_confirm_scope');
		expect(shown).toContain('season_manage_delete_confirm');

		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});
	});

	it('a scope read still in flight when the operator switches collective never lands in the NEW collective’s confirm', async () => {
		signIn({
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'org-b', name: 'Org B', personId: 'person-p' }
			]
		});

		let landSampledbRead!: (scope: PageScope) => void;
		let reads = 0;
		countSeasonScopeMock.mockImplementation(async () => {
			reads += 1;
			if (reads === 1) {
				return await new Promise<PageScope>((res) => {
					landSampledbRead = res;
				});
			}
			// org-b's OWN read never lands either — so any scope on org-b's
			// confirm could only have come from the collective the operator left.
			return await new Promise<PageScope>(() => {});
		});

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanelWithRows(container);
		await armSeasonDelete(container);
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openPanelWithRows(container);
		await armSeasonDelete(container);
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledTimes(2);
		});

		landSampledbRead({ series: 3, events: 21, repertoireItems: 6 });
		await new Promise((r) => setTimeout(r, 0));

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const shown = `${confirm.textContent} ${confirm.getAttribute('aria-label')}`;
		expect(shown).not.toContain('season_delete_confirm_scope');
		expect(shown).not.toContain('"series":3');
		expect(shown).toContain('season_manage_delete_confirm');
	});
});

describe('agenda — #217/#216/#236 ONE progress counter at CARD level, for BOTH cascades', () => {
	it('the season confirm calls deleteSeason(cfg, seasonId, undefined, {onProgress}); the counter renders role="status" at card level and shows the exact "Kustutan X / Y…" texts in sequence, then disappears', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await openPanelWithRows(container);

		// Not mounted before the cascade starts.
		expect(q(container, 'season-manage-delete-progress')).toBeNull();

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});

		run.tick(3, 7, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});
		const progress = q(container, 'season-manage-delete-progress') as HTMLElement;
		// The series_create_progress idiom, verbatim: role="status" so AT hears
		// each update without focus theft.
		expect(progress.getAttribute('role')).toBe('status');
		expect(progress.textContent?.trim()).toBe('Kustutan 3 / 7…');
		const card = q(container, 'agenda-admin-card') as HTMLElement;
		expect(card.contains(progress), '#236 — the counter renders at card level').toBe(true);
		expect(
			(q(container, 'season-manage-panel') as HTMLElement).contains(progress),
			'#236 — no longer inside the panel'
		).toBe(false);

		// The counter FOLLOWS the cascade — next tick, next number, same element.
		run.tick(7, 7, 'repertoire');
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-progress') as HTMLElement).textContent?.trim()
			).toBe('Kustutan 7 / 7…');
		});

		// …and it does not outlive the cascade.
		run.finish({ series: 2, events: 4, repertoireItems: 1 });
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
	});

	it('the season confirm is disabled while the cascade runs — a double-tap cannot fire two cascades', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-season-confirm') as HTMLButtonElement).disabled
			).toBe(true);
		});
		await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
		expect(deleteSeasonMock).toHaveBeenCalledTimes(1);

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
	});

	it('#216 — a SERIES delete drives the SAME counter through its own onProgress ticks', async () => {
		let seriesProgress: PageOnProgress | undefined;
		let finishSeries!: (deleted: number) => void;
		deleteEventSeriesMock.mockImplementation(
			async (
				_cfg: unknown,
				seriesId: string,
				_impl: unknown,
				opts?: { onProgress?: PageOnProgress }
			) => {
				seriesProgress = opts?.onProgress;
				return await new Promise<number>((res) => {
					finishSeries = (deleted: number) => {
						seriesRows = seriesRows.filter((row) => row.id !== seriesId);
						res(deleted);
					};
				});
			}
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmDelete(container, 'series', 'series-1');
		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalledTimes(1);
		});

		seriesProgress?.(1, 13, 'event');
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-progress') as HTMLElement | null)?.textContent?.trim()
			).toBe('Kustutan 1 / 13…');
		});
		expect(
			(q(container, 'season-manage-delete-progress') as HTMLElement).getAttribute('role')
		).toBe('status');

		seriesProgress?.(13, 13, 'series');
		await waitFor(() => {
			expect(
				(q(container, 'season-manage-delete-progress') as HTMLElement).textContent?.trim()
			).toBe('Kustutan 13 / 13…');
		});

		finishSeries(12);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-1')).toBeNull();
		});
	});

	it('a collective switch mid-cascade clears the counter — and a late tick from the abandoned run never resurrects it', async () => {
		signIn({
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'org-b', name: 'Org B', personId: 'person-p' }
			]
		});

		const run = hangingDeleteSeason();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledTimes(1);
		});
		run.tick(2, 9, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});

		// The old run's late tick lands AFTER the switch: still no counter — the
		// stale cascade must not paint over org-b's screen.
		run.tick(3, 9, 'event');
		await new Promise((r) => setTimeout(r, 0));
		expect(q(container, 'season-manage-delete-progress')).toBeNull();
	});

	it('#217 review F3 — a cascade that COMPLETES after the collective switch lands nowhere: no reload of the new collective, no announcement of the old one', async () => {
		signIn({
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'org-b', name: 'Org B', personId: 'person-p' }
			]
		});

		const run = hangingDeleteSeason();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		// org-b's own load has settled; anything past this point would be the
		// abandoned cascade tearing down the screen the operator moved to.
		const loadsAfterSwitch = loadFullAgendaMock.mock.calls.length;

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
		await new Promise((r) => setTimeout(r, 0));

		expect(loadFullAgendaMock.mock.calls.length).toBe(loadsAfterSwitch);
		expect((q(container, 'season-manage-delete-status') as HTMLElement)?.textContent?.trim()).toBe(
			''
		);
	});
});

describe('agenda — #217 a successful season delete closes the panel and announces', () => {
	it('on success: the panel CLOSES, the agenda reloads (recomputing the manageable season — NOT the panel-preserving reload), and the still-mounted status region announces season_delete_success with the season name', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);
		const agendaLoadsBefore = loadFullAgendaMock.mock.calls.length;

		await armAndConfirmSeasonDelete(container);

		// The season is gone, so the panel it managed goes too — this is the
		// plain loadForSelected() reload, not keepSeasonManage: true (a kept
		// panel would be managing a deleted season).
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(agendaLoadsBefore);
		});

		// The announcement must OUTLIVE the panel: a live region that unmounts
		// with the panel announces nothing (WCAG 4.1.3 — the same contract as
		// roster-section-remove-status).
		await waitFor(() => {
			const status = q(container, 'season-manage-delete-status') as HTMLElement | null;
			expect(status).not.toBeNull();
			expect(status?.getAttribute('role')).toBe('status');
			expect(status?.textContent).toContain('season_delete_success');
			expect(status?.textContent).toContain('Season 2026');
		});
	});
});

describe('agenda — #217 a FAILED season cascade lands in the delete-error slot with season copy', () => {
	it('a cascade stopped part-way shows the season branch (season_manage_season_delete_partial with deleted/total) at CARD level (#236 G2); the panel and the season control STAY; the counter is cleared', async () => {
		// The duck-typed tagged shape the write layer rejects with — a plain
		// object, exactly what crosses the vi.mock module boundary.
		deleteSeasonMock.mockRejectedValue({
			code: 'season-cascade-partial',
			seasonId: SEASON_ID,
			deletedCount: 3,
			totalCount: 8,
			failure: new Error('boom')
		});
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const alert = q(container, 'season-manage-delete-error') as HTMLElement;
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('season_manage_season_delete_partial');
		expect(alert.textContent).toContain('3');
		expect(alert.textContent).toContain('8');
		// NOT the series or event partial copy — the operator must hear that the
		// SEASON is still standing.
		expect(alert.textContent).not.toContain('season_manage_delete_partial ');
		expect(alert.textContent).not.toContain('season_manage_event_delete_partial');

		const card = q(container, 'agenda-admin-card') as HTMLElement;
		expect(card.contains(alert), '#236 — season-branch error at card level').toBe(true);
		expect(
			(q(container, 'season-manage-panel') as HTMLElement).contains(alert),
			'#236 — no longer inside the panel'
		).toBe(false);

		// Nothing was torn down, nothing lingers: panel and season control stay,
		// the counter does not.
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-delete-progress')).toBeNull();
		expect(
			q(container, 'season-manage-delete-season-confirm') ??
				q(container, 'season-manage-delete-season')
		).not.toBeNull();
	});

	it('a forbidden season delete reads as the permission copy, not a retry prompt', async () => {
		deleteSeasonMock.mockRejectedValue(new EntityDeleteForbiddenError(SEASON_ID));
		const container = await renderReady();
		await openPanelWithRows(container);

		await armAndConfirmSeasonDelete(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const text = q(container, 'season-manage-delete-error')?.textContent ?? '';
		expect(text).toContain('season_manage_delete_forbidden');
		expect(text).not.toContain('season_manage_delete_error');
	});
});

describe('agenda — #261 the season delete arms on the OPENED row; card-level feedback survives a collapse', () => {
	it('arming on the opened row re-reads the LIVE scope; the armed pair renders ON the title row beside the name; the cascade + card-level counter run, and a MID-CASCADE collapse keeps the counter visible', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();

		await armSeasonDelete(container);
		expect(q(container, 'season-manage-panel'), 'arming happens with the panel open').not.toBeNull();
		await waitFor(() => {
			expect(countSeasonScopeMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});
		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const cancel = q(container, 'season-manage-delete-season-cancel') as HTMLElement;
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		expect(collapse, 'the title row survives arming (never a title-row swap)').not.toBeNull();
		expect(collapse.textContent, 'the season name stays in place').toContain('Season 2026');
		expect(
			(confirm.parentElement as HTMLElement).contains(cancel),
			'the pair renders together on the title row'
		).toBe(true);
		expect(
			(confirm.parentElement as HTMLElement).contains(collapse),
			'…adjacent to the name, on the SAME row'
		).toBe(true);

		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});

		run.tick(2, 5, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});

		// G2 (held through #261): fold the card shut around the running cascade
		// — the SEASON cascade does not block the collapse (only series/convert
		// runs do), and the counter must stay visible at card level.
		await collapseSeasonCard(container);
		const progress = q(container, 'season-manage-delete-progress') as HTMLElement;
		expect(progress, 'the counter survives the collapse').not.toBeNull();
		expect(progress.getAttribute('role')).toBe('status');
		expect(progress.textContent?.trim()).toBe('Kustutan 2 / 5…');
		expect((q(container, 'agenda-admin-card') as HTMLElement).contains(progress)).toBe(true);
		expect(q(container, 'season-manage-panel'), 'collapsed').toBeNull();

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
		// #217's live region is mounted from first render and DELIBERATELY
		// untouched — it announces the success whatever state the card is in.
		await waitFor(() => {
			const status = q(container, 'season-manage-delete-status') as HTMLElement | null;
			expect(status?.textContent).toContain('season_delete_success');
			expect(status?.textContent).toContain('Season 2026');
		});
	});

	it('G2 — a cascade that FAILS after the card was collapsed shows the SEASON error branch at card level: role=alert, visible with the panel closed', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();

		await armSeasonDelete(container);
		await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalled();
		});
		await collapseSeasonCard(container);

		run.fail({
			code: 'season-cascade-partial',
			seasonId: SEASON_ID,
			deletedCount: 2,
			totalCount: 6,
			failure: new Error('boom')
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const alert = q(container, 'season-manage-delete-error') as HTMLElement;
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('season_manage_season_delete_partial');
		expect((q(container, 'agenda-admin-card') as HTMLElement).contains(alert)).toBe(true);
		expect(q(container, 'season-manage-panel'), 'the card stays collapsed').toBeNull();
		expect(q(container, 'season-manage-delete-progress'), 'counter cleared').toBeNull();
	});

	it('G1 — Escape while armed on the opened title row routes through the EXISTING closeSeasonManagePanel(): the panel closes disarmed, nothing deleted, focus lands on the expand control', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		confirm.focus();
		await fireEvent.keyDown(confirm, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'season-manage-panel'), 'one close path: the panel folds').toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
	});

	it('#236 review F3 (held through #261) — Escape on the standalone [+ Season] with nothing open and nothing armed is inert: focus stays put', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, 'season-manage-panel'), 'nothing open').toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm'), 'nothing armed').toBeNull();

		const seasonCreate = q(container, 'season-create') as HTMLButtonElement;
		seasonCreate.focus();
		await fireEvent.keyDown(seasonCreate, { key: 'Escape' });

		// An unguarded Escape catcher used to reach closeSeasonManagePanel()'s
		// focus tail and move focus off the pressed button for no reason.
		expect(document.activeElement).toBe(seasonCreate);
		expect(q(container, 'season-create-form'), 'Escape opened nothing either').toBeNull();
	});

	it('#236 review F4 (held through #261) — the armed pair keeps the 44px touch-target floor (both halves)', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		for (const testid of [
			'season-manage-delete-season-confirm',
			'season-manage-delete-season-cancel'
		]) {
			const btn = q(container, testid) as HTMLElement;
			expect(
				Array.from(btn.classList),
				`${testid} must reserve a 44px-tall touch target (min-h-11)`
			).toContain('min-h-11');
		}
	});
});

describe('#217/#216 — i18n: the season-delete keys exist in en/et/lv/uk', () => {
	type MessageFile = Record<string, string>;
	const NEW_KEYS = [
		'season_delete_confirm_scope',
		'season_delete_confirm_scope_short',
		'season_manage_delete_progress',
		'season_delete_success',
		'season_manage_season_delete',
		'season_manage_season_delete_partial'
	] as const;

	function readLocale(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it('every new key exists non-empty in all four locales, with its placeholders intact', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msgs = readLocale(locale);
			for (const key of NEW_KEYS) {
				expect(msgs[key], `${locale}.json is missing ${key}`).toBeTruthy();
			}
			for (const ph of ['{name}', '{series}', '{events}', '{repertoire}']) {
				expect(msgs.season_delete_confirm_scope, `${locale} confirm scope ${ph}`).toContain(ph);
			}
			// The visible half is name-free (the panel it sits in already names
			// the season) but carries all three numbers.
			for (const ph of ['{series}', '{events}', '{repertoire}']) {
				expect(
					msgs.season_delete_confirm_scope_short,
					`${locale} confirm scope short ${ph}`
				).toContain(ph);
			}
			for (const ph of ['{current}', '{total}']) {
				expect(msgs.season_manage_delete_progress, `${locale} progress ${ph}`).toContain(ph);
			}
			for (const ph of ['{deleted}', '{total}']) {
				expect(msgs.season_manage_season_delete_partial, `${locale} partial ${ph}`).toContain(ph);
			}
			// #217 review F3 — the season ×'s own accessible name, separate from
			// the event row's identically-worded key so a copy edit on one cannot
			// silently retitle the other.
			expect(msgs.season_manage_season_delete, `${locale} season delete label`).toContain('{name}');
		}
	});

	it('the ruled copy is verbatim: et/en progress counter, en confirm scope; the success announcement names the season', () => {
		expect(readLocale('et').season_manage_delete_progress).toBe('Kustutan {current} / {total}…');
		expect(readLocale('en').season_manage_delete_progress).toBe('Deleting {current} / {total}…');
		// #217 review F2 — the two halves speak in their own voices: the
		// aria-label in the siblings' "Confirm deleting {name}…" voice, the
		// visible button in button voice.
		expect(readLocale('en').season_delete_confirm_scope).toBe(
			'Confirm deleting {name} with its {series} series, {events} events and {repertoire} repertoire items'
		);
		expect(readLocale('en').season_delete_confirm_scope_short).toBe(
			'Delete {series} series, {events} events, {repertoire} items?'
		);
		expect(readLocale('en').season_delete_success).toContain('{name}');
		expect(readLocale('et').season_delete_success).toContain('{name}');
		expect(readLocale('lv').season_delete_success).not.toBe(
			readLocale('lv').season_manage_deleted
		);
	});
});

describe('agenda — #237 the series delete triggers render the shared red trashcan (integration: real route)', () => {
	it('EVERY idle series trigger wraps an aria-hidden TrashIcon in the shared red 44px face — no × glyph left', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		for (const testid of [
			'season-manage-series-delete-series-1',
			'season-manage-series-delete-series-2'
		]) {
			const btn = q(container, testid) as HTMLElement;
			expect(btn, `${testid} missing`).not.toBeNull();

			// The shared unit's face: ONE aria-hidden trashcan svg inside the button.
			const svg = btn.querySelector('svg[data-icon="trash"]');
			expect(svg, `${testid}: TrashIcon must render inside the trigger`).not.toBeNull();
			expect(svg?.getAttribute('aria-hidden')).toBe('true');
			// Default icon size (h-5 w-5, the #236 precedent) — these rows host
			// 44px buttons already, so no smaller-icon deviation is warranted here.
			expect(svg?.classList.contains('h-5'), `${testid}: icon default h-5`).toBe(true);
			expect(svg?.classList.contains('w-5'), `${testid}: icon default w-5`).toBe(true);

			// The × is GONE — it reads as a close button, which is the #236 confusion.
			expect(btn.textContent ?? '').not.toMatch(/[×✕]/);

			// Red treatment + 44px BY CONSTRUCTION (the Henry-relayed PO ruling).
			for (const cls of ['text-red-700', 'hover:text-red-800', 'min-h-11', 'min-w-11']) {
				expect(btn.classList.contains(cls), `${testid}: ${cls} missing`).toBe(true);
			}
			// The old muted tone is not merely supplemented — it LEAVES.
			expect(btn.classList.contains('text-ink-2'), `${testid}: muted tone must go`).toBe(false);

			// Accessible name: the SAME glyph-independent key as before the sweep.
			const expectedKey = testid.includes('series-delete')
				? 'season_manage_series_delete'
				: 'season_manage_event_delete';
			expect(btn.getAttribute('aria-label') ?? '').toMatch(new RegExp(`^${expectedKey}`));
		}
	});

	it('the two-step survives the swap: arm → confirm/cancel appear (unchanged testids), cancel restores a trigger that STILL renders the trashcan', async () => {
		const container = await renderReady();
		await openPanelWithRows(container);

		await fireEvent.click(q(container, 'season-manage-series-delete-series-1') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-1')).not.toBeNull();
		});
		expect(q(container, 'season-manage-series-delete-cancel-series-1')).not.toBeNull();
		// Arming wrote nothing (glyph swap must not disturb the write seam).
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();

		await fireEvent.click(q(container, 'season-manage-series-delete-cancel-series-1') as HTMLElement);
		const restored = await waitFor(() => {
			const btn = q(container, 'season-manage-series-delete-series-1');
			expect(btn).not.toBeNull();
			return btn as HTMLElement;
		});
		// The RE-mounted trigger is the shared unit too — not a re-render fallback ×.
		expect(restored.querySelector('svg[data-icon="trash"]')).not.toBeNull();
		expect(deleteEventSeriesMock).not.toHaveBeenCalled();
	});

	it('Table B fence, rendered: the conductor-remove chip in the SAME panel keeps its × and muted tone (unlink is not destroy)', async () => {
		// Give the season a conductor so the chip renders.
		const season = currentSeason(true);
		season.conductors = ['person-c1'];
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({
				seasonId: season.id,
				seasonConductors: season.conductors,
				seasonOwners: season.owners,
				seasonEditors: season.editors,
				seasons: [season]
			})
		);
		const container = await renderReady();
		await openPanelWithRows(container);

		const chip = await waitFor(() => {
			const el = q(container, 'season-manage-conductor-remove-person-c1');
			expect(el, 'conductor chip remove button missing').not.toBeNull();
			return el as HTMLElement;
		});
		expect(chip.querySelector('svg[data-icon="trash"]'), 'a trashcan on an unlink').toBeNull();
		expect(chip.textContent ?? '').toContain('×');
		expect(chip.classList.contains('text-ink-2')).toBe(true);
		expect(chip.classList.contains('text-red-700')).toBe(false);
	});
});

// (*MVOX:Palestrina* — #237 RED: series/event rows join the shared red-trashcan
// unit; two-step + testids + aria-labels byte-preserved; Table B fenced in-panel)
