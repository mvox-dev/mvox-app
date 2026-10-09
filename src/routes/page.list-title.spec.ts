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

type State = 'loading' | 'load-error' | 'session-expired' | 'empty';

// Downloads reads the device's byte store, not Entu: its states live in its own spec.
const PAGES: Record<string, { Page: Component; title: string; states: State[]; shown: string }> = {
	'/': { Page: AgendaPage, title: 'nav_agenda', states: ['empty'], shown: 'agenda-empty' },
	'/library': {
		Page: LibraryPage,
		title: 'library_title',
		states: ['loading', 'load-error', 'session-expired', 'empty'],
		shown: 'library-empty'
	},
	'/links': {
		Page: LinksPage,
		title: 'links_title',
		states: ['loading', 'load-error', 'session-expired', 'empty'],
		shown: 'links-empty'
	},
	'/roster': {
		Page: RosterPage,
		title: 'roster_title',
		states: ['loading', 'load-error', 'session-expired', 'empty'],
		shown: 'roster-empty'
	}
};

const SHOWN: Record<Exclude<State, 'empty'>, (route: string) => string> = {
	loading: (route) => `${route.slice(1)}-skeleton`,
	'load-error': (route) => `${route.slice(1)}-load-error`,
	'session-expired': () => 'session-expired'
};

const cases = Object.entries(PAGES).flatMap(([route, { states }]) =>
	states.map((state) => [route, state] as const)
);

function fetchFor(state: State) {
	if (state === 'loading') return vi.fn(() => new Promise<Response>(() => {}));
	const status = state === 'load-error' ? 500 : state === 'session-expired' ? 401 : 200;
	return vi.fn(async () => new Response('{"entities":[],"count":0}', { status }));
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
		const { container } = render(PAGES[route].Page);
		const shown = state === 'empty' ? PAGES[route].shown : SHOWN[state](route);

		await waitFor(() => expect(q(container, shown)).not.toBeNull());
		const titles = [...container.querySelectorAll('h1')];
		expect(titles.map((h1) => h1.textContent?.trim())).toEqual([PAGES[route].title]);
		expect(q(container, 'list-of-stuff-header')?.contains(titles[0])).toBe(true);
	});
});
