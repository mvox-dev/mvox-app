// @vitest-environment happy-dom
// The attendance saved cue on the event page's write path.
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/events/eventDetail', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).eventDetailModule(importOriginal)
);
vi.mock('$lib/roster/rosterData', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).rosterOverRealModule(importOriginal)
);
vi.mock('$lib/attendance/attendanceData', async (importOriginal) =>
	(await import('$lib/testing/mocks/events')).attendanceReadsModule(importOriginal, 'both')
);
vi.mock('$lib/attendance/attendanceOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).attendanceOptimisticModule()
);
vi.mock('$lib/rsvp/rsvpData', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).rsvpViewerModule(await importOriginal())
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).databaseEntityModule(await importOriginal())
);

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import type { EventDetail } from '$lib/events/eventDetail';
import { signIn } from '$lib/testing/session';
import {
	applyAttendanceChangeMock,
	listAllRsvpsForEventMock,
	listAttendanceMock,
	loadEventDetailMock
} from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { flushMicrotasks, isoAt } from '$lib/testing/pages/event';
import { ROSTER, resetAttendanceMocks, rowSavedText } from '$lib/testing/pages/eventAttendance';
import { q } from '$lib/testing/pages/dom';

function pastConductedDetail(): EventDetail {
	return {
		id: 'ev1',
		name: 'Tuesday Rehearsal',
		eventType: 'rehearsal',
		startDatetime: isoAt(-1),
		durationMinutes: 90,
		location: '',
		description: '',
		conductorIds: ['person-p'],
		conductorNames: ['Vera Viewer'],
		capacity: null,
		ownerIds: [],
		editorIds: ['person-p'],
		seasonId: 'season1',
		seasonOwnerIds: [],
		seasonEditorIds: [],
		seriesId: null,
		inheritedFields: []
	};
}

function setAuthed(dbs: string[] = ['sampledb']) {
	signIn({ collectives: dbs.map((db) => ({ db, name: db, personId: 'person-p' })) });
}

function setFixtures(
	existing: Array<{ attendanceId: string; memberId: string; status: string }> = []
) {
	loadEventDetailMock.mockResolvedValue(pastConductedDetail());
	loadRosterMock.mockResolvedValue({ items: ROSTER, total: ROSTER.length, truncated: false });
	listAttendanceMock.mockResolvedValue(existing);
	listAllRsvpsForEventMock.mockResolvedValue([]);
}

function renderPage(dbs?: string[]) {
	vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	return render(Page);
}

async function openPanel(container: HTMLElement) {
	await waitFor(() => {
		expect(q(container, 'take-attendance-btn')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'take-attendance-btn')!);
	await waitFor(() => {
		expect(q(container, 'attendance-row-m1')).not.toBeNull();
	});
}

afterEach(resetAttendanceMocks);

describe('/event/[id] — the saved cue fires when the WRITE reconciles (#327)', () => {
	it('merely LOADING recorded attendance announces nothing — the region pre-exists, blank, role="status" aria-live="polite"', async () => {
		setFixtures([{ attendanceId: 'att-1', memberId: 'm1', status: 'present' }]);
		const { container } = renderPage();
		await openPanel(container);

		const region = q(container, 'attendance-saved-status-m1');
		expect(region).not.toBeNull();
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.getAttribute('aria-live')).toBe('polite');
		expect(rowSavedText(container, 'm1')).toBe('');
		expect(container.textContent).not.toContain('[attendance_saved]');
	});

	it("a settled write announces saved on THIS page's panel — on the reconciled member's row and no other", async () => {
		setFixtures();
		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
		const { container } = renderPage();
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('[attendance_saved]');
		});
		expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({ eventId: 'ev1', memberId: 'm1', newStatus: 'present' })
		);
		expect(
			q(container, 'attendance-toggle-m1-present')?.getAttribute('aria-pressed')
		).toBe('true');
		expect(rowSavedText(container, 'm2')).toBe('');
	});

	it('in flight: the PO-ruled SILENT disable is byte-preserved AND the tally line says its counts are unconfirmed', async () => {
		setFixtures([{ attendanceId: 'att-2', memberId: 'm2', status: 'present' }]);
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValue(held.promise);
		const { container } = renderPage();
		await openPanel(container);

		expect(q(container, 'attendance-tally-unconfirmed')).toBeNull();

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(
				q(container, 'attendance-status-group-m1')?.getAttribute('aria-busy')
			).toBe('true');
		});
		for (const status of ['present', 'absent', 'late']) {
			expect(
				q(container, `attendance-toggle-m1-${status}`)?.getAttribute('aria-disabled'),
				`attendance-toggle-m1-${status}`
			).toBe('true');
		}
		expect(rowSavedText(container, 'm1')).toBe('');
		expect(container.textContent).not.toContain('[attendance_saved]');
		const marker = container.querySelector(
			'[data-testid="attendance-tally"] [data-testid="attendance-tally-unconfirmed"]'
		);
		expect(marker).not.toBeNull();
		expect(marker?.textContent).toContain('[attendance_tally_unconfirmed]');

		held.resolve({ attendanceId: 'att-new-1' });
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('[attendance_saved]');
		});
		expect(q(container, 'attendance-tally-unconfirmed')).toBeNull();
	});

	it('failure path byte-preserved: revert + per-row role=alert — and NO saved cue', async () => {
		setFixtures();
		applyAttendanceChangeMock.mockRejectedValue(new Error('save failed'));
		const { container } = renderPage();
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(q(container, 'attendance-save-failed-m1')).not.toBeNull();
		});
		expect(q(container, 'attendance-save-failed-m1')?.getAttribute('role')).toBe('alert');
		expect(
			q(container, 'attendance-toggle-m1-present')?.getAttribute('aria-pressed')
		).toBe('false');
		expect(rowSavedText(container, 'm1')).toBe('');
		expect(container.textContent).not.toContain('[attendance_saved]');
	});
});

describe('/event/[id] — the cue does not leak across a collective switch (#327, hold → switch → settle)', () => {
	it('a write that settles AFTER the switch never paints the saved cue onto the reloaded page', async () => {
		setFixtures();
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValueOnce(held.promise);
		const { container } = renderPage(['sampledb', 'other-choir']);
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(
				q(container, 'attendance-status-group-m1')?.getAttribute('aria-busy')
			).toBe('true');
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
		await openPanel(container);

		held.resolve({ attendanceId: 'att-new-1' });
		await flushMicrotasks();

		expect(rowSavedText(container, 'm1')).toBe('');
		expect(container.textContent).not.toContain('[attendance_saved]');
	});
});

// (*MVOX:Tallis*)
