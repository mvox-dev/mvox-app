// Constant page-import stubs: vi.mock(path, async (io) => (await import(here)).xModule(await io()))
import { vi } from 'vitest';

export function workRowsModule(actual: unknown) {
	return { ...(actual as object), loadWorksByEventId: vi.fn().mockResolvedValue({}) };
}

export function databaseEntityModule(actual: unknown) {
	return { ...(actual as object), resolveDatabaseEntityId: vi.fn().mockResolvedValue(null) };
}

type AttendanceRecord = { attendanceId: string; memberId: string; status: string };

function byMemberId(records: AttendanceRecord[]) {
	const map: Record<string, { attendanceId: string; status: string }> = {};
	for (const r of records) map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
	return map;
}

// lists 'empty' resolves the reads; byMember 'records' keys the records like the real module.
export function attendanceModule(
	opts: { lists?: 'empty' | 'bare'; byMember?: 'empty' | 'records' } = {}
) {
	const read = <T>(value: T) => (opts.lists === 'bare' ? vi.fn() : vi.fn().mockResolvedValue(value));
	return {
		listAttendance: read([]),
		listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
		listAllRsvpsForEvent: read([]),
		createAttendance: vi.fn(),
		updateAttendanceStatus: vi.fn(),
		deleteAttendance: vi.fn(),
		attendanceByMemberId: opts.byMember === 'records' ? byMemberId : () => ({})
	};
}

// (*MVOX:Josquin*)
