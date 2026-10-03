// @vitest-environment happy-dom
// signIn and resetAppState leave the auth and collective stores exactly as the specs expect.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);

import { authStore } from '$lib/auth/session';
import { getToken, setLastProvider, getLastProvider } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	selectedDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetAppState } from './appReset';
import { signIn } from './session';

const NOW = 1_700_000_000_000;

afterEach(() => {
	resetAppState();
	vi.useRealTimers();
});

describe('signIn', () => {
	it('defaults to one sampledb collective, picked by fallback', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		signIn();
		expect(getToken()).toBe('jwt-abc');
		expect(get(authStore)).toEqual({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-p' },
			expMs: NOW + 100_000
		});
		expect(get(collectiveState)).toEqual({
			status: 'ready',
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
			erroredDbs: []
		});
		expect(get(urlCollectiveDbStore)).toBeNull();
		expect(get(selectedCollectiveDbStore)).toBeNull();
		expect(get(selectedDbStore)).toBe('sampledb');
	});

	it('takes the token, collectives, selection and lifetime', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		const collectives = [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		];
		signIn({ token: 'jwt-admin', collectives, selected: 'other-choir', ttlMs: 3_600_000 });
		expect(getToken()).toBe('jwt-admin');
		expect(get(authStore)).toEqual({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-p', 'other-choir': 'person-q' },
			expMs: NOW + 3_600_000
		});
		expect(get(collectiveState)).toEqual({ status: 'ready', collectives, erroredDbs: [] });
		expect(get(selectedCollectiveDbStore)).toBe('other-choir');
	});

});

describe('resetAppState', () => {
	it('drops the session and puts every store back to loading', () => {
		signIn();
		setLastProvider('google');
		urlCollectiveDbStore.set('sampledb');
		selectedCollectiveDbStore.set('sampledb');
		resetAppState();
		expect(getToken()).toBeNull();
		expect(getLastProvider()).toBeNull();
		expect(get(authStore)).toEqual({ status: 'loading' });
		expect(get(collectiveState)).toEqual({ status: 'loading' });
		expect(get(selectedCollectiveDbStore)).toBeNull();
		expect(get(urlCollectiveDbStore)).toBeNull();
	});
});

// (*MVOX:Josquin*)
