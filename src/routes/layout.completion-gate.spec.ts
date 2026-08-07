// @vitest-environment happy-dom
//
// T4.8/#28 RED — the mandatory-completion gate's APP-WIDE ENFORCEMENT lives in the
// root layout: one read populates `completionGateStore`, one redirect sends an
// incomplete member to /profile (closing home + /admin/invite + /collectives + any
// future roster in a single place). This spec renders the real +layout.svelte and
// drives the gate via a mocked `resolveGate` (the read/classify logic is unit-tested
// in completionGate.spec.ts; here we test only the layout's redirect wiring).
//
// RED: the layout does not yet call resolveGate / redirect, so the load-bearing
// "incomplete member → goto('/profile')" assertions FAIL. Template:
// layout.reactive-auth.spec.ts.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { discoverMock, gotoMock, resolveGateMock } = vi.hoisted(() => ({
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	resolveGateMock: vi.fn()
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Mutable $app/state stub so a test can put the layout on /profile (loop exemption).
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} }));
vi.mock('$app/state', () => ({ page: pageStub }));
// Override ONLY resolveGate; keep the real store / resetGate so the layout and this
// spec share the one store instance.
vi.mock('$lib/profile/completionGate', async (importActual) => {
	const actual = await importActual<typeof import('$lib/profile/completionGate')>();
	return { ...actual, resolveGate: resolveGateMock };
});

import Layout from './+layout.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'person-p' }, expMs: Date.now() + 100_000 });
	discoverMock.mockResolvedValue({
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

afterEach(() => {
	cleanup();
	discoverMock.mockReset();
	gotoMock.mockReset();
	resolveGateMock.mockReset();
	clearAll({ preserveProvider: false });
	pageStub.url = new URL('http://localhost/');
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
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
		// settle any gate effect
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
