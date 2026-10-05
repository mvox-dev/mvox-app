// @vitest-environment happy-dom
import { render, waitFor, fireEvent } from '@testing-library/svelte';
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

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './library/+page.svelte';
import { armLibraryRecovery } from '$lib/testing/pages/library';
import { cleanupUnstubResetAuth } from '$lib/testing/pages/dom';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';

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

beforeEach(armLibraryRecovery);

afterEach(cleanupUnstubResetAuth);

describe('/library — session expired (#107)', () => {
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
});

// (*MVOX:Tallis*)
