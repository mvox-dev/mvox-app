// @vitest-environment happy-dom
// #550: a profile write with no token sends nothing and expires the session, not load-error.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
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
import { clearAll } from '$lib/auth/storage';
import { resetGate } from '$lib/profile/completionGate';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { nonGetCalls, settle } from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';
import { listMyProfilesMock } from '$lib/testing/mocks/session';

const q = (c: HTMLElement, testid: string) => c.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

let fetchStub: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
	fetchStub = vi.fn<typeof fetch>(async () => new Response('{"entities":[]}', { status: 200 }));
	vi.stubGlobal('fetch', fetchStub);
	install401Recovery();
	gotoMock.mockReset();
	listMyProfilesMock.mockReset();
	history.replaceState({}, '', '/profile');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	resetAppState();
	resetGate();
	history.replaceState({}, '', '/');
});

describe('#550 — a profile write with no token', () => {
	it('an Enter-save sends nothing and goes to session-expired, not load-error', async () => {
		signIn({ token: 'jwt-member' });
		listMyProfilesMock.mockResolvedValue([
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

		await waitFor(() => expect(gotoMock).toHaveBeenCalledTimes(1));
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
		await settle();
		expect(nonGetCalls(fetchStub)).toEqual([]);
		expect(q(container, 'profile-load-error')).toBeNull();
	});
});

// (*MVOX:Josquin*)
