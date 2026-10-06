// @vitest-environment happy-dom
// The agenda's attendance panel load: a fresh roster on every open, and a reported failure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/attendance/attendanceOptimistic', async () =>
	(await import('$lib/testing/mocks/events')).attendanceOptimisticModule()
);

import { createAgendaLoader, createAgendaLoadState, createLoadCounters } from './agendaLoad';
import type { AgendaLoadDeps } from './agendaLoad';
import type { AgendaItem } from './types';
import { attendanceQueueHandlers } from './attendancePanel';
import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
import { attendanceByMemberId } from '$lib/attendance/attendanceData';
import { createWriteTokens } from '$lib/net/writeTokens';
import { setToken } from '$lib/auth/storage';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { applyAttendanceChangeMock } from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { reportProblem } from '$lib/testing/mocks/session';

const ITEM: AgendaItem = {
	id: 'ev1',
	name: 'Tuesday Rehearsal',
	startDatetime: '2026-09-29T17:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
};
const ALICE = { memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'a@example.com' };
const BERTA = { memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'b@example.com' };

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(listAttendance = vi.fn().mockResolvedValue([])) {
	const ag = createAgendaLoadState();
	ag.attendanceEventIds = new Set([ITEM.id]);
	const deps = {
		selected: () => ({ db: 'sampledb', personId: 'person-p' }),
		pendingMembersForEvent: (eventId: string) => queue.pendingMembersForEvent(eventId),
		pendingEntriesForEvent: (eventId: string) => queue.pendingEntriesForEvent(eventId),
		listAttendance,
		listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
		attendanceByMemberId
	} as unknown as AgendaLoadDeps;
	const queue = createAttendanceChangeQueue(
		attendanceQueueHandlers(ag, createWriteTokens(() => 'sampledb'))
	);
	return { ag, queue, loader: createAgendaLoader(ag, createLoadCounters(), deps) };
}

beforeEach(() => setToken('jwt-abc'));

afterEach(() => {
	loadRosterMock.mockReset();
	applyAttendanceChangeMock.mockReset();
	vi.restoreAllMocks();
	resetAppState();
});

describe('agenda attendance panel load', () => {
	it('reads the roster fresh on every open, so a member added minutes ago is markable', async () => {
		const { ag, loader } = setup();
		loadRosterMock.mockResolvedValueOnce({ items: [ALICE], total: 1, truncated: false });
		loader.openAttendancePanel(ITEM);
		await settle();
		expect(ag.attendanceRoster).toEqual([ALICE]);
		loader.closeAttendancePanel();

		loadRosterMock.mockResolvedValueOnce({ items: [ALICE, BERTA], total: 2, truncated: true });
		loader.openAttendancePanel(ITEM);
		await settle();

		expect(loadRosterMock).toHaveBeenCalledTimes(2);
		expect(ag.attendanceRoster).toEqual([ALICE, BERTA]);
		expect(ag.attendanceRosterPartial).toBe(true);
	});

	it('keeps a mark still saving from before a reopen when the server has the old value', async () => {
		const old = { attendanceId: 'att-1', memberId: 'm1', status: 'absent' as const };
		const { ag, queue, loader } = setup(vi.fn().mockResolvedValue([old]));
		loadRosterMock.mockResolvedValue({ items: [ALICE], total: 1, truncated: false });
		applyAttendanceChangeMock.mockReturnValue(new Promise(() => {}));
		loader.openAttendancePanel(ITEM);
		await settle();

		const cfg = testCfg('sampledb', 'jwt-abc');
		queue.request({ cfg, eventId: ITEM.id, memberId: 'm1', existing: old, newStatus: 'present' });
		loader.closeAttendancePanel();
		loader.openAttendancePanel(ITEM);
		await settle();

		expect(ag.attendanceMap).toEqual({ m1: { attendanceId: 'att-1', status: 'present' } });
		expect(ag.attendancePendingMemberIds).toEqual(new Set(['m1']));
	});

	it('keeps a clear still saving from before a reopen when the server has the mark', async () => {
		const marked = { attendanceId: 'att-1', memberId: 'm1', status: 'present' as const };
		const listAttendance = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([marked]);
		const { ag, queue, loader } = setup(listAttendance);
		loadRosterMock.mockResolvedValue({ items: [ALICE], total: 1, truncated: false });
		applyAttendanceChangeMock
			.mockResolvedValueOnce({ attendanceId: 'att-1' })
			.mockReturnValue(new Promise(() => {}));
		loader.openAttendancePanel(ITEM);
		await settle();

		const cfg = testCfg('sampledb', 'jwt-abc');
		queue.request({ cfg, eventId: ITEM.id, memberId: 'm1', existing: null, newStatus: 'present' });
		await settle();
		expect(ag.attendanceMap).toEqual({ m1: { attendanceId: 'att-1', status: 'present' } });
		queue.request({ cfg, eventId: ITEM.id, memberId: 'm1', existing: marked, newStatus: null });
		loader.closeAttendancePanel();
		loader.openAttendancePanel(ITEM);
		await settle();

		expect(ag.attendanceMap).toEqual({});
		expect(ag.attendancePendingMemberIds).toEqual(new Set(['m1']));
	});

	it('reports a failed load', async () => {
		const failure = new Error('read failed');
		const { ag, loader } = setup(vi.fn().mockRejectedValue(failure));
		loadRosterMock.mockResolvedValue({ items: [ALICE], total: 1, truncated: false });
		reportProblem.mockReset();

		loader.openAttendancePanel(ITEM);
		await settle();

		expect(ag.attendanceError).toBe(true);
		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'agenda', action: 'loading the attendance panel', error: failure }]
		]);
	});
});
