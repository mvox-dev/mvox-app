// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		roster_title: () => 'Roster',
		roster_no_collective: () => 'Select a collective to view the roster.',
		roster_load_error: () => 'Something went wrong loading the roster.',
		roster_retry: () => 'Retry',
		roster_empty: () => 'No members to show yet.',
		roster_unassigned: () => 'Unassigned',
		roster_column_name: () => 'Name',
		roster_sort_alphabetical: () => 'Sort A–Z',
		roster_sort_grouped: () => 'Group by section',
		roster_sections_load_error: () => 'Section grouping failed to load.',
		session_expired_message: () => 'Your session has expired. Please sign in again.',
		session_expired_signin: () => 'Sign in'
	})
);

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './roster/+page.svelte';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { gotoMock } from '$lib/testing/routeMocks';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { cleanupUnstubResetAuth } from '$lib/testing/pages/dom';

type Route = 'member' | 'profile' | 'section' | 'other';

function routeOf(url: string): Route {
	const type = new URL(url).searchParams.get('_type.string') ?? '';
	if (type === 'member') return 'member';
	if (type === 'profile') return 'profile';
	if (type === 'section') return 'section';
	return 'other';
}

const BODIES: Record<Route, unknown> = {
	member: { count: 1, entities: [{ _id: 'm1', person: [{ reference: 'p1' }], _parent: [] }] },
	profile: {
		count: 1,
		entities: [
			{
				_id: 'pr1',
				name: [{ string: 'Ada Lovelace' }],
				email: [{ string: 'ada@example.com' }],
				_sharing: [{ string: 'domain' }]
			}
		]
	},
	section: { count: 0, entities: [] },
	other: { count: 0, entities: [] }
};

function stubWire(failing: Partial<Record<Route, number>> = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const route = routeOf(String(input));
			const status = failing[route];
			if (status) return new Response('{}', { status });
			return new Response(JSON.stringify(BODIES[route]), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

function expectSessionExpiredNotice(container: HTMLElement) {
	expect(
		container.querySelector('[data-testid="session-expired"]'),
		'session-expired notice must render'
	).not.toBeNull();
	const signin = container.querySelector('[data-testid="session-expired-signin"]');
	expect(signin, 'session-expired notice must carry a sign-in link').not.toBeNull();
	expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

	expect(container.querySelector('[data-testid="roster-load-error"]')).toBeNull();
	expect(container.querySelector('[data-testid="roster-retry-load"]')).toBeNull();
	expect(container.querySelector('[data-testid="roster-empty"]')).toBeNull();
}

beforeEach(() => {
	install401Recovery();
	gotoMock.mockReset();
	history.replaceState({}, '', '/roster');
});

afterEach(cleanupUnstubResetAuth);

describe('/roster — session expired (#107)', () => {
	it('a 401 on the per-member PROFILE hop still reaches the page tagged — the tag survives the data-layer chain', async () => {
		stubWire({ profile: 401 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		expectSessionExpiredNotice(container);
	});
});

// (*MVOX:Tallis*)
