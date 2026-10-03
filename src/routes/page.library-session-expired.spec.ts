// @vitest-environment happy-dom
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './library/+page.svelte';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { setAuthExpiredHandler } from '$lib/entu/request';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

type Route = 'work' | 'edition-of-work' | 'copy-of-edition' | 'lending' | 'other';

function routeOf(url: string): Route {
	const q = new URL(url).searchParams;
	const type = q.get('_type.string') ?? '';
	const scoped = q.has('_parent.reference');
	if (type === 'work') return 'work';
	if (type === 'edition') return scoped ? 'edition-of-work' : 'other';
	if (type === 'copy') return scoped ? 'copy-of-edition' : 'other';
	if (type === 'lending') return 'lending';
	return 'other';
}

const BODIES: Record<Route, unknown> = {
	work: { count: 1, entities: [{ _id: 'w1', name: [{ string: 'Missa' }], composer: [{ string: 'Byrd' }] }] },
	'edition-of-work': { count: 1, entities: [{ _id: 'ed1', name: [{ string: 'Stainer 1922' }] }] },
	'copy-of-edition': { count: 0, entities: [] },
	lending: { count: 0, entities: [] },
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

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	install401Recovery();
	gotoMock.mockReset();
	resetTypeIdCache();
	history.replaceState({}, '', '/library');
});

afterEach(() => {
	setAuthExpiredHandler(null);
	cleanup();
	vi.unstubAllGlobals();
	resetAppState();
	history.replaceState({}, '', '/');
});

describe('/library — session expired (#107)', () => {
	it('a real Entu 401 on the page load shows the session-expired notice with a sign-in link — not the generic load error', async () => {
		stubWire({ work: 401, lending: 401 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		const signin = container.querySelector('[data-testid="session-expired-signin"]');
		expect(signin, 'the notice must carry a sign-in link').not.toBeNull();
		expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

		expect(container.querySelector('[data-testid="library-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="library-retry-load"]')).toBeNull();

		await waitFor(() => expect(gotoMock).toHaveBeenCalled());
		expect(String(gotoMock.mock.calls[0][0])).toContain('session_expired');
	});

	it('a 401 on a NODE EXPAND after a successful load replaces the tree with the notice, not a per-node error badge', async () => {
		stubWire({ 'edition-of-work': 401 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		const workToggle = await waitFor(() => {
			const el = container.querySelector<HTMLElement>('[data-testid="library-work-toggle-w1"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();

		await fireEvent.click(workToggle);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		expect(container.textContent ?? '').not.toContain('library_node_load_error');
		expect(container.querySelector('[data-testid="library-work-toggle-w1"]')).toBeNull();
	});

	it('a GENERIC library load failure still shows the loud load error (auth handling must not swallow it)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		stubWire({ work: 500 });
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
		expect(gotoMock, 'a 500 must not sign the user out').not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis*)
