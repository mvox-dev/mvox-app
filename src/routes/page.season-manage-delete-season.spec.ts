// @vitest-environment happy-dom
// The season-manage panel: deleting the whole season.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
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
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { EntityDeleteForbiddenError } from '$lib/seasons/deleteErrors';
import {
	collapseSeasonCard,
	SEASON_CARD_EXPAND,
	SEASON_CARD_COLLAPSE
} from '$lib/testing/seasonCard';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { signIn } from '$lib/testing/session';
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
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { ORG_EFK } from '$lib/testing/pages/rosterFixtures';
import {
	type PageOnProgress,
	SEASON_ID,
	armSeasonDelete,
	cleanupResetSeasonDeleteMocks,
	currentSeason
} from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/seasonManageRender';
import { armAndConfirmDelete, openPanelWithRows } from '$lib/testing/pages/seasonManageDelete';

// ── fixtures ────────────────────────────────────────────────────────────────────

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

afterEach(cleanupResetSeasonDeleteMocks);

interface PageScope {
	series: number;
	events: number;
	repertoireItems: number;
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

describe('#217/#216 — i18n: the season-delete copy in en/et/lv/uk', () => {
	type MessageFile = Record<string, string>;

	function readLocale(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it('every new key keeps its placeholders in all four locales', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const msgs = readLocale(locale);
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

// (*MVOX:Palestrina*)
