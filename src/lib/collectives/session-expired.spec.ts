// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { collectiveState, hydrateCollectives } from './store';
import { checkCollectiveMarker } from './marker';
import { discoverCollectives } from './discover';
import { authStore } from '$lib/auth/session';
import { setToken, getToken } from '$lib/auth/storage';
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { resetAppState } from '$lib/testing/appReset';

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
		personIdByDb: { sampledb: 'p1', ww: 'w1' },
		expMs: Date.now() + 100_000
	});
}

beforeEach(() => {
	install401Recovery();
	resetAppState();
	gotoMock.mockReset();
	history.replaceState({}, '', '/');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	vi.unstubAllGlobals();
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
			await checkCollectiveMarker('sampledb', 'p1', 'jwt-stale');
		} catch (e) {
			caught = e;
		}

		expect(isAuthExpiredError(caught), 'the tag must survive the marker boundary').toBe(true);
	});

	it('discoverCollectives propagates it — a dead token is not a per-db marker failure', async () => {
		stubFetchStatus(401);
		setAuthed();

		await expect(discoverCollectives({ sampledb: 'p1', ww: 'w1' }, 'jwt-stale')).rejects.toSatisfy(
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

		expect(state).toEqual({ status: 'error', erroredDbs: ['sampledb', 'ww'] });
		expect(gotoMock, 'a 500 must not sign the user out').not.toHaveBeenCalled();
		expect(getToken()).toBe('jwt-stale');
	});
});

// (*MVOX:Tallis*)
