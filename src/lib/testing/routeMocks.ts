// Navigation, discover and entu-config mocks; spec and factory import here, so they share handles.
import { vi } from 'vitest';

export const gotoMock = vi.fn();
export const discoverMock = vi.fn();

export function navigationModule(extra: Record<string, unknown> = {}) {
	return { goto: gotoMock, ...extra };
}

export function discoverModule() {
	return { discoverCollectives: discoverMock };
}

export function entuConfigModule() {
	return { ENTU_API_BASE: 'https://api.entu-test.invalid/' };
}

// (*MVOX:Josquin*)
