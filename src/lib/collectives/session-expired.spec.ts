// @vitest-environment happy-dom
//
// #107 review R2/F2 — a 401 during COLLECTIVE DISCOVERY.
//
// Discovery is the first authenticated Entu call on app load, so it is the
// likeliest place a revoked / IP-mismatched token first shows itself. Bug:
// `checkCollectiveMarker`'s blanket catch mapped the AuthExpiredError to
// `{ kind: 'error' }`, so `discoverCollectives` reported every db as broken and
// `hydrateCollectives` settled at `{ status: 'error', erroredDbs }` — which
// /collectives renders as "Some collectives could not be checked (…). Please
// retry.", exactly the misleading data-error class #107 exists to remove.
//
// It also stuck there: `endSession` inside the 401 handler flips authStore to
// anonymous, and the layout's `becameAnonymous` edge would normally re-hydrate
// into 'anonymous' — but that edge is suppressed by the layout's `hydrating`
// guard, because the very discovery call that 401'd is still in flight.
//
// INTEGRATION posture (the team's "partial assertions hide bugs" lesson): the
// REAL discoverCollectives, the REAL checkCollectiveMarker and the REAL entuFetch
// all run. Only the wire (global fetch) and $app/navigation are stubbed, so this
// proves the tag survives every module boundary between the 401 and the store —
// which is precisely the link that was broken and that no mocked spec noticed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { collectiveState, hydrateCollectives } from './store';
import { checkCollectiveMarker } from './marker';
import { discoverCollectives } from './discover';
import { authStore } from '$lib/auth/session';
import { setToken, getToken, clearAll } from '$lib/auth/storage';
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';

function stubFetchStatus(status: number) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}', { status }))
	);
}

function setAuthed() {
	setToken('jwt-stale');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p1', ww: 'w1' },
		expMs: Date.now() + 100_000
	});
}

beforeEach(() => {
	install401Recovery();
	collectiveState.set({ status: 'loading' });
	authStore.set({ status: 'loading' });
	gotoMock.mockReset();
	history.replaceState({}, '', '/');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	vi.unstubAllGlobals();
	clearAll({ preserveProvider: false });
	localStorage.clear();
	sessionStorage.clear();
	history.replaceState({}, '', '/');
});

describe('collective discovery — 401 (#107 review R2/F2)', () => {
	it('checkCollectiveMarker RE-RAISES an auth-expired rejection instead of mapping it to kind: error', async () => {
		stubFetchStatus(401);
		setAuthed();

		let caught: unknown;
		try {
			await checkCollectiveMarker('polyphony', 'p1', 'jwt-stale');
		} catch (e) {
			caught = e;
		}

		expect(isAuthExpiredError(caught), 'the tag must survive the marker boundary').toBe(true);
	});

	it('discoverCollectives propagates it — a dead token is not a per-db marker failure', async () => {
		stubFetchStatus(401);
		setAuthed();

		await expect(discoverCollectives({ polyphony: 'p1', ww: 'w1' }, 'jwt-stale')).rejects.toSatisfy(
			isAuthExpiredError
		);
	});

	it('hydrateCollectives settles at ANONYMOUS, not error — no "could not be checked" state', async () => {
		stubFetchStatus(401);
		setAuthed();

		const state = await hydrateCollectives();

		expect(state).toEqual({ status: 'anonymous' });
		expect(get(collectiveState)).toEqual({ status: 'anonymous' });
	});

	it('and the session is torn down end-to-end: storage cleared, authStore anonymous, one redirect', async () => {
		stubFetchStatus(401);
		setAuthed();

		await hydrateCollectives();

		expect(getToken()).toBeNull();
		expect(get(authStore)).toEqual({ status: 'anonymous' });
		expect(gotoMock).toHaveBeenCalledTimes(1);
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
	});

	it('REGRESSION: a genuine per-db failure (500) still reports error with the db listed', async () => {
		stubFetchStatus(500);
		setAuthed();

		const state = await hydrateCollectives();

		expect(state).toEqual({ status: 'error', erroredDbs: ['polyphony', 'ww'] });
		expect(gotoMock, 'a 500 must not sign the user out').not.toHaveBeenCalled();
		expect(getToken()).toBe('jwt-stale');
	});
});

// (*MVOX:Tallis*)
