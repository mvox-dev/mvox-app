// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Layout from './+layout.svelte';
import { entuFetch } from '$lib/entu/request';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';

function setAuthedAuthStore() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { sampledb: 'p1' }, expMs: Date.now() + 100_000 });
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ entities: [] }), { status: 200 }))
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	discoverMock.mockReset();
	gotoMock.mockReset();
	resetAppState();
});

describe('+layout — reactive collective hydration on auth flip (Fix B, #7)', () => {
	it('resolves collectiveState on the first auth resolution (plain full-page-load path)', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }],
			erroredDbs: []
		});

		render(Layout);
		setAuthedAuthStore();

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});
	});

	it('resolves collectiveState to anonymous on the first auth resolution when signed out', async () => {
		render(Layout);
		authStore.set({ status: 'anonymous' });

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('anonymous');
		});
		expect(discoverMock).not.toHaveBeenCalled();
	});

	it('an auth flip to authenticated AFTER an earlier resolve, with NO remount, still resolves collectiveState (the #7 bug class)', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }],
			erroredDbs: []
		});

		render(Layout);

		authStore.set({ status: 'anonymous' });
		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('anonymous');
		});

		setAuthedAuthStore();

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});
	});

	it('an authenticated->anonymous transition (client-side sign-out, no remount) resets collectiveState — not left stale at ready', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }],
			erroredDbs: []
		});

		render(Layout);
		setAuthedAuthStore();
		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});

		clearAll({ preserveProvider: true });
		authStore.set({ status: 'anonymous' });

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('anonymous');
		});
	});

	it('does not re-fire hydrateCollectives on a repeated authenticated emission (no loop)', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }],
			erroredDbs: []
		});

		render(Layout);
		setAuthedAuthStore();

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});
		expect(discoverMock).toHaveBeenCalledTimes(1);

		authStore.set({ status: 'authenticated', personIdByDb: { sampledb: 'p1' }, expMs: Date.now() + 100_000 });
		await new Promise((r) => setTimeout(r, 0));

		expect(discoverMock).toHaveBeenCalledTimes(1);
	});
});

describe('+layout — a 401 tears the whole session down, not just localStorage (#107 review F1)', () => {
	it('the signed-in nav disappears and collectiveState resets after an Entu 401 — no reload involved', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p1' }],
			erroredDbs: []
		});

		const { container } = render(Layout);
		setAuthedAuthStore();
		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});
		expect(
			container.querySelector('nav[aria-label="Main navigation"]'),
			'the signed-in nav renders while authenticated'
		).not.toBeNull();

		await entuFetch(
			'sampledb',
			'entity?limit=1',
			'jwt-abc',
			{},
			vi.fn().mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch
		).catch(() => {});

		await vi.waitFor(() => {
			expect(get(authStore)).toEqual({ status: 'anonymous' });
		});
		await vi.waitFor(() => {
			expect(
				container.querySelector('nav[aria-label="Main navigation"]'),
				'the signed-in nav must NOT survive a destroyed session'
			).toBeNull();
		});
		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('anonymous');
		});
		expect(gotoMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('session_expired'))).toBe(true);
	});
});

// (*MVOX:Byrd*), #107 review block (*MVOX:Josquin*)
