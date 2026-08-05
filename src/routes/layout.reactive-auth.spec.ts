// @vitest-environment happy-dom
//
// Fix B (#7 defense-in-depth): the root layout used to hydrate collectives ONLY
// in onMount, which doesn't re-run on a client-side auth flip without a
// component remount — exactly the class of bug Fix A closed for the OAuth
// callback path specifically. This spec proves the general case: an
// authStore transition into 'authenticated', with NO remount, resolves
// collectiveState. This is the resilience test class the original 118 green
// tests missed (they never exercised a post-mount auth flip).
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { discoverMock, gotoMock } = vi.hoisted(() => ({
	discoverMock: vi.fn(),
	gotoMock: vi.fn()
}));
// Same boundary as store.spec.ts / page.agenda-error.spec.ts: severs
// discover.ts's $env import under happy-dom, and goto can't run outside an app.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

import Layout from './+layout.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState } from '$lib/collectives/store';

function setAuthedAuthStore() {
	// hydrateCollectives() (called by the layout's reactive effect) checks BOTH
	// authStore.status AND a real token via getToken() — setting authStore alone
	// (without a token in storage) makes it treat the transition as anonymous,
	// same as it would for a genuinely stale/missing token in production.
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'p1' }, expMs: Date.now() + 100_000 });
}

afterEach(() => {
	cleanup();
	discoverMock.mockReset();
	gotoMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('+layout — reactive collective hydration on auth flip (Fix B, #7)', () => {
	it('resolves collectiveState on the first auth resolution (plain full-page-load path)', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
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
			collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
			erroredDbs: []
		});

		render(Layout);

		// First resolution: signed out (mirrors a layout that already mounted and
		// settled before the user completes sign-in elsewhere in the SPA).
		authStore.set({ status: 'anonymous' });
		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('anonymous');
		});

		// Client-side auth flip, same component instance — no remount. This is
		// exactly what a layout-level onMount-only hydrate misses.
		setAuthedAuthStore();

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});
	});

	it('does not re-fire hydrateCollectives on a repeated authenticated emission (no loop)', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
			erroredDbs: []
		});

		render(Layout);
		setAuthedAuthStore();

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});
		expect(discoverMock).toHaveBeenCalledTimes(1);

		// Re-emit the SAME status (e.g. a store notification without a real
		// transition) — must not trigger a second discovery call.
		authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'p1' }, expMs: Date.now() + 100_000 });
		await new Promise((r) => setTimeout(r, 0));

		expect(discoverMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Byrd*)
