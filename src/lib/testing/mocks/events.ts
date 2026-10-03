// Event, attendance and entity-create mocks shared across specs.
import { vi } from 'vitest';

export const loadEventDetailMock = vi.fn();
export const convertEventToSeriesMock = vi.fn();
export const createEventMock = vi.fn();
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

export function entityCreateModule() {
	return { createSeason: vi.fn(), createEventSeries: vi.fn(), createEvent: createEventMock };
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

// (*MVOX:Josquin*)
