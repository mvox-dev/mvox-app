// Admin, librarian, join-state and collective-name mocks shared across specs.
import { vi } from 'vitest';

export const resolveAdminMock = vi.fn();
export const resolveOwnerTierMock = vi.fn();
export const resolveLibrarianMock = vi.fn();
export const listJoinStatesMock = vi.fn();
export const resolveCollectiveNameMarkerMock = vi.fn();
export const updateCollectiveNameMock = vi.fn();

export function adminStoreModule() {
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

// (*MVOX:Josquin*)
