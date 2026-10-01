// @vitest-environment happy-dom
// The agenda's attendance panel load: a fresh roster on every open, and a logged failure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadRosterMock } = vi.hoisted(() => ({ loadRosterMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { createAgendaLoader, createAgendaLoadState, createLoadCounters } from './agendaLoad';
import type { AgendaLoadDeps } from './agendaLoad';
import type { AgendaItem } from './types';
import { setToken, clearAll } from '$lib/auth/storage';

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
		pendingMembersForEvent: () => new Set<string>(),
		listAttendance,
		listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
		attendanceByMemberId: () => ({})
	} as unknown as AgendaLoadDeps;
	return { ag, loader: createAgendaLoader(ag, createLoadCounters(), deps) };
}

beforeEach(() => setToken('jwt-abc'));

afterEach(() => {
	loadRosterMock.mockReset();
	vi.restoreAllMocks();
	clearAll({ preserveProvider: false });
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

	it('logs a failed load', async () => {
		const failure = new Error('read failed');
		const { ag, loader } = setup(vi.fn().mockRejectedValue(failure));
		loadRosterMock.mockResolvedValue({ items: [ALICE], total: 1, truncated: false });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		loader.openAttendancePanel(ITEM);
		await settle();

		expect(ag.attendanceError).toBe(true);
		expect(errorSpy).toHaveBeenCalledWith('agenda: attendance panel load failed', failure);
	});
});
