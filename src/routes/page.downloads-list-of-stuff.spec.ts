// @vitest-environment happy-dom
// The downloads list renders through ListOfStuff, with no filter or view control (#864),
// and its title heads the frame in every load state (#869).
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
let labelsFor: () => Promise<Map<string, unknown>>;
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({ labelsFor: () => labelsFor() })
}));

import { authStore } from '$lib/auth/session';
import { q } from '$lib/testing/pages/dom';

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	labelsFor = async () => new Map();
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

	const states: [string, () => Promise<Map<string, unknown>>][] = [
		['downloads-loading', () => new Promise(() => {})],
		['downloads-load-error', async () => Promise.reject(new Error('idb boom'))],
		['downloads-empty', async () => new Map()]
	];
	it.each(states)('%s: one h1, the list title, in the list header', async (shown, labels) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		labelsFor = labels;
		const mod = await import('./downloads/+page.svelte');
		const { container } = render(mod.default);
		await waitFor(() => expect(q(container, shown)).not.toBeNull());

		const titles = [...container.querySelectorAll('h1')];
		expect(titles.map((h1) => h1.textContent?.trim())).toEqual(['[downloads_title]']);
		expect(q(container, 'list-of-stuff-header')?.contains(titles[0])).toBe(true);
	});
});
