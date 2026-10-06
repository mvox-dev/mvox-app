// File, label-store and screenshot mocks shared across specs.
import { vi } from 'vitest';

export const signFileUrlMock = vi.fn();
export const domToBlobMock = vi.fn();

export function fileUrlsModule() {
	return { signFileUrl: signFileUrlMock };
}

export function appLabelStoreModule() {
	return {
		getAppLabelStore: () => ({
			putLabel: async () => {},
			labelsFor: async () => new Map(),
			remove: async () => {}
		})
	};
}

let appByteStore: unknown;

export function setAppByteStore(store: unknown): void {
	appByteStore = store;
}

export function appByteStoreModule() {
	return { getAppByteStore: () => appByteStore };
}

export async function fakeAppByteStoreModule() {
	const store = (await import('$lib/testing/byteStoreFakes')).createFakeByteStore();
	return { getAppByteStore: () => store };
}

export function pdfWorkerUrlModule() {
	return { default: '/mock-pdf-worker.mjs' };
}

export function screenshotModule() {
	return { domToBlob: domToBlobMock };
}

// (*MVOX:Josquin*)
