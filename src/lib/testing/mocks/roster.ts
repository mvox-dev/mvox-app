// Roster read mocks; spec and vi.mock factory import here, so they share one loadRosterMock.
import { vi } from 'vitest';

export const loadRosterMock = vi.fn();
export const listActiveMembersMock = vi.fn();
export const deactivateMemberMock = vi.fn();
export const reinstateMemberMock = vi.fn();
export const loadInactiveRosterMock = vi.fn();
export const loadActiveAndArchivedRostersMock = vi.fn();
export const listInactiveMembersMock = vi.fn();
export const listDeactivateBlockersMock = vi.fn();
export const loadMemberRecordMock = vi.fn();
export const createMemberRecordMock = vi.fn();
export const updateMemberRecordMock = vi.fn();

export function rosterModule() {
	return { loadRoster: loadRosterMock };
}

export async function rosterOverRealModule(importOriginal: () => Promise<unknown>) {
	return { ...((await importOriginal()) as object), loadRoster: loadRosterMock };
}

export function activeMembersModule() {
	return { listActiveMembers: listActiveMembersMock };
}

export function emptyRosterModule() {
	return { loadRoster: vi.fn(async () => ({ items: [], total: 0, truncated: false })) };
}

// archived: loadActiveAndArchivedRosters is a shared handle too; others: 'bare' gives
// the other five fresh vi.fn()s instead of the shared handles.
export function memberLifecycleModule(opts: { archived?: boolean; others?: 'bare' } = {}) {
	const pick = (mock: ReturnType<typeof vi.fn>) => (opts.others === 'bare' ? vi.fn() : mock);
	return {
		deactivateMember: pick(deactivateMemberMock),
		reinstateMember: pick(reinstateMemberMock),
		loadInactiveRoster: pick(loadInactiveRosterMock),
		...(opts.archived ? { loadActiveAndArchivedRosters: loadActiveAndArchivedRostersMock } : {}),
		listInactiveMembers: pick(listInactiveMembersMock),
		listDeactivateBlockers: pick(listDeactivateBlockersMock)
	};
}

// writes: create and update are shared handles too.
export async function memberRecordModule(
	importOriginal: () => Promise<unknown>,
	opts: { writes?: boolean } = {}
) {
	const writes = opts.writes
		? { createMemberRecord: createMemberRecordMock, updateMemberRecord: updateMemberRecordMock }
		: {};
	return {
		...((await importOriginal()) as object),
		loadMemberRecord: loadMemberRecordMock,
		...writes
	};
}

// (*MVOX:Josquin*)
