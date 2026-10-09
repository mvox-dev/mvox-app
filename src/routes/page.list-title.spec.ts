// @vitest-environment happy-dom
// Every main list has one title, in its list frame's header line, in every load state (#869).
import { render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
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
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import AgendaPage from './+page.svelte';
import LibraryPage from './library/+page.svelte';
import LinksPage from './links/+page.svelte';
import RosterPage from './roster/+page.svelte';
import { resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { cleanupUnstubResetAuth, q } from '$lib/testing/pages/dom';
import { pagesReaching } from '$lib/testing/pageReach';
import { signIn } from '$lib/testing/session';
import { collectiveState } from '$lib/collectives/store';
import type { CollectiveState } from '$lib/collectives/types';

type State = 'loading' | 'load-error' | 'session-expired' | 'empty' | 'ready' | Discovery;
type Discovery = 'collectives-loading' | 'collectives-none' | 'collectives-error';

const DISCOVERY: Record<Discovery, CollectiveState> = {
	'collectives-loading': { status: 'loading' },
	'collectives-none': { status: 'none' },
	'collectives-error': { status: 'error', erroredDbs: ['sampledb'] }
};

// Downloads reads the device's byte store, not Entu: its states live in its own spec.
// Each page lists the states it reaches by fetch alone and the testid each one shows.
// The agenda with rows is in page.agenda-filter.spec.ts: an event needs more than one ROW.
type ListPage = { Page: Component; title: string; shown: Partial<Record<State, string>> };
const PAGES: Record<string, ListPage> = {
	'/': {
		Page: AgendaPage,
		title: 'nav_agenda',
		shown: {
			loading: 'agenda-skeleton',
			'load-error': 'agenda-error',
			'session-expired': 'session-expired',
			empty: 'agenda-empty',
			'collectives-loading': 'auth-status',
			'collectives-none': 'auth-status',
			'collectives-error': 'collectives-retry'
		}
	},
	'/library': { Page: LibraryPage, title: 'library_title', shown: routeStates('library') },
	'/links': { Page: LinksPage, title: 'links_title', shown: routeStates('links') },
	'/roster': { Page: RosterPage, title: 'roster_title', shown: routeStates('roster') }
};

function routeStates(name: 'library' | 'links' | 'roster'): Partial<Record<State, string>> {
	return {
		loading: `${name}-skeleton`,
		'load-error': `${name}-load-error`,
		'session-expired': 'session-expired',
		empty: `${name}-empty`,
		ready: { library: 'library-work-list', links: 'links-list', roster: 'roster-groups' }[name]!
	};
}

const cases = Object.entries(PAGES).flatMap(([route, { shown }]) =>
	(Object.keys(shown) as State[]).map((state) => [route, state] as const)
);

// One entity every list reads as a row of its own kind: a work, a link, a member.
const ROW = {
	_id: 'row-1',
	_sharing: [{ string: 'private' }],
	name: [{ string: 'Row one' }],
	url: [{ string: 'https://example.com' }],
	status: [{ string: 'active' }],
	person: [{ reference: 'person-1', string: 'Row one' }]
};

function fetchFor(state: State) {
	if (state === 'loading') return vi.fn(() => new Promise<Response>(() => {}));
	const status = state === 'load-error' ? 500 : state === 'session-expired' ? 401 : 200;
	const body = state === 'ready' ? { entities: [ROW], count: 1 } : { entities: [], count: 0 };
	return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
	resetTypeIdCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	cleanupUnstubResetAuth();
	vi.restoreAllMocks();
	resetGate();
});

describe('every main list has one title in its header line', () => {
	it('is every page in the table, plus /downloads', () => {
		expect([...Object.keys(PAGES), '/downloads'].sort()).toEqual(
			pagesReaching('src/lib/components/ListOfStuff.svelte')
		);
	});

	it.each(cases)('%s, %s: exactly one h1, the list title, in the list header', async (route, state) => {
		vi.stubGlobal('fetch', fetchFor(state));
		pageStub.url = new URL(`http://localhost${route}`);
		signIn();
		if (state in DISCOVERY) collectiveState.set(DISCOVERY[state as Discovery]);
		const { container } = render(PAGES[route].Page);
		const shown = PAGES[route].shown[state]!;

		await waitFor(() => expect(q(container, shown)).not.toBeNull());
		const titles = [...container.querySelectorAll('h1')];
		expect(titles.map((h1) => h1.textContent?.trim())).toEqual([PAGES[route].title]);
		expect(q(container, 'list-of-stuff-header')?.contains(titles[0])).toBe(true);
	});
});
