// @vitest-environment happy-dom
// The season-manage panel: deleting a series or event.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { CascadePartialError, EntityDeleteForbiddenError } from '$lib/seasons/deleteErrors';
import {
	openSeasonCardPanel,
	collapseSeasonCard,
	SEASON_CARD_EXPAND
} from '$lib/testing/seasonCard';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
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
import { cleanupResetSeasonDeleteMocks, currentSeason } from '$lib/testing/pages/seasonPanel';
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
			expect(btn.getAttribute('aria-label') ?? '').toMatch(/^season_manage_series_delete/);
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

// (*MVOX:Palestrina*)
