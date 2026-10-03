// @vitest-environment happy-dom
// The attendance saved cue on the event page's write path.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
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

const {
	gotoMock,
	discoverMock,
	loadEventDetailMock,
	loadRosterMock,
	listAttendanceMock,
	listAllRsvpsForEventMock,
	applyAttendanceChangeMock
} = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	loadEventDetailMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	applyAttendanceChangeMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/events/eventDetail', async (importActual) => ({
	...(await importActual<typeof import('$lib/events/eventDetail')>()),
	loadEventDetail: loadEventDetailMock,
	listEventLocations: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/roster/rosterData', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/rosterData')>()),
	loadRoster: loadRosterMock
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock
}));
vi.mock('$lib/attendance/attendanceOptimistic', () => ({
	applyAttendanceChange: applyAttendanceChangeMock
}));
vi.mock('$lib/rsvp/rsvpData', async (importActual) => ({
	...(await importActual<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: vi.fn().mockResolvedValue('member-viewer'),
	findMyRsvpForEvent: vi.fn().mockResolvedValue(null)
}));
vi.mock('$lib/repertoire/workRows', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));

import Page from './+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import type { EventDetail } from '$lib/events/eventDetail';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

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

const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

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

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function rowSavedText(container: HTMLElement, memberId: string): string {
	return q(container, `attendance-saved-status-${memberId}`)?.textContent?.trim() ?? '';
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

async function flushMicrotasks(times = 6) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadEventDetailMock.mockReset();
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	applyAttendanceChangeMock.mockReset();
	discoverMock.mockReset();
	resetTypeIdCache();
	resetAppState();
});

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
