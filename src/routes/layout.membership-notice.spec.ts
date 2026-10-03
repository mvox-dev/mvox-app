// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { resolveGateMock, resolveMembershipMock } = vi.hoisted(() => ({
	resolveGateMock: vi.fn(),
	resolveMembershipMock: vi.fn()
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$lib/profile/completionGate', async (importActual) => {
	const actual = await importActual<typeof import('$lib/profile/completionGate')>();
	return { ...actual, resolveGate: resolveGateMock };
});
vi.mock('$lib/collective/membershipStore', async (importActual) => {
	const actual = await importActual<typeof import('$lib/collective/membershipStore')>();
	return { ...actual, resolveMembership: resolveMembershipMock };
});

import Layout from './+layout.svelte';
import { authStore } from '$lib/auth/session';
import { resetGate } from '$lib/profile/completionGate';
import { resetMembership } from '$lib/collective/membershipStore';
import { resetAppState } from '$lib/testing/appReset';
import { SAMPLEDB, signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';

function setAuthedWithOneCollective() {
	discoverMock.mockResolvedValue({ collectives: [SAMPLEDB], erroredDbs: [] });
	signIn();
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	pageStub.url = new URL('http://localhost/');
	resetGate();
	resetMembership();
});

function notice(): HTMLElement | null {
	return document.querySelector('[data-testid="membership-inactive-notice"]');
}

describe('+layout — the deactivated-member notice (done-when 6)', () => {
	it("a resolved 'inactive' membership shows the ONE app-level notice, carrying the collective name (the copy points at the choir, not support)", async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockResolvedValue('inactive');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(notice()).not.toBeNull());
		expect(notice()?.textContent).toContain('Sampledb');
	});

	it('NO redirect: the notice never navigates her anywhere (a redirect is a dead end — refusal accepted)', async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockResolvedValue('inactive');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(notice()).not.toBeNull());
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('NO nav lock: the nav shell still renders alongside the notice (she keeps the domain-readable app)', async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockResolvedValue('inactive');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(notice()).not.toBeNull());
		expect(document.querySelector('nav')).not.toBeNull();
	});

	it("'non-member' (never was one) shows NO notice — the existing zero-code degrade keeps covering strangers", async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockResolvedValue('non-member');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(resolveMembershipMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(notice()).toBeNull();
	});

	it("'active' shows NO notice", async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockResolvedValue('active');
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(resolveMembershipMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(notice()).toBeNull();
	});

	it("TRI-STATE FAIL-SAFE VERBATIM: a FAILED lookup (resolveMembership → 'loading') NEVER shows the notice", async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockResolvedValue('loading'); // the fail-safe answer for any read failure
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(resolveMembershipMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(notice()).toBeNull();
	});

	it('a lookup still in flight shows NO notice (no flash)', async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockReturnValue(new Promise(() => {})); // never resolves
		render(Layout);
		setAuthedWithOneCollective();

		await vi.waitFor(() => expect(resolveMembershipMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(notice()).toBeNull();
	});

	it('an UNAUTHENTICATED visitor never sees the notice and never triggers the lookup', async () => {
		resolveMembershipMock.mockResolvedValue('inactive');
		render(Layout);
		authStore.set({ status: 'anonymous' });

		await new Promise((r) => setTimeout(r, 0));
		expect(notice()).toBeNull();
		expect(resolveMembershipMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
