// @vitest-environment happy-dom
//
// #107 — auth token expiry recovery on the ROSTER page.
//
// When the roster load fails BECAUSE THE SESSION EXPIRED (Entu 401 → the
// entuFetch layer rejects with an error whose `name === 'AuthExpiredError'` —
// contract in request.auth-expired.spec.ts), the page must render the
// session-expired notice with a sign-in link — NOT the generic "Something went
// wrong loading the roster" + Retry, and NEVER a silent empty state.
//
// INTEGRATION posture (review R2/F4, and the team's "partial assertions hide
// bugs" lesson): this spec used to mock `$lib/roster/rosterData` and hand-throw a
// duck-typed `{ name: 'AuthExpiredError' }`, which proved the page's catch but
// not that a real 401 reaches it with the tag intact. That intermediate link is
// exactly what broke in $lib/collectives/marker.ts, unnoticed. So the REAL
// rosterData / profileData / sectionData and the REAL entuFetch run here; only
// the wire (global fetch) and $app/navigation are stubbed.
//
// Contract pinned:
//   - `data-testid="session-expired"` notice;
//   - `data-testid="session-expired-signin"` <a> with href → `/auth/login`;
//   - `roster-load-error` / `roster-retry-load` / `roster-empty` must NOT render
//     for this failure class.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		roster_title: () => 'Roster',
		roster_no_collective: () => 'Select a collective to view the roster.',
		roster_load_error: () => 'Something went wrong loading the roster.',
		roster_retry: () => 'Retry',
		roster_empty: () => 'No members to show yet.',
		roster_unassigned: () => 'Unassigned',
		roster_column_name: () => 'Name',
		roster_sort_alphabetical: () => 'Sort A–Z',
		roster_sort_grouped: () => 'Group by section',
		roster_sections_load_error: () => 'Section grouping failed to load.',
		session_expired_message: () => 'Your session has expired. Please sign in again.',
		session_expired_signin: () => 'Sign in'
	}
}));

vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

import Page from './roster/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';

// ── The WIRE stub. Everything below runs through the real entuFetch, so routing
// is on the real URL. `profile` is the SECOND hop of loadRoster (one per member,
// inside a Promise.all) — failing it alone is what proves the tag survives the
// intermediate data-layer modules, not just the first call.
type Route = 'member' | 'profile' | 'section' | 'other';

function routeOf(url: string): Route {
	const type = new URL(url).searchParams.get('_type.string') ?? '';
	if (type === 'member') return 'member';
	if (type === 'profile') return 'profile';
	if (type === 'section') return 'section';
	return 'other';
}

const BODIES: Record<Route, unknown> = {
	member: { count: 1, entities: [{ _id: 'm1', person: [{ reference: 'p1' }], _parent: [] }] },
	profile: {
		count: 1,
		entities: [
			{
				_id: 'pr1',
				name: [{ string: 'Ada Lovelace' }],
				email: [{ string: 'ada@example.com' }],
				_sharing: [{ string: 'domain' }]
			}
		]
	},
	section: { count: 0, entities: [] },
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

function expectSessionExpiredNotice(container: HTMLElement) {
	expect(
		container.querySelector('[data-testid="session-expired"]'),
		'session-expired notice must render'
	).not.toBeNull();
	const signin = container.querySelector('[data-testid="session-expired-signin"]');
	expect(signin, 'session-expired notice must carry a sign-in link').not.toBeNull();
	expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

	// Not the misleading generic failure (its Retry can never succeed against a
	// dead token) …
	expect(container.querySelector('[data-testid="roster-load-error"]')).toBeNull();
	expect(container.querySelector('[data-testid="roster-retry-load"]')).toBeNull();
	// … and not a silent "no members" lie either.
	expect(container.querySelector('[data-testid="roster-empty"]')).toBeNull();
}

beforeEach(() => {
	install401Recovery();
	gotoMock.mockReset();
	history.replaceState({}, '', '/roster');
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

describe('/roster — session expired (#107)', () => {
	it('a real Entu 401 shows the session-expired notice with a sign-in link — not the generic load error, never a silent empty state', async () => {
		// A dead token kills every read the page fires.
		stubWire({ member: 401, section: 401 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-skeleton"]')).toBeNull();
		});
		expectSessionExpiredNotice(container);

		// End-to-end: the recovery really fired, not just the copy.
		await waitFor(() => expect(gotoMock).toHaveBeenCalled());
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
	});

	// The link the old mocked posture could not test: the 401 happens on the
	// SECOND hop (per-member profile read, inside loadRoster's Promise.all), so
	// the tag has to survive listMyProfiles -> listProfilesForPerson -> loadRoster
	// before the page ever sees it. Any catch-and-remap in between turns this red.
	it('a 401 on the per-member PROFILE hop still reaches the page tagged — the tag survives the data-layer chain', async () => {
		stubWire({ profile: 401 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		expectSessionExpiredNotice(container);
	});

	it('a GENERIC roster load failure still shows the loud load error + retry (auth handling must not swallow it)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		stubWire({ member: 500 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-retry-load"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
		expect(gotoMock, 'a 500 must not sign the user out').not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis*)
