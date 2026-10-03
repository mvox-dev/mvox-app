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

export function runtimeModule() {
	return {
		getLocale: () => 'en',
		setLocale: vi.fn(),
		locales: ['en', 'et', 'lv', 'uk'],
		overwriteGetLocale: vi.fn()
	};
}

// 'self-editor': editor on an entity whose id is the asking person's own id.
export function repertoireActionsModule(
	actual: unknown,
	rights: 'self-editor' | 'not-editor' = 'self-editor'
) {
	const resolveManageRights =
		rights === 'not-editor'
			? vi.fn().mockResolvedValue('not-editor')
			: vi.fn((...args: unknown[]) => {
					const [, entityId, personId] = args as [unknown, string, string];
					return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
				});
	return { ...(actual as object), resolveManageRights };
}

const emptyList = () => vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false });

export function libraryDataModule() {
	return { listWorks: emptyList(), listAllEditions: emptyList(), listAllCopies: emptyList() };
}

export function rsvpDataModule(memberId: string | null = 'member-1') {
	return {
		findMyMemberId: vi.fn().mockResolvedValue(memberId),
		listMyRsvps: emptyList(),
		rsvpsByEventId: () => ({}),
		createRsvp: vi.fn(),
		updateRsvpStatus: vi.fn(),
		deleteRsvp: vi.fn()
	};
}

export function rsvpViewerModule(actual: unknown) {
	return {
		...(actual as object),
		findMyMemberId: vi.fn().mockResolvedValue('member-viewer'),
		findMyRsvpForEvent: vi.fn().mockResolvedValue(null)
	};
}

// (*MVOX:Josquin*)
