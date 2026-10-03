// Roster read mocks; spec and vi.mock factory import here, so they share one loadRosterMock.
import { vi } from 'vitest';

export const loadRosterMock = vi.fn();

export function rosterModule() {
	return { loadRoster: loadRosterMock };
}

export async function rosterOverRealModule(importOriginal: () => Promise<unknown>) {
	return { ...((await importOriginal()) as object), loadRoster: loadRosterMock };
}

// (*MVOX:Josquin*)
