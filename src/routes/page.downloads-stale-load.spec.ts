// @vitest-environment happy-dom
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const stores = vi.hoisted(() => ({
	held: new Map<string, (ids: string[]) => void>(),
	reads: 0
}));
vi.mock('$lib/files/appByteStore', () => ({
	getAppByteStore: () => ({
		heldFileIds: ({ db }: { db: string }) =>
			new Promise<string[]>((resolve) => {
				stores.reads++;
				stores.held.set(db, resolve);
			})
	})
}));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({ labelsFor: async () => new Map() })
}));

import { authStore } from '$lib/auth/session';

afterEach(() => {
	cleanup();
	stores.held.clear();
	stores.reads = 0;
	localStorage.clear();
});

describe('/downloads — a stale load is dropped', () => {
	it('an older load that answers last does not replace the newer rows', async () => {
		authStore.set({ status: 'authenticated', personIdByDb: { dba: 'p1' }, expMs: Date.now() + 1e6 });
		const mod = await import('./downloads/+page.svelte');
		const { container } = render(mod.default);
		await waitFor(() => expect(stores.reads).toBe(1));
		const resolveA = stores.held.get('dba')!;

		authStore.set({ status: 'authenticated', personIdByDb: { dbb: 'p2' }, expMs: Date.now() + 1e6 });
		await waitFor(() => expect(stores.reads).toBe(2));
		stores.held.get('dbb')!(['file-b']);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="downloads-part-file-b"]')).not.toBeNull()
		);
		resolveA(['file-a']);
		await new Promise((r) => setTimeout(r, 0));

		expect(container.querySelector('[data-testid="downloads-part-file-a"]')).toBeNull();
		expect(container.querySelector('[data-testid="downloads-part-file-b"]')).not.toBeNull();
	});
});

// (*MVOX:Josquin*)
