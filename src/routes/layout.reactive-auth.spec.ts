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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { discoverMock, gotoMock } = vi.hoisted(() => ({
	discoverMock: vi.fn(),
	gotoMock: vi.fn()
}));
// Same boundary as store.spec.ts / page.agenda-error.spec.ts: severs
// discover.ts's $env import under happy-dom, and goto can't run outside an app.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// #107 review F1 — entuFetch (imported below to fire a REAL 401) reaches
// $lib/entu-config, which reads $env/dynamic/public: unavailable under
// happy-dom outside a SvelteKit request context.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Layout from './+layout.svelte';
import { entuFetch } from '$lib/entu/request';
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

beforeEach(() => {
	// The layout's completion-gate and admin effects fire entuFetch against the
	// GLOBAL fetch the moment auth resolves. Left unstubbed, happy-dom issues REAL
	// requests to api.entu-test.invalid — which answer 401 and, since #107's recovery, quite
	// correctly tear the session down mid-test. Pin them to a benign 200 so the
	// only 401 in this file is the one a test fires deliberately.
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

	it('an authenticated->anonymous transition (client-side sign-out, no remount) resets collectiveState — not left stale at ready', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
			erroredDbs: []
		});

		render(Layout);
		setAuthedAuthStore();
		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('ready');
		});

		// Client-side sign-out, same component instance — no remount. Without the
		// becameAnonymous edge, collectiveState is stranded stale at 'ready'.
		clearAll({ preserveProvider: true });
		authStore.set({ status: 'anonymous' });

		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('anonymous');
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

describe('+layout — a 401 tears the whole session down, not just localStorage (#107 review F1)', () => {
	it('the signed-in nav disappears and collectiveState resets after an Entu 401 — no reload involved', async () => {
		discoverMock.mockResolvedValue({
			collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p1' }],
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

		// A real 401 through the real entuFetch — the recovery is a client-side
		// `goto`, so NOTHING re-hydrates the layout. Before the fix, clearAll ran
		// but authStore stayed 'authenticated': the full signed-in nav kept
		// rendering (on the sign-in page the user had just been sent to) and the
		// layout's auth-keyed effects kept firing Entu reads with an empty Bearer.
		await entuFetch(
			'polyphony',
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
		// The becameAnonymous edge re-runs hydrateCollectives, which clears the
		// stale 'ready' selection for free.
		await vi.waitFor(() => {
			expect(get(collectiveState).status).toBe('anonymous');
		});
		// (the completion gate may also have fired its own /profile redirect — the
		// session-expired one is the assertion, not the call index)
		expect(gotoMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('session_expired'))).toBe(true);
	});
});

// (*MVOX:Byrd*), #107 review block (*MVOX:Josquin*)
