// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/collectives/discover', async () => (await import('$lib/testing/routeMocks')).discoverModule());
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$lib/profile/completionGate', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).completionGateModule(importOriginal)
);

import Layout from './+layout.svelte';
import { authStore } from '$lib/auth/session';
import { collectiveState } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { SAMPLEDB, signIn } from '$lib/testing/session';
import { discoverMock, gotoMock } from '$lib/testing/routeMocks';
import { resolveGateMock } from '$lib/testing/mocks/session';

function setAuthedWithOneCollective() {
	discoverMock.mockResolvedValue({ collectives: [SAMPLEDB], erroredDbs: [] });
	signIn();
}

afterEach(() => {
	cleanup();
	discoverMock.mockReset();
	gotoMock.mockReset();
	resolveGateMock.mockReset();
	resetAppState();
	pageStub.url = new URL('http://localhost/');
	resetGate();
});

describe('+layout — completion gate redirect (app-wide enforcement)', () => {
	it('an authenticated member whose domain profile lacks a name is redirected to /profile', async () => {
		resolveGateMock.mockResolvedValue('incomplete');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/profile'));
	});

	it('a member WITH a domain name is NOT redirected', async () => {
		resolveGateMock.mockResolvedValue('complete');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(get(collectiveState).status).toBe('ready'));
		await new Promise((r) => setTimeout(r, 0));
		expect(gotoMock).not.toHaveBeenCalledWith('/profile');
	});

	it('NO FLASH: while the gate read is still in flight the store stays loading and no redirect fires', async () => {
		resolveGateMock.mockReturnValue(new Promise(() => {})); // never resolves
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(get(collectiveState).status).toBe('ready'));
		await new Promise((r) => setTimeout(r, 0));
		expect(get(completionGateStore)).toBe('loading');
		expect(gotoMock).not.toHaveBeenCalledWith('/profile');
	});

	it('LOOP EXEMPTION: an incomplete member already ON /profile is not redirected again', async () => {
		pageStub.url = new URL('http://localhost/profile');
		resolveGateMock.mockResolvedValue('incomplete');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(get(collectiveState).status).toBe('ready'));
		await new Promise((r) => setTimeout(r, 0));
		expect(gotoMock).not.toHaveBeenCalledWith('/profile');
	});

	it('an UNAUTHENTICATED visitor is inert to the gate (unauth is owned by +layout.ts, not this effect)', async () => {
		resolveGateMock.mockResolvedValue('incomplete');
		render(Layout);
		authStore.set({ status: 'anonymous' });

		await new Promise((r) => setTimeout(r, 0));
		expect(gotoMock).not.toHaveBeenCalledWith('/profile');
	});

	it('#800 a gate answer landing after sign-out is dropped: the store stays loading', async () => {
		let answer: (state: 'incomplete') => void = () => {};
		resolveGateMock.mockReturnValue(new Promise((r) => (answer = r)));
		render(Layout);
		setAuthedWithOneCollective();
		await vi.waitFor(() => expect(resolveGateMock).toHaveBeenCalledTimes(1));

		authStore.set({ status: 'anonymous' });
		await new Promise((r) => setTimeout(r, 0));
		answer('incomplete');
		await new Promise((r) => setTimeout(r, 0));

		expect(get(completionGateStore)).toBe('loading');
	});

	it('redirects EXACTLY ONCE for an incomplete member (no redirect loop)', async () => {
		resolveGateMock.mockResolvedValue('incomplete');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/profile'));
		await new Promise((r) => setTimeout(r, 0));
		expect(gotoMock.mock.calls.filter((c) => c[0] === '/profile')).toHaveLength(1);
	});
});

// (*MVOX:Tallis*)
