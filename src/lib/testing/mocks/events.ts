// Event, attendance and entity-create mocks shared across specs.
import { vi } from 'vitest';

export const loadEventDetailMock = vi.fn();
export const convertEventToSeriesMock = vi.fn();
export const createEventMock = vi.fn();
export const createSeasonMock = vi.fn();
export const createEventSeriesMock = vi.fn();
export const listMyAttendanceMock = vi.fn();
export const createAttendanceMock = vi.fn();
export const updateAttendanceStatusMock = vi.fn();
export const deleteAttendanceMock = vi.fn();
export const applyRsvpChangeMock = vi.fn();
export const applyAttendanceChangeMock = vi.fn();
export const listAttendanceMock = vi.fn();
export const listAllRsvpsForEventMock = vi.fn();

type Real = () => Promise<unknown>;
const real = async (importOriginal: Real) => (await importOriginal()) as object;

export async function eventDetailModule(importOriginal: Real) {
	return {
		...(await real(importOriginal)),
		loadEventDetail: loadEventDetailMock,
		listEventLocations: vi.fn().mockResolvedValue([])
	};
}

export async function eventConvertModule(importOriginal: Real) {
	return { ...(await real(importOriginal)), convertEventToSeries: convertEventToSeriesMock };
}

type Created = 'season' | 'series' | 'event';

// Each create in `wired` is the shared handle; the others are bare vi.fn()s.
export function entityCreateModule(wired: Created[] = ['event']) {
	const pick = (k: Created, mock: ReturnType<typeof vi.fn>) =>
		wired.includes(k) ? mock : vi.fn();
	return {
		createSeason: pick('season', createSeasonMock),
		createEventSeries: pick('series', createEventSeriesMock),
		createEvent: pick('event', createEventMock)
	};
}

export function attendanceOptimisticModule() {
	return { applyAttendanceChange: applyAttendanceChangeMock };
}

// 'rsvps': only listAllRsvpsForEvent; 'both': listAttendance too.
export async function attendanceReadsModule(importOriginal: Real, reads: 'both' | 'rsvps') {
	const lists = reads === 'both' ? { listAttendance: listAttendanceMock } : {};
	return {
		...(await real(importOriginal)),
		...lists,
		listAllRsvpsForEvent: listAllRsvpsForEventMock
	};
}

type AttendanceRecord = { attendanceId: string; memberId: string; status: string };

function byMemberId(records: AttendanceRecord[]) {
	const map: Record<string, { attendanceId: string; status: string }> = {};
	for (const r of records) map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
	return map;
}

// lists/writes: shared handles or bare vi.fn(); mine: listMyAttendance as handle, empty or absent.
export function attendanceHandlesModule(opts: {
	lists: boolean;
	writes: boolean;
	mine: 'handle' | 'empty' | 'none';
}) {
	const h = (on: boolean, mock: ReturnType<typeof vi.fn>) => (on ? mock : vi.fn());
	const mine =
		opts.mine === 'none'
			? {}
			: {
					listMyAttendance:
						opts.mine === 'handle'
							? listMyAttendanceMock
							: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
				};
	return {
		listAttendance: h(opts.lists, listAttendanceMock),
		...mine,
		listAllRsvpsForEvent: h(opts.lists, listAllRsvpsForEventMock),
		createAttendance: h(opts.writes, createAttendanceMock),
		updateAttendanceStatus: h(opts.writes, updateAttendanceStatusMock),
		deleteAttendance: h(opts.writes, deleteAttendanceMock),
		attendanceByMemberId: byMemberId
	};
}

export function rsvpOptimisticModule() {
	return { applyRsvpChange: applyRsvpChangeMock };
}

// Over the real module: the three reads are shared handles, the writes bare vi.fn()s.
export async function attendanceListsOverRealModule(importOriginal: Real) {
	return {
		...(await real(importOriginal)),
		listAttendance: listAttendanceMock,
		listMyAttendance: listMyAttendanceMock,
		listAllRsvpsForEvent: listAllRsvpsForEventMock,
		createAttendance: vi.fn(),
		updateAttendanceStatus: vi.fn(),
		deleteAttendance: vi.fn()
	};
}

// (*MVOX:Josquin*)
