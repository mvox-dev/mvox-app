// @vitest-environment happy-dom
// A stale completion-gate result after a collective switch is dropped, and so is one
// from a page already left (#800).
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/profileCopy')).profileMessages()
);

vi.mock('$lib/profile/profileData', async () =>
	(await import('$lib/testing/mocks/profile')).profileDataModule()
);
vi.mock('$lib/profile/applyProfileSave', async () =>
	(await import('$lib/testing/mocks/profile')).applyProfileSaveModule('bare')
);
vi.mock('$lib/profile/completionGate', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).completionGateModule(importOriginal)
);
vi.mock('$lib/profile/linkedIdentities', async () =>
	(await import('$lib/testing/mocks/profile')).noLinkedIdentitiesModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './profile/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { get } from 'svelte/store';
import { completionGateStore, resetGate, type GateState } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { applyProfileSaveMock } from '$lib/testing/mocks/profile';
import { listMyProfilesMock, resolveGateMock } from '$lib/testing/mocks/session';
import {
	COLLECTIVE_A,
	COLLECTIVE_B,
	displayValue,
	flushMicrotasks,
	openEditor
} from '$lib/testing/pages/profile';

function wireProfilesPerCollective(): void {
	listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'bravura'
			? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' }]
			: [{ _id: 'prof-a-dom', name: 'Ada', email: '', _sharing: 'domain' }]
	);
}

function signInWithTwoCollectives(): void {
	signIn({
		token: 'jwt-member',
		collectives: [COLLECTIVE_A, COLLECTIVE_B],
		selected: 'sampledb'
	});
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

async function waitReadyShowing(container: HTMLElement, name: string): Promise<void> {
	await waitFor(() => {
		expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull();
		expect(displayValue(container, 'name')).toBe(name);
	});
}

async function saveNameToInitiateGateRead(
	container: HTMLElement,
	newName: string,
	expectedCalls: number
): Promise<void> {
	const nameInput = await openEditor(container, 'name');
	await fireEvent.input(nameInput, { target: { value: newName } });
	await fireEvent.blur(nameInput);
	await waitFor(() => expect(resolveGateMock).toHaveBeenCalledTimes(expectedCalls));
}

async function switchCollective(container: HTMLElement, db: string, showsName: string): Promise<void> {
	selectedCollectiveDbStore.set(db);
	await waitReadyShowing(container, showsName);
}

afterEach(() => {
	cleanup();
	listMyProfilesMock.mockReset();
	applyProfileSaveMock.mockReset();
	resolveGateMock.mockReset();
	resetAppState();
	resetGate();
});

describe('#260 — a stale resolveGate settle after a collective switch must not write the SSOT', () => {
	it("THE RACE (deterministic): A's read held → switch to B (gate 'incomplete') → A settles 'complete' → the store stays on B's 'incomplete', never A's stale answer", async () => {
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		expect(resolveGateMock.mock.calls[0][0]).toMatchObject({ db: 'sampledb' });
		expect(resolveGateMock.mock.calls[0][1]).toBe('person-p');

		await switchCollective(container, 'bravura', 'Bea');

		completionGateStore.set('incomplete');

		staleRead.resolve('complete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('incomplete');
	});

	it("variant: with B's own resolve still pending, a stale A settle leaves the store on 'loading' — never A's answer", async () => {
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		await switchCollective(container, 'bravura', 'Bea');

		expect(get(completionGateStore)).toBe('loading');

		staleRead.resolve('complete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('loading');
	});

	it("happy path unchanged: a same-collective settle still lands on the store normally", async () => {
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const read = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(read.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);

		read.resolve('complete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('complete');
	});

	it("rapid A→B→A: only the LAST requested context's result lands — B's late settle from a left context never overwrites it", async () => {
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-x' });
		const readA1 = deferred<GateState>();
		const readB = deferred<GateState>();
		const readA2 = deferred<GateState>();
		resolveGateMock
			.mockReturnValueOnce(readA1.promise)
			.mockReturnValueOnce(readB.promise)
			.mockReturnValueOnce(readA2.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		await switchCollective(container, 'bravura', 'Bea');
		await saveNameToInitiateGateRead(container, 'Bea M.', 2);
		await switchCollective(container, 'sampledb', 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada N.', 3);

		expect(resolveGateMock.mock.calls[0][0]).toMatchObject({ db: 'sampledb' });
		expect(resolveGateMock.mock.calls[1][0]).toMatchObject({ db: 'bravura' });
		expect(resolveGateMock.mock.calls[1][1]).toBe('person-b');
		expect(resolveGateMock.mock.calls[2][0]).toMatchObject({ db: 'sampledb' });

		readA1.resolve('incomplete');
		await flushMicrotasks();
		readA2.resolve('complete');
		await flushMicrotasks();
		expect(get(completionGateStore)).toBe('complete');

		readB.resolve('incomplete');
		await flushMicrotasks();
		expect(get(completionGateStore)).toBe('complete');
	});

	it('a REJECTED stale read after a switch is also ignored: no write, no stale error state from a context the user left', async () => {
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		await switchCollective(container, 'bravura', 'Bea');

		staleRead.reject(new Error('resolveGate: network down'));
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('loading');
		expect(q(container, '[data-testid="profile-load-error"]')).toBeNull();
		expect(displayValue(container, 'name')).toBe('Bea');
	});

	it('write-side guard only: the store still subscribes, sets and resets for consumers', async () => {
		const actual = await vi.importActual<typeof import('$lib/profile/completionGate')>(
			'$lib/profile/completionGate'
		);
		const seen: GateState[] = [];
		const unsubscribe = actual.completionGateStore.subscribe((s) => seen.push(s));
		actual.completionGateStore.set('complete');
		unsubscribe();
		expect(seen).toEqual(['loading', 'complete']);
		actual.resetGate();
		expect(get(actual.completionGateStore)).toBe('loading');
	});
});

describe('#800 — a gate read settling after /profile unmounts writes nothing', () => {
	it("the left page's late 'incomplete' leaves the next page's 'complete'", async () => {
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const left = deferred<GateState>();
		const next = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(left.promise).mockReturnValueOnce(next.promise);
		signInWithTwoCollectives();

		const first = render(Page);
		await waitReadyShowing(first.container, 'Ada');
		await saveNameToInitiateGateRead(first.container, 'Ada M.', 1);
		cleanup();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada N.', 2);
		next.resolve('complete');
		await waitFor(() => expect(get(completionGateStore)).toBe('complete'));

		left.resolve('incomplete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('complete');
	});

	it("a name saved just before leaving still opens the gate when its answer lands late", async () => {
		wireProfilesPerCollective();
		applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const read = deferred<GateState>();
		resolveGateMock.mockReturnValueOnce(read.promise);
		signInWithTwoCollectives();
		completionGateStore.set('incomplete');

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		cleanup();

		read.resolve('complete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('complete');
	});
});

// (*MVOX:Tallis*)
