// @vitest-environment happy-dom
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk']
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

vi.mock('$lib/loading/routeLoad', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/loading/routeLoad')>();
	return { ...actual, createRouteLoadMachine: vi.fn(actual.createRouteLoadMachine) };
});

import { createRouteLoadMachine } from '$lib/loading/routeLoad';
import ProfilePage from './profile/+page.svelte';
import RosterPage from './roster/+page.svelte';
import LibraryPage from './library/+page.svelte';
import { resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const factorySpy = createRouteLoadMachine as unknown as Mock;

type Route = 'member' | 'profile' | 'section' | 'work' | 'lending' | 'other';

function routeOf(url: string): Route {
	const type = new URL(url).searchParams.get('_type.string') ?? '';
	if (type === 'member') return 'member';
	if (type === 'profile') return 'profile';
	if (type === 'section') return 'section';
	if (type === 'work') return 'work';
	if (type === 'lending') return 'lending';
	return 'other';
}

const BODIES: Record<Route, unknown> = {
	member: { count: 1, entities: [{ _id: 'm1', person: [{ reference: 'person-p' }], _parent: [] }] },
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
	work: { count: 1, entities: [{ _id: 'w1', name: [{ string: 'Missa' }], composer: [{ string: 'Byrd' }] }] },
	lending: { count: 0, entities: [] },
	other: { count: 0, entities: [] }
};

function stubWire() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			return new Response(JSON.stringify(BODIES[routeOf(String(input))]), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

function setAuthedWithOneCollective() {
	signIn();
}

function expectNoFailureBranch(container: HTMLElement, prefix: string) {
	expect(container.querySelector(`[data-testid="${prefix}-load-error"]`)).toBeNull();
	expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
}

beforeEach(() => {
	factorySpy.mockClear();
	resetTypeIdCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	stubWire();
	setAuthedWithOneCollective();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	resetAppState();
	resetGate();
});

describe('#232 — the three primary routes run on the shared route-load machine', () => {
	it('/profile constructs the machine (named for itself) and reaches its ready DOM through it', async () => {
		const { container } = render(ProfilePage);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="profile-field-name"]')).not.toBeNull();
		});
		expectNoFailureBranch(container, 'profile');

		expect(factorySpy).toHaveBeenCalledTimes(1);
		expect(factorySpy.mock.calls[0][0]).toMatchObject({ name: 'profile' });
		expect(typeof factorySpy.mock.calls[0][0].load).toBe('function');
	});

	it('/roster constructs the machine (named for itself) and reaches its ready DOM through it', async () => {
		const { container } = render(RosterPage);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="section-toggle-unassigned"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="section-toggle-unassigned"]') as HTMLElement
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-row-name"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-row-name"]')?.textContent).toBe(
			'Ada Lovelace'
		);
		expectNoFailureBranch(container, 'roster');

		expect(factorySpy).toHaveBeenCalledTimes(1);
		expect(factorySpy.mock.calls[0][0]).toMatchObject({ name: 'roster' });
		expect(typeof factorySpy.mock.calls[0][0].load).toBe('function');
	});

	it('/library constructs the machine (named for itself) and reaches its ready DOM through it', async () => {
		const { container } = render(LibraryPage);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-list"]')).not.toBeNull();
		});
		expect(container.textContent).toContain('Missa');
		expectNoFailureBranch(container, 'library');

		expect(factorySpy).toHaveBeenCalledTimes(1);
		expect(factorySpy.mock.calls[0][0]).toMatchObject({ name: 'library' });
		expect(typeof factorySpy.mock.calls[0][0].load).toBe('function');
	});
});

// (*MVOX:Tallis*)
