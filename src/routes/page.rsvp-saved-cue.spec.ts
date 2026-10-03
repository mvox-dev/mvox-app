// @vitest-environment happy-dom
// The RSVP saved cue on the agenda's write path.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { AgendaItem } from '$lib/agenda/types';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (p) => `${(p as { minutes: number }).minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p) => `${(p as { weeks: number }).weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		agenda_view_toggle_label: () => 'Agenda view',
		agenda_view_list: () => 'List',
		agenda_view_month: () => 'Month',
		agenda_filter_empty: () => 'No events match this filter.',
		agenda_row_link_label: (p) => `View details for ${(p as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details',
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'Only members can RSVP.',
		rsvp_save_failed: () => 'Could not save your answer.',
		rsvp_saved: () => 'Saved.'
	})
);

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);
vi.mock('$lib/rsvp/rsvpOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).rsvpOptimisticModule()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule({ lists: 'bare', byMember: 'records' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import { applyRsvpChangeMock } from '$lib/testing/mocks/events';

function agendaEvent(id: string, startDatetime: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

const E1 = agendaEvent('e1', '2026-06-15T09:00:00.000Z');
const E2 = agendaEvent('e2', '2026-06-16T09:00:00.000Z');

function agendaWith(events: AgendaItem[]) {
	return fullAgendaResult({
		seasons: [],
		upcoming: events,
		recent: [],
		seasonId: null,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: []
	});
}

function setAuthed(dbs: Array<{ db: string; name: string }>) {
	signIn({ collectives: dbs.map((d) => ({ db: d.db, name: d.name, personId: 'person-p' })) });
	completionGateStore.set('complete');
}

function row(container: HTMLElement, id: string): HTMLElement | null {
	return container.querySelector(`[data-testid="agenda-row-${id}"]`);
}

function rowSavedText(container: HTMLElement, id: string): string {
	return (
		row(container, id)
			?.querySelector('[data-testid="rsvp-saved-status"]')
			?.textContent?.trim() ?? ''
	);
}

async function waitForEnabledButton(container: HTMLElement, eventId: string, status: string) {
	return waitFor(() => {
		const btn = row(container, eventId)?.querySelector(
			`[data-testid="rsvp-btn-${status}"]`
		) as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.disabled).toBe(false);
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	applyRsvpChangeMock.mockReset();
	discoverMock.mockReset();
	resetAppState();
	resetGate();
});

describe('+page — the saved cue fires on reconcile, per event (#326)', () => {
	it("a successful write puts the saved announcement on THAT row — and the reconciled value stays pressed", async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1, E2]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: 'rsvp-new-1' });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});
		expect(
			row(container, 'e1')
				?.querySelector('[data-testid="rsvp-btn-going"]')
				?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('per-event granularity: the OTHER row shows no saved cue — a cue never claims more than the key that reconciled', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1, E2]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: 'rsvp-new-1' });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		expect(rowSavedText(container, 'e2')).toBe('');
		expect(row(container, 'e2')?.textContent).not.toContain('Saved.');
	});

	it('a successfully CLEARED answer announces saved too — reconciled-null looks exactly like never-answered, the cue is the only distinguisher', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(
			toListRead([{ rsvpId: 'rsvp-77', eventId: 'e1', status: 'going' }])
		);
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: null });
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');
		await waitFor(() => {
			expect(goingBtn.getAttribute('aria-pressed')).toBe('true');
		});

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});
		for (const status of ['going', 'not_going', 'maybe', 'late']) {
			expect(
				row(container, 'e1')
					?.querySelector(`[data-testid="rsvp-btn-${status}"]`)
					?.getAttribute('aria-pressed'),
				`rsvp-btn-${status}`
			).toBe('false');
		}
	});
});

describe('+page — the dangerous pair: pending stays SILENT (byte-preserved), and a new write clears the stale saved cue', () => {
	it('while the write is in flight: aria-busy silent disable, NO saved text, NO other new text (PO ruling byte-preserved)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const held = deferred<{ rsvpId: string }>();
		applyRsvpChangeMock.mockReturnValue(held.promise);
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(
				row(container, 'e1')
					?.querySelector('[data-testid="rsvp-control"]')
					?.getAttribute('aria-busy')
			).toBe('true');
		});
		expect(rowSavedText(container, 'e1')).toBe('');
		expect(
			row(container, 'e1')
				?.querySelector('[data-testid="rsvp-msg-line"]')
				?.textContent?.trim()
		).toBe('');
		held.resolve({ rsvpId: 'rsvp-new-1' });
	});

	it('after a saved cue, STARTING the next write removes it — the cue always describes the LATEST write, never a stale one', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const held = deferred<{ rsvpId: string }>();
		applyRsvpChangeMock
			.mockResolvedValueOnce({ rsvpId: 'rsvp-new-1' })
			.mockReturnValueOnce(held.promise);
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		const maybeBtn = await waitForEnabledButton(container, 'e1', 'maybe');
		await fireEvent.click(maybeBtn);

		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toBe('');
		});
		expect(row(container, 'e1')?.textContent).not.toContain('Saved.');
		held.resolve({ rsvpId: 'rsvp-new-1' });
	});
});

describe('+page — the failure path is byte-preserved, and failure never announces saved', () => {
	it('a rejected write: value reverts + role=alert error, NO saved cue', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockRejectedValue(new Error('save failed'));
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(row(container, 'e1')?.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(row(container, 'e1')?.textContent).toContain('Could not save your answer.');
		expect(
			row(container, 'e1')
				?.querySelector('[data-testid="rsvp-btn-going"]')
				?.getAttribute('aria-pressed')
		).toBe('false');
		expect(rowSavedText(container, 'e1')).toBe('');
		expect(row(container, 'e1')?.textContent).not.toContain('Saved.');
	});

	it('a failure AFTER an earlier saved clears the stale cue — error and saved never show together', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock
			.mockResolvedValueOnce({ rsvpId: 'rsvp-new-1' })
			.mockRejectedValueOnce(new Error('save failed'));
		setAuthed([{ db: 'sampledb', name: 'Sampledb' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		const maybeBtn = await waitForEnabledButton(container, 'e1', 'maybe');
		await fireEvent.click(maybeBtn);

		await waitFor(() => {
			expect(row(container, 'e1')?.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(rowSavedText(container, 'e1')).toBe('');
		expect(row(container, 'e1')?.textContent).not.toContain('Saved.');
	});
});

describe('+page — the saved cue does not leak across a collective switch (#326 pin 7)', () => {
	it("a cue earned in collective A is GONE after switching to B — even on an event with the SAME id", async () => {
		let servedAgenda = agendaWith([E1]);
		loadFullAgendaMock.mockImplementation(() => Promise.resolve(servedAgenda));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: 'rsvp-new-1' });
		setAuthed([
			{ db: 'sampledb', name: 'Sampledb' },
			{ db: 'other-choir', name: 'Other Choir' }
		]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		const callsBefore = loadFullAgendaMock.mock.calls.length;
		servedAgenda = agendaWith([agendaEvent('e1', '2026-07-01T09:00:00.000Z')]);
		selectedCollectiveDbStore.set('other-choir');

		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(callsBefore);
			expect(row(container, 'e1')).not.toBeNull();
			expect(rowSavedText(container, 'e1')).toBe('');
		});
		expect(container.textContent).not.toContain('Saved.');
	});
});

// (*MVOX:Tallis*)
