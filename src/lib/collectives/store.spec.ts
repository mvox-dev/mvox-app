// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock the discovery boundary (severs the entu-config → $env import under happy-dom)
// and $app/navigation (goto can't run outside an app).
const { discoverMock, gotoMock } = vi.hoisted(() => ({ discoverMock: vi.fn(), gotoMock: vi.fn() }));
vi.mock('./discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

import {
	collectiveState,
	urlCollectiveDbStore,
	selectedCollectiveDbStore,
	selectedCollectiveStore,
	selectedDbStore,
	pickerModeStore,
	hydrateCollectives,
	selectCollective
} from './store';
import type { Collective } from './types';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';

const A: Collective = { db: 'polyphony', name: 'Polyphony', personId: 'p1' };
const B: Collective = { db: 'ww', name: 'WW Choir', personId: 'w1' };

function ready(collectives: Collective[]) {
	collectiveState.set({ status: 'ready', collectives, erroredDbs: [] });
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	collectiveState.set({ status: 'loading' });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
	authStore.set({ status: 'loading' });
	discoverMock.mockReset();
	gotoMock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe('selectedCollectiveStore precedence (URL → localStorage → default)', () => {
	it('defaults to the first collective when nothing is chosen', () => {
		ready([A, B]);
		expect(get(selectedCollectiveStore)).toEqual(A);
		expect(get(selectedDbStore)).toBe('polyphony');
	});

	it('honours an explicit persisted pick over the default', () => {
		ready([A, B]);
		selectedCollectiveDbStore.set('ww');
		expect(get(selectedCollectiveStore)).toEqual(B);
	});

	it('URL wins over the persisted pick and writes through to localStorage', () => {
		ready([A, B]);
		selectedCollectiveDbStore.set('ww');
		urlCollectiveDbStore.set('polyphony');
		expect(get(selectedCollectiveStore)).toEqual(A);
		expect(localStorage.getItem('mvox.selected_collective')).toBe('polyphony');
	});

	it('ignores a URL/pick that names an unknown db (falls through to default)', () => {
		ready([A, B]);
		urlCollectiveDbStore.set('nonexistent');
		expect(get(selectedCollectiveStore)).toEqual(A);
	});

	it('resolves to null when state is not ready', () => {
		collectiveState.set({ status: 'none' });
		expect(get(selectedCollectiveStore)).toBeNull();
		expect(get(selectedDbStore)).toBeNull();
	});
});

describe('pickerModeStore (0/1/many)', () => {
	it('none for 0, static for 1, picker for many', () => {
		collectiveState.set({ status: 'none' });
		expect(get(pickerModeStore)).toBe('none');
		ready([A]);
		expect(get(pickerModeStore)).toBe('static');
		ready([A, B]);
		expect(get(pickerModeStore)).toBe('picker');
	});
});

describe('hydrateCollectives', () => {
	function authAs(personIdByDb: Record<string, string>) {
		authStore.set({ status: 'authenticated', personIdByDb, expMs: Date.now() + 1e9 });
		setToken('jwt-abc');
	}

	it('anonymous when not authenticated (never discovers)', async () => {
		const state = await hydrateCollectives();
		expect(state).toEqual({ status: 'anonymous' });
		expect(discoverMock).not.toHaveBeenCalled();
	});

	it('ready when discovery returns collectives', async () => {
		authAs({ polyphony: 'p1' });
		discoverMock.mockResolvedValue({ collectives: [A], erroredDbs: [] });
		const state = await hydrateCollectives();
		expect(state).toEqual({ status: 'ready', collectives: [A], erroredDbs: [] });
		expect(get(collectiveState)).toEqual(state);
	});

	it('none when discovery returns zero collectives and no errors', async () => {
		authAs({ esmuuseum: 'e1' });
		discoverMock.mockResolvedValue({ collectives: [], erroredDbs: [] });
		expect(await hydrateCollectives()).toEqual({ status: 'none' });
	});

	it('error when zero collectives but a check errored', async () => {
		authAs({ polyphony: 'p1' });
		discoverMock.mockResolvedValue({ collectives: [], erroredDbs: ['polyphony'] });
		expect(await hydrateCollectives()).toEqual({ status: 'error', erroredDbs: ['polyphony'] });
	});
});

describe('selectCollective', () => {
	it('persists + reflects the pick in the URL for a known db', async () => {
		ready([A, B]);
		await selectCollective('ww');
		expect(get(selectedCollectiveDbStore)).toBe('ww');
		expect(localStorage.getItem('mvox.selected_collective')).toBe('ww');
		expect(gotoMock).toHaveBeenCalledTimes(1);
		expect(String(gotoMock.mock.calls[0][0])).toContain('collective=ww');
	});

	it('ignores an unknown db (no persist, no navigation)', async () => {
		ready([A, B]);
		await selectCollective('nope');
		expect(get(selectedCollectiveDbStore)).toBeNull();
		expect(gotoMock).not.toHaveBeenCalled();
	});
});
