// Constant page-import stubs: vi.mock(path, async (io) => (await import(here)).xModule(await io()))
import { vi } from 'vitest';

export function workRowsModule(actual: unknown) {
	return { ...(actual as object), loadWorksByEventId: vi.fn().mockResolvedValue({}) };
}

export function databaseEntityModule(actual: unknown) {
	return { ...(actual as object), resolveDatabaseEntityId: vi.fn().mockResolvedValue(null) };
}

// (*MVOX:Josquin*)
