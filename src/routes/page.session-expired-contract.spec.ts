// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/')
}));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import AgendaPage from './+page.svelte';
import AdminPage from './admin/+page.svelte';
import InvitePage from './admin/invite/+page.svelte';
import EventPage from './event/[id]/+page.svelte';
import LibraryPage from './library/+page.svelte';
import LinksPage from './links/+page.svelte';
import ProfilePage from './profile/+page.svelte';
import RosterPage from './roster/+page.svelte';
import { get } from 'svelte/store';
import { authStore } from '$lib/auth/session';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { cleanupUnstubResetAuth, q } from '$lib/testing/pages/dom';
import { gotoMock } from '$lib/testing/routeMocks';
import { pagesReaching } from '$lib/testing/pageReach';
import { signIn } from '$lib/testing/session';

const PAGES: Record<string, { Page: Component; loadError: string; retry: string }> = {
	'/': { Page: AgendaPage, loadError: 'agenda-error', retry: 'agenda-retry' },
	'/admin': { Page: AdminPage, loadError: 'admin-roles-load-error', retry: 'admin-roles-retry-load' },
	'/admin/invite': {
		Page: InvitePage,
		loadError: 'invite-admin-load-error',
		retry: 'invite-admin-retry-load'
	},
	'/event/[id]': { Page: EventPage, loadError: 'event-detail-load-error', retry: 'event-detail-retry' },
	'/library': { Page: LibraryPage, loadError: 'library-load-error', retry: 'library-retry-load' },
	'/links': { Page: LinksPage, loadError: 'links-load-error', retry: 'links-retry-load' },
	'/profile': { Page: ProfilePage, loadError: 'profile-load-error', retry: 'profile-retry-load' },
	'/roster': { Page: RosterPage, loadError: 'roster-load-error', retry: 'roster-retry-load' }
};

function renderWithStatus(route: string, status: number) {
	vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
	pageStub.url = new URL(`http://localhost${route.replace('[id]', 'ev1')}`);
	signIn();
	return render(PAGES[route].Page);
}

beforeEach(() => {
	gotoMock.mockReset();
	resetTypeIdCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	cleanupUnstubResetAuth();
	vi.restoreAllMocks();
	resetGate();
});

describe('every page that renders the session-expired notice', () => {
	it('is every page in the table', () => {
		expect(Object.keys(PAGES).sort()).toEqual(
			pagesReaching('src/lib/components/auth/SessionExpiredNotice.svelte')
		);
	});

	it.each(Object.keys(PAGES))('%s: an Entu 401 shows the notice with a sign-in link, not the load error', async (route) => {
		const { container } = renderWithStatus(route, 401);

		await waitFor(() => expect(q(container, 'session-expired')).not.toBeNull());
		expect(q(container, 'session-expired-signin')?.getAttribute('href') ?? '').toContain('/auth/login');
		expect(q(container, PAGES[route].loadError)).toBeNull();
		expect(q(container, PAGES[route].retry)).toBeNull();
	});

	it.each(Object.keys(PAGES))('%s: an Entu 401 signs out to the session-expired sign-in', async (route) => {
		install401Recovery();
		renderWithStatus(route, 401);

		await waitFor(() => expect(gotoMock).toHaveBeenCalled());
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
		expect(get(authStore)).toEqual({ status: 'anonymous' });
	});

	it.each(Object.keys(PAGES))('%s: a 500 still shows the load error and retry, not the notice', async (route) => {
		install401Recovery();
		const { container } = renderWithStatus(route, 500);

		await waitFor(() => expect(q(container, PAGES[route].loadError)).not.toBeNull());
		expect(q(container, PAGES[route].retry)).not.toBeNull();
		expect(q(container, 'session-expired')).toBeNull();
		expect(gotoMock, 'a 500 must not sign the user out').not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
