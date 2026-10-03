// Admin, librarian, join-state and collective-name mocks shared across specs.
import { vi } from 'vitest';

export const resolveAdminMock = vi.fn();
export const resolveOwnerTierMock = vi.fn();
export const resolveLibrarianMock = vi.fn();
export const listJoinStatesMock = vi.fn();
export const resolveCollectiveNameMarkerMock = vi.fn();
export const updateCollectiveNameMock = vi.fn();
export const listAdminsMock = vi.fn();
export const addAdminMock = vi.fn();
export const removeAdminMock = vi.fn();
export const listLibrariansMock = vi.fn();
export const addLibrarianMock = vi.fn();
export const removeLibrarianMock = vi.fn();
export const resolveParentMock = vi.fn();
export const resolveInviteParentMock = vi.fn();
export const createInviteMock = vi.fn();

// 'admin': only resolveAdmin; 'both': resolveOwnerTier too.
export function adminStoreModule(wired: 'admin' | 'both' = 'both') {
	if (wired === 'admin') return { resolveAdmin: resolveAdminMock };
	return { resolveAdmin: resolveAdminMock, resolveOwnerTier: resolveOwnerTierMock };
}

export function librarianStoreModule() {
	return { resolveLibrarian: resolveLibrarianMock };
}

export function joinStatesModule() {
	return { listJoinStates: listJoinStatesMock };
}

export function collectiveNameModule() {
	return {
		resolveCollectiveNameMarker: resolveCollectiveNameMarkerMock,
		updateCollectiveName: updateCollectiveNameMock
	};
}

const roleHandles = () => ({
	listAdmins: listAdminsMock,
	addAdmin: addAdminMock,
	removeAdmin: removeAdminMock,
	listLibrarians: listLibrariansMock,
	addLibrarian: addLibrarianMock,
	removeLibrarian: removeLibrarianMock
});

export function roleManagementModule() {
	return { fetchRights: vi.fn(), ...roleHandles() };
}

export async function roleManagementOverRealModule(importOriginal: () => Promise<unknown>) {
	return { ...((await importOriginal()) as object), ...roleHandles() };
}

export function inviteDataModule() {
	return {
		resolvePersonParentId: resolveParentMock,
		resolveInviteParentId: resolveInviteParentMock,
		createInvite: createInviteMock
	};
}

export async function inviteDataOverRealModule(importOriginal: () => Promise<unknown>) {
	return {
		...((await importOriginal()) as object),
		resolvePersonParentId: resolveParentMock,
		createInvite: createInviteMock
	};
}

// (*MVOX:Josquin*)
