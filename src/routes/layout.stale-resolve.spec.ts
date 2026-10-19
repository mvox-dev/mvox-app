// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { get } from 'svelte/store';
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
const resolveDbEditRightMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/nav/dbRights', async (importOriginal) => ({
	...((await importOriginal()) as object),
	resolveDbEditRight: resolveDbEditRightMock
}));
vi.mock('$lib/profile/completionGate', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).completionGateModule(importOriginal)
);
vi.mock('$lib/collective/membershipStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).membershipModule(importOriginal)
);

import Layout from './+layout.svelte';
import { dbEditRight, resetDbEditRight } from '$lib/nav/dbRights';
import { membershipStore, resetMembership } from '$lib/collective/membershipStore';
import { resetGate } from '$lib/profile/completionGate';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { SAMPLEDB, signIn } from '$lib/testing/session';
import { discoverMock } from '$lib/testing/routeMocks';
import { resolveGateMock, resolveMembershipMock } from '$lib/testing/mocks/session';

const OTHERDB = { db: 'otherdb', name: 'Otherdb', personId: 'person-o' };

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	pageStub.url = new URL('http://localhost/');
	resetGate();
	resetMembership();
	resetDbEditRight();
});

// Select SAMPLEDB, then OTHERDB, so two loads overlap and the first is stale.
async function switchCollective(started: () => number) {
	discoverMock.mockResolvedValue({ collectives: [SAMPLEDB, OTHERDB], erroredDbs: [] });
	signIn({ collectives: [SAMPLEDB, OTHERDB], selected: SAMPLEDB.db });
	await vi.waitFor(() => expect(started()).toBe(1));
	selectedCollectiveDbStore.set(OTHERDB.db);
	await vi.waitFor(() => expect(started()).toBe(2));
}

describe('+layout — a stale resolve is dropped', () => {
	it('the nav admin state: the older collective answering last does not overwrite the newer', async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveMembershipMock.mockResolvedValue('active');
		const a = deferred<'editor' | 'not-editor'>();
		const b = deferred<'editor' | 'not-editor'>();
		resolveDbEditRightMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
		render(Layout);

		await switchCollective(() => resolveDbEditRightMock.mock.calls.length);
		b.resolve('not-editor');
		await vi.waitFor(() => expect(get(dbEditRight)).toBe('not-editor'));
		a.resolve('editor');
		await new Promise((r) => setTimeout(r, 0));

		expect(get(dbEditRight)).toBe('not-editor');
	});

	it('the membership notice state: the older collective answering last does not overwrite the newer', async () => {
		resolveGateMock.mockResolvedValue('complete');
		resolveDbEditRightMock.mockResolvedValue('not-editor');
		const a = deferred<'active' | 'inactive'>();
		const b = deferred<'active' | 'inactive'>();
		resolveMembershipMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
		render(Layout);

		await switchCollective(() => resolveMembershipMock.mock.calls.length);
		b.resolve('active');
		await vi.waitFor(() => expect(get(membershipStore)).toBe('active'));
		a.resolve('inactive');
		await new Promise((r) => setTimeout(r, 0));

		expect(get(membershipStore)).toBe('active');
	});
});

// (*MVOX:Josquin*)
