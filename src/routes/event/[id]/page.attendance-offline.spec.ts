// @vitest-environment happy-dom
// Attendance marking on the event page is gated while offline.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	expectVisibleReason,
	isWriteDisabled
} from '$lib/testing/networkSignal';
import type { EventDetail } from '$lib/events/eventDetail';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

function pastDetail(over: Partial<EventDetail> = {}): EventDetail {
	return {
		id: 'ev1',
		name: 'Tuesday Rehearsal',
		eventType: 'rehearsal',
		startDatetime: isoAt(-1),
		durationMinutes: 90,
		location: '',
		description: '',
		conductorIds: [],
		conductorNames: [],
		capacity: null,
		ownerIds: [],
		editorIds: [],
		seasonId: 'season1',
		seasonOwnerIds: [],
		seasonEditorIds: [],
		seriesId: null,
		inheritedFields: [],
		...over
	};
}

const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

function setAuthed() {
	signIn({ collectives: [{ db: 'sampledb', name: 'sampledb', personId: 'person-p' }] });
}

function setFixtures(
	detail: EventDetail,
	existing: Array<{ attendanceId: string; memberId: string; status: string }> = []
) {
	loadEventDetailMock.mockResolvedValue(detail);
	loadRosterMock.mockResolvedValue({ items: ROSTER, total: ROSTER.length, truncated: false });
	listAttendanceMock.mockResolvedValue(existing);
	listAllRsvpsForEventMock.mockResolvedValue([]);
}

function renderPage() {
	vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	return render(Page);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
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

const REASON = '[write_unavailable_no_signal]';

afterEach(() => {
	resetOnLine();
});

async function openPanelAsEditor() {
	await goOnline();
	applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
	setFixtures(pastDetail({ editorIds: ['person-p'] }));
	const rendered = renderPage();
	const { container } = rendered;
	await waitFor(() => {
		expect(q(container, 'take-attendance-btn')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'take-attendance-btn')!);
	await waitFor(() => {
		expect(q(container, 'attendance-row-m1')).not.toBeNull();
	});
	return { container, fetchStub: globalThis.fetch as unknown as ReturnType<typeof vi.fn> };
}

function toggles(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('[data-testid^="attendance-toggle-"]'));
}

describe('/event/[id] — attendance while offline (#434 slice 6)', () => {
	it('offline: every toggle is write-disabled and the reason is visible in the panel', async () => {
		const { container } = await openPanelAsEditor();
		await goOffline();

		await waitFor(() => {
			expect(toggles(container).length).toBeGreaterThan(0);
			for (const t of toggles(container)) expect(isWriteDisabled(t), t.dataset.testid).toBe(true);
		});
		expectVisibleReason(q(container, 'attendance-panel')!, 'attendance-write-unavailable', REASON);
	});

	it('offline: a toggle click dispatches no write and issues no fetch', async () => {
		const { container, fetchStub } = await openPanelAsEditor();
		await goOffline();
		await settle();
		const callsBefore = fetchStub.mock.calls.length;

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await settle();

		expect(applyAttendanceChangeMock).not.toHaveBeenCalled();
		expect(fetchStub.mock.calls.length).toBe(callsBefore);
	});

	it('back online: toggles enabled, the reason gone, and a click records', async () => {
		const { container } = await openPanelAsEditor();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			for (const t of toggles(container)) expect(isWriteDisabled(t), t.dataset.testid).toBe(false);
		});
		expect(q(container, 'attendance-write-unavailable')).toBeNull();
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
				expect.objectContaining({ eventId: 'ev1', memberId: 'm1', newStatus: 'present' })
			);
		});
	});
});

// (*MVOX:Tallis*)
