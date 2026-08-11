// @vitest-environment happy-dom
//
// #107 — the /library session-expired branches.
//
// INTEGRATION posture (review R2/F4, and the team's "partial assertions hide
// bugs" lesson): this spec used to mock `$lib/library/libraryData` and hand-throw
// a duck-typed `{ name: 'AuthExpiredError' }`. That proved "if the data layer
// rejects with the tag, the notice renders" — but NOT "a real Entu 401 reaches
// this catch with the tag intact", which is the link that actually broke in
// $lib/collectives/marker.ts (a data-layer catch that remapped the tag away, with
// no spec to notice).
//
// So the REAL libraryData, the REAL entuFetch and the REAL 401 recovery all run
// here; only the wire (global fetch) and $app/navigation are stubbed. Any future
// catch-and-remap between entuFetch and this page turns red.
//
// Covered:
//   • a 401 on the page-level load  → session-expired notice, not the load error;
//   • a 401 on a NODE EXPAND (review R2/F3) → the page collapses to the same
//     notice instead of leaving a dead per-node "couldn't load" badge in a tree
//     that is about to unmount behind the redirect;
//   • a generic (500) failure still shows the loud load error + retry.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';

// ── The WIRE stub. Every read below goes through the real entuFetch, so routing
// happens on the real URL: `_type.string` selects the collection, and the
// presence of `_parent.reference` distinguishes the per-node expand queries
// (listEditions / listCopies) from the flat librarian-only ones.
type Route = 'work' | 'edition-of-work' | 'copy-of-edition' | 'lending' | 'other';

function routeOf(url: string): Route {
	const q = new URL(url).searchParams;
	const type = q.get('_type.string') ?? '';
	const scoped = q.has('_parent.reference');
	if (type === 'work') return 'work';
	if (type === 'edition') return scoped ? 'edition-of-work' : 'other';
	if (type === 'copy') return scoped ? 'copy-of-edition' : 'other';
	if (type === 'lending') return 'lending';
	return 'other';
}

// One work with one edition — enough tree to expand twice.
const BODIES: Record<Route, unknown> = {
	work: { count: 1, entities: [{ _id: 'w1', name: [{ string: 'Missa' }], composer: [{ string: 'Byrd' }] }] },
	'edition-of-work': { count: 1, entities: [{ _id: 'ed1', name: [{ string: 'Stainer 1922' }] }] },
	'copy-of-edition': { count: 0, entities: [] },
	lending: { count: 0, entities: [] },
	// Everything else (library marker, member, season, type lookups) resolves
	// empty: not-librarian, no member, no current season — the plain member view.
	other: { count: 0, entities: [] }
};

/** `failing` maps a route to the status it should answer with; the rest are 200. */
function stubWire(failing: Partial<Record<Route, number>> = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const route = routeOf(String(input));
			const status = failing[route];
			if (status) return new Response('{}', { status });
			return new Response(JSON.stringify(BODIES[route]), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	install401Recovery();
	gotoMock.mockReset();
	resetTypeIdCache();
	history.replaceState({}, '', '/library');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	history.replaceState({}, '', '/');
});

describe('/library — session expired (#107)', () => {
	it('a real Entu 401 on the page load shows the session-expired notice with a sign-in link — not the generic load error', async () => {
		stubWire({ work: 401, lending: 401 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		const signin = container.querySelector('[data-testid="session-expired-signin"]');
		expect(signin, 'the notice must carry a sign-in link').not.toBeNull();
		expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

		expect(container.querySelector('[data-testid="library-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="library-retry-load"]')).toBeNull();

		// End-to-end: the recovery really fired, not just the copy.
		await waitFor(() => expect(gotoMock).toHaveBeenCalled());
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
	});

	// review R2/F3 — the node-expand handlers used to catch everything and set the
	// per-node 'error' badge, with no isAuthExpiredError check. Expanding a work is
	// a READ, so it gets the same treatment as the page-level load.
	it('a 401 on a NODE EXPAND after a successful load replaces the tree with the notice, not a per-node error badge', async () => {
		stubWire({ 'edition-of-work': 401 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		// Top-level load succeeds first — the tree is on screen.
		const workToggle = await waitFor(() => {
			const el = container.querySelector<HTMLElement>('[data-testid="library-work-toggle-w1"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();

		// Now the token dies under the expand.
		await fireEvent.click(workToggle);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		// The per-node badge (`library_node_load_error` + retry) must be gone with
		// the tree, not left behind inside something about to unmount.
		expect(container.textContent ?? '').not.toContain('library_node_load_error');
		expect(container.querySelector('[data-testid="library-work-toggle-w1"]')).toBeNull();
	});

	it('a GENERIC library load failure still shows the loud load error (auth handling must not swallow it)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		stubWire({ work: 500 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
		expect(gotoMock, 'a 500 must not sign the user out').not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis*)
