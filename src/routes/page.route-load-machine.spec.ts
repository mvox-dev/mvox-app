// @vitest-environment happy-dom
//
// #232 RED — runtime integration: the shared route-load machine is not a
// library sitting beside the pages, it is the thing that DRIVES them. Each of
// the three primary routes is mounted for real (real data layers, real
// entuFetch, real collectives/auth stores — only the wire and app plumbing
// stubbed, same posture as the session-expired suites) and the spec asserts:
//
//   • the page constructed the shared machine (factory spy, wrapping the REAL
//     implementation — behavior is untouched), named for itself;
//   • the mounted page actually reaches its 'ready' DOM through the machine —
//     a vestigial construct-and-ignore call cannot pass this.
//
// InviteSurface is deliberately absent here: it consumes the shared TYPE only
// (superset union, no load sequencing to extract), which is pinned in
// routeLoad.wiring.spec.ts; its behavior suites are untouched.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
// LanguageSelector.svelte (app chrome, rendered unconditionally on /profile
// and /roster, not gated on load status) needs the full runtime surface, not
// just getLocale — vitest resolves 'runtime' and 'runtime.js' to the same
// mocked module (page.agenda-header-locale.spec.ts's fuller mock is the
// house precedent).
vi.mock('$lib/paraglide/runtime', () => ({
	getLocale: () => 'en',
	setLocale: vi.fn(),
	locales: ['en', 'et', 'lv', 'uk']
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// The spy wraps the REAL factory — pages run the genuine machine; the spec
// only observes that they construct it.
vi.mock('$lib/loading/routeLoad', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/loading/routeLoad')>();
	return { ...actual, createRouteLoadMachine: vi.fn(actual.createRouteLoadMachine) };
});

import { createRouteLoadMachine } from '$lib/loading/routeLoad';
import ProfilePage from './profile/+page.svelte';
import RosterPage from './roster/+page.svelte';
import LibraryPage from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetGate } from '$lib/profile/completionGate';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';

const factorySpy = createRouteLoadMachine as unknown as Mock;

// ── The WIRE stub — real entuFetch routes on the real URL. One member (Ada)
// with a domain profile, one work; everything else empty.
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
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function expectNoFailureBranch(container: HTMLElement, prefix: string) {
	expect(container.querySelector(`[data-testid="${prefix}-load-error"]`)).toBeNull();
	expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
}

beforeEach(() => {
	factorySpy.mockClear();
	resetTypeIdCache();
	// Supplementary background reads (seasons/repertoire against an empty wire)
	// may log — the assertions below are DOM- and spy-based, not log-based.
	vi.spyOn(console, 'error').mockImplementation(() => {});
	stubWire();
	setAuthedWithOneCollective();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
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

		// TU.2/#110 finding #9 house precedent (page.roster.spec.ts) — sections
		// (incl. the Unassigned pseudo-group every member here lands in) default
		// COLLAPSED; expand it to get rows on screen. Orthogonal to the machine
		// itself — reaching 'ready' is the thing under test here.
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
