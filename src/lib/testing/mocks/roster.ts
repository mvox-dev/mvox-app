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

// archived: loadActiveAndArchivedRosters is a shared handle too.
export function memberLifecycleModule(opts: { archived?: boolean } = {}) {
	return {
		deactivateMember: deactivateMemberMock,
		reinstateMember: reinstateMemberMock,
		loadInactiveRoster: loadInactiveRosterMock,
		...(opts.archived ? { loadActiveAndArchivedRosters: loadActiveAndArchivedRostersMock } : {}),
		listInactiveMembers: listInactiveMembersMock,
		listDeactivateBlockers: listDeactivateBlockersMock
	};
}

export async function memberRecordModule(importOriginal: () => Promise<unknown>) {
	return { ...((await importOriginal()) as object), loadMemberRecord: loadMemberRecordMock };
}

// (*MVOX:Josquin*)
