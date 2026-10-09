// @vitest-environment happy-dom
// The downloads list renders through ListOfStuff, with no filter or view control (#864).
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/auth/storage', () => ({
	getToken: () => 'tok-1',
	setToken: vi.fn(),
	getUser: () => null,
	setUser: vi.fn(),
	getLastProvider: () => null,
	setLastProvider: vi.fn(),
	clearAll: vi.fn()
}));

import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({ labelsFor: async () => new Map() })
}));

import { authStore } from '$lib/auth/session';
import { q } from '$lib/testing/pages/dom';

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-1' },
		expMs: Date.now() + 3_600_000
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('/downloads — list of stuff', () => {
	it('puts a downloaded part inside the list body, with no filter or view slot', async () => {
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-a', {
			bytes: new Uint8Array(8).fill(1).buffer,
			filetype: 'application/pdf',
			sha256: 'sha-1'
		});
		const mod = await import('./downloads/+page.svelte');
		const { container } = render(mod.default);
		await waitFor(() => {
			expect(q(container, 'downloads-part-file-a')).not.toBeNull();
		});

		expect(q(container, 'list-of-stuff-body')!.contains(q(container, 'downloads-part-file-a'))).toBe(true);
		expect(q(container, 'list-of-stuff-filter')).toBeNull();
		expect(q(container, 'list-of-stuff-view')).toBeNull();
	});
});
