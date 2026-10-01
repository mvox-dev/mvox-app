// @vitest-environment happy-dom
// #550: a profile write with no token sends nothing and expires the session, not load-error.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const h = vi.hoisted(() => ({ listMyProfilesMock: vi.fn(), gotoMock: vi.fn() }));
vi.mock('$lib/profile/profileData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/profile/profileData')>();
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] })
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: h.gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './profile/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import { authStore } from '$lib/auth/session';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';
import { resetGate } from '$lib/profile/completionGate';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { nonGetCalls, settle } from '$lib/testing/networkSignal';

const q = (c: HTMLElement, testid: string) => c.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

let fetchStub: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
	fetchStub = vi.fn<typeof fetch>(async () => new Response('{"entities":[]}', { status: 200 }));
	vi.stubGlobal('fetch', fetchStub);
	install401Recovery();
	h.gotoMock.mockReset();
	h.listMyProfilesMock.mockReset();
	history.replaceState({}, '', '/profile');
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
	resetGate();
	history.replaceState({}, '', '/');
});

describe('#550 — a profile write with no token', () => {
	it('an Enter-save sends nothing and goes to session-expired, not load-error', async () => {
		setToken('jwt-member');
		authStore.set({ status: 'authenticated', personIdByDb: { sampledb: 'person-p' }, expMs: Date.now() + 100_000 });
		collectiveState.set({
			status: 'ready',
			collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('sampledb');
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, 'profile-name-edit')).not.toBeNull());
		await settle();
		clearAll({ preserveProvider: false });
		fetchStub.mockClear();

		await fireEvent.click(q(container, 'profile-name-edit')!);
		await waitFor(() => expect(q(container, 'profile-name')).not.toBeNull());
		const input = q(container, 'profile-name') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Ada L' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => expect(h.gotoMock).toHaveBeenCalledTimes(1));
		expect(String(h.gotoMock.mock.calls[0][0])).toContain('session_expired');
		await settle();
		expect(nonGetCalls(fetchStub)).toEqual([]);
		expect(q(container, 'profile-load-error')).toBeNull();
	});
});

// (*MVOX:Josquin*)
