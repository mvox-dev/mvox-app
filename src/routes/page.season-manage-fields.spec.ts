// @vitest-environment happy-dom
// The agenda's season-manage panel: season fields edited inline.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/seasons/seasonManage', async () =>
	(await import('$lib/testing/mocks/seasons')).seasonManageWritesModule({ deleteEvent: false })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { loadFullAgendaMock } from '$lib/testing/moduleHandles';
import { updateSeasonFieldMock } from '$lib/testing/mocks/seasons';
import { q } from '$lib/testing/pages/dom';
import { CFG } from '$lib/testing/pages/roster';
import { SEASON_END, SEASON_ID, SEASON_START, isoDate } from '$lib/testing/pages/seasonPanel';
import { agendaResult, currentSeason, openPanel } from '$lib/testing/pages/seasonManage';
import { renderReady } from '$lib/testing/pages/seasonRender';
import { editField, useSeasonManagePage } from '$lib/testing/pages/seasonManagePanel';

useSeasonManagePage();

const DISPLAY_FMT = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'UTC',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

function displayDate(iso: string): string {
	return DISPLAY_FMT.format(new Date(iso));
}

describe('agenda — season fields edit inline (event/[id] per-field pattern)', () => {
	it('name: the panel shows the current name; click-to-edit, Enter-to-save calls updateSeasonField(cfg, seasonId, "name", <value>) ONCE and the display updates IMMEDIATELY — no full agenda refetch', async () => {
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		});

		await editField(container, 'name', 'Autumn splendour');

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledTimes(1);
		});
		expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'name', 'Autumn splendour');

		await waitFor(() => {
			expect(q(container, 'season-manage-name')?.textContent).toContain('Autumn splendour');
		});
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);
	});

	it('Escape in an open name edit cancels ONLY the edit: input closes, old value stays, NO write — and the PANEL survives (Escape layering)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-name') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-name') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Half-typed nonsense' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'season-edit-input-name')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
	});

	it('start date: the edit input is type="date" pre-filled with the current value; saving calls updateSeasonField(cfg, seasonId, "start_date", <iso date>)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-start_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-start_date') as HTMLInputElement;
		expect(input.type).toBe('date');
		expect(input.value).toBe(SEASON_START);

		await fireEvent.input(input, { target: { value: '2026-10-01' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'start_date', '2026-10-01');
		});
	});

	it('end date: same pattern — updateSeasonField(cfg, seasonId, "end_date", <iso date>)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		expect(input.type).toBe('date');
		expect(input.value).toBe(SEASON_END);

		await fireEvent.input(input, { target: { value: '2027-06-30' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'end_date', '2027-06-30');
		});
	});

	it('the dates render as ISO YYYY-MM-DD (#207 rule 7) and each carries its own VISIBLE label', async () => {
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(displayDate(SEASON_START)).toBe(SEASON_START);
		expect(displayDate(SEASON_END)).toBe(SEASON_END);
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe(SEASON_START);
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe(SEASON_END);
		expect(panel.textContent).toContain('season_manage_start_date_label');
		expect(panel.textContent).toContain('season_manage_end_date_label');
	});

	it('DST edge: bounds ON the Tallinn spring-forward/fall-back days render as those exact ISO days', async () => {
		const season = currentSeason(true);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			...agendaResult(),
			seasons: [{ ...season, startDate: '2026-03-29', endDate: '2026-10-25' }]
		}));
		const container = await renderReady();
		await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-manage-start_date')?.textContent?.trim()).toBe('2026-03-29');
		expect(q(container, 'season-manage-end_date')?.textContent?.trim()).toBe('2026-10-25');
	});

	it('a season with NO dates set says so — never a bare pencil, and never "Invalid Date"', async () => {
		const season = currentSeason(true);
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			...agendaResult(),
			seasons: [{ ...season, startDate: '', endDate: '' }]
		}));
		const container = await renderReady();
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(container, 'season-manage-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-manage-start_date')?.textContent).toContain(
			'season_manage_date_unset'
		);
		expect(q(container, 'season-manage-end_date')?.textContent).toContain(
			'season_manage_date_unset'
		);
		expect(panel.textContent).not.toContain('Invalid Date');
		expect(q(container, 'season-edit-btn-start_date')).not.toBeNull();
		expect(q(container, 'season-edit-btn-end_date')).not.toBeNull();
	});

	it('a FAILED save surfaces season-edit-error-name (role="alert") and the display keeps the OLD value — a silently snapped-back edit reads as a bug', async () => {
		updateSeasonFieldMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		await editField(container, 'name', 'Doomed rename');

		await waitFor(() => {
			expect(q(container, 'season-edit-error-name')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-name')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-manage-name')?.textContent).toContain('Season 2026');
		expect(q(container, 'season-manage-name')?.textContent).not.toContain('Doomed rename');
	});

	it('an END date moved BEFORE the start date is refused: no write, the old value stands, and the error names the RANGE (not the generic save failure)', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: isoDate(-90) } }); // before SEASON_START
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-end_date')?.getAttribute('role')).toBe('alert');
		expect(q(container, 'season-edit-error-end_date')?.textContent).toContain(
			'season_date_range_invalid'
		);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-end_date')?.textContent).toContain(displayDate(SEASON_END));
		expect(q(container, 'season-manage-panel')?.textContent).not.toContain(
			displayDate(isoDate(-90))
		);
	});

	it('a START date moved AFTER the end date is refused the same way — the guard reads BOTH bounds', async () => {
		const container = await renderReady();
		await openPanel(container);

		await fireEvent.click(q(container, 'season-edit-btn-start_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-start_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-start_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: isoDate(200) } }); // after SEASON_END
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'season-edit-error-start_date')).not.toBeNull();
		});
		expect(q(container, 'season-edit-error-start_date')?.textContent).toContain(
			'season_date_range_invalid'
		);
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-start_date')?.textContent).toContain(
			displayDate(SEASON_START)
		);
	});

	it('a date edit INSIDE the range still saves, and a save failure still reads as a SAVE error (the two error kinds do not bleed)', async () => {
		updateSeasonFieldMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openPanel(container);

		const valid = isoDate(90); // after SEASON_START — a legitimate extension
		await fireEvent.click(q(container, 'season-edit-btn-end_date') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-edit-input-end_date')).not.toBeNull();
		});
		const input = q(container, 'season-edit-input-end_date') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: valid } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(updateSeasonFieldMock).toHaveBeenCalledWith(CFG, SEASON_ID, 'end_date', valid);
		});
		await waitFor(() => {
			expect(q(container, 'season-edit-error-end_date')?.textContent).toContain(
				'season_manage_save_error'
			);
		});
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
