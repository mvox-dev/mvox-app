// @vitest-environment happy-dom
// #1049: /admin/invite keeps one report per error it shows, under the collective the invite is for.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/invite/inviteData', async () =>
	(await import('$lib/testing/mocks/admin')).inviteDataModule({ errors: true })
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './admin/invite/+page.svelte';
import { authStore } from '$lib/auth/session';
import { clearAll } from '$lib/auth/storage';
import { resetAppState } from '$lib/testing/appReset';
import { deferred } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { createInviteMock, resolveInviteParentMock } from '$lib/testing/mocks/admin';
import { q } from '$lib/testing/pages/dom';
import { signIn } from '$lib/testing/session';

useKeptProblems();

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const A = { db: 'sampledb', name: 'Sampledb', personId: 'admin-p' };
const B = { db: 'ramkoor', name: 'RAM Koor', personId: 'admin-p2' };

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	signIn({ token: 'jwt-admin', collectives: [A, B], selected: A.db });
	resolveInviteParentMock.mockResolvedValue('org-1');
});

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	resetAppState();
});

async function formFor(c: HTMLElement, db: string): Promise<void> {
	await fireEvent.change(q(c, 'invite-db') as HTMLElement, { target: { value: db } });
	await waitFor(() => expect(resolveInviteParentMock).toHaveBeenLastCalledWith(expect.objectContaining({ db })));
	await waitFor(() => expect(q(c, 'invite-email')).not.toBeNull());
}

async function invite(c: HTMLElement): Promise<void> {
	await fireEvent.input(q(c, 'invite-email') as HTMLElement, { target: { value: 'new@x.io' } });
	await fireEvent.click(q(c, 'invite-admin-submit') as HTMLElement);
}

describe('/admin/invite — the errors it shows report (#1049)', () => {
	it('no token on a live session: the load error shows and keeps one report', async () => {
		signIn({ token: 'jwt-admin', collectives: [A], selected: A.db });
		clearAll({ preserveProvider: false });
		const { container } = render(Page);

		await waitFor(() => expect(q(container, 'invite-admin-load-error')).not.toBeNull());
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'admin/invite', action: 'load', detail: 'no auth token in storage on a protected route' }
			])
		);
	});

	it('no token after the session ended: the load error shows and nothing is kept', async () => {
		signIn({ token: 'jwt-admin', collectives: [A], selected: A.db });
		clearAll({ preserveProvider: false });
		authStore.set({ status: 'anonymous' });
		const { container } = render(Page);

		await waitFor(() => expect(q(container, 'invite-admin-load-error')).not.toBeNull());
		await settle();
		expect(await keptProblems(A)).toEqual([]);
	});

	it('a failed create shows its error and keeps one report', async () => {
		createInviteMock.mockRejectedValueOnce(new Error('boom-a'));
		const { container } = render(Page);
		await formFor(container, A.db);

		await invite(container);

		await waitFor(() => expect(q(container, 'invite-admin-error')).not.toBeNull());
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([{ area: 'admin/invite', action: 'creating an invite', detail: 'Error: boom-a' }])
		);
	});

	it('a create for A failing after the form moved to B: kept under A, nothing shown on B', async () => {
		const held = deferred<never>();
		createInviteMock.mockReturnValueOnce(held.promise);
		const { container } = render(Page);
		await formFor(container, A.db);
		await invite(container);
		await waitFor(() => expect(createInviteMock).toHaveBeenCalledWith(expect.objectContaining({ db: A.db }), expect.anything()));

		await formFor(container, B.db);
		held.reject(new Error('boom-a'));
		await settle();

		expect(await keptProblems(A)).toEqual([{ area: 'admin/invite', action: 'creating an invite', detail: 'Error: boom-a' }]);
		expect(await keptProblems(B)).toEqual([]);
		expect(q(container, 'invite-admin-error')).toBeNull();
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});
});

// (*MVOX:Josquin*)
