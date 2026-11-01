// @vitest-environment happy-dom
// #1063 (Gama): the landing on `/` has no bottom nav, only its one door; every other page keeps it.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('$lib/profile/completionGate', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).completionGateModule(importOriginal)
);
vi.mock('$lib/collective/membershipStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).membershipModule(importOriginal)
);

import Layout from './+layout.svelte';
import { resetGate } from '$lib/profile/completionGate';
import { resetMembership } from '$lib/collective/membershipStore';
import { resetAppState } from '$lib/testing/appReset';
import { SAMPLEDB, signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';
import { resolveGateMock, resolveMembershipMock } from '$lib/testing/mocks/session';

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	pageStub.url = new URL('http://localhost/');
	resetGate();
	resetMembership();
});

async function navOn(path: string): Promise<Element | null> {
	pageStub.url = new URL(`http://localhost${path}`);
	resolveGateMock.mockResolvedValue('complete');
	resolveMembershipMock.mockResolvedValue('active');
	discoverMock.mockResolvedValue({ collectives: [SAMPLEDB], erroredDbs: [] });
	render(Layout);
	signIn();
	await vi.waitFor(() => expect(document.querySelector('main')).not.toBeNull());
	return document.querySelector('nav[role="navigation"]');
}

describe('#1063 — the bottom nav', () => {
	it('is not on the landing', async () => {
		expect(await navOn('/')).toBeNull();
	});

	it.each(['/agenda', '/library', '/profile'])('stays on %s', async (path) => {
		const nav = await navOn(path);
		expect(nav?.querySelector('a[href="/agenda"]')).not.toBeNull();
	});
});
