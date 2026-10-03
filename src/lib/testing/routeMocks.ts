// Navigation/discover mocks; spec and vi.mock factory both import here, so they share one handle.
import { vi } from 'vitest';

export const gotoMock = vi.fn();
export const discoverMock = vi.fn();

export function navigationModule(extra: Record<string, unknown> = {}) {
	return { goto: gotoMock, ...extra };
}

export function discoverModule() {
	return { discoverCollectives: discoverMock };
}

// (*MVOX:Josquin*)
