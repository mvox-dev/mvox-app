// @vitest-environment happy-dom
//
// #255 done-when 6 RED — the app-level "your membership is not active" notice,
// enforced in the ONE root layout on the completionGate precedent: the layout
// populates `membershipStore` via the status-UNSCOPED self-lookup
// (resolveMembership — unit-pinned in membershipStore.spec.ts) and renders ONE
// notice for the 'inactive' state. Everything else stays exactly as it is:
//
//   - NO redirect and NO nav lock (both refusals PO-accepted: there is nothing
//     she can do at any destination, and she legitimately keeps domain reads).
//   - TRI-STATE FAIL-SAFE VERBATIM: a FAILED lookup ('loading') must NEVER
//     show the notice — a failed lookup telling an active member she has been
//     removed is the worst available outcome.
//   - 'non-member' shows nothing new — the existing zero-code degrade
//     (rsvp_non_member_hint) keeps covering strangers.
//
// This spec renders the real +layout.svelte and drives the store via a mocked
// resolveMembership (the read/classify logic is unit-tested; here we test only
// the layout's wiring). Template: layout.completion-gate.spec.ts.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { discoverMock, gotoMock, resolveGateMock, resolveMembershipMock } = vi.hoisted(() => ({
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	resolveGateMock: vi.fn(),
	resolveMembershipMock: vi.fn()
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/'), params: {} }));
vi.mock('$app/state', () => ({ page: pageStub }));
// The completion gate must stay quiet in this spec — a 'complete' member.
vi.mock('$lib/profile/completionGate', async (importActual) => {
	const actual = await importActual<typeof import('$lib/profile/completionGate')>();
	return { ...actual, resolveGate: resolveGateMock };
});
// Override ONLY resolveMembership; keep the real store / resetMembership so the
// layout and this spec share the one store instance.
vi.mock('$lib/collective/membershipStore', async (importActual) => {
	const actual = await importActual<typeof import('$lib/collective/membershipStore')>();
	return { ...actual, resolveMembership: resolveMembershipMock };
});

// NO paraglide mock here — the layout renders NavShell, whose nav entries use
// a NAMESPACE import of the compiled messages (entries.ts), which a factory
// mock cannot satisfy for unknown keys. The REAL compiled messages run (same
// posture as layout.completion-gate.spec.ts); the notice assertion pins the
// collective-name PARAM surfacing in the text, not a translated sentence.

import Layout from './+layout.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetGate } from '$lib/profile/completionGate';
import { resetMembership } from '$lib/collective/membershipStore';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
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
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	pageStub.url = new URL('http://localhost/');
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
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
		// The Proxy mock stringifies params — 'Polyphony' appears only if the
		// layout actually passes the collective into the notice copy.
		expect(notice()?.textContent).toContain('Polyphony');
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
