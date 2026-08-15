// @vitest-environment happy-dom
//
// T3.3/#19 RED — the /roster page. Renders whatever `loadRoster` returns; row-level
// gated-exclusion (a nameless member never appearing) is a DATA-LAYER property
// (rosterData.spec.ts), NOT re-tested here — the page's job is only "renders
// whatever loadRoster returns" (correct separation: page tests shouldn't re-derive
// business rules the data layer already owns).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		roster_title: () => 'Roster',
		roster_no_collective: () => 'Select a collective to view the roster.',
		roster_load_error: () => 'Something went wrong loading the roster.',
		roster_retry: () => 'Retry',
		roster_empty: () => 'No members to show yet.',
		// TS.1/#95 — this file's own concerns (loading/ready/empty/error/
		// no-collective/staleness) are section-agnostic; these three keys exist
		// only so the grouped rewrite renders without throwing here.
		roster_unassigned: () => 'Unassigned',
		roster_column_name: () => 'Name',
		roster_sort_alphabetical: () => 'Sort A–Z',
		roster_sort_grouped: () => 'Group by section',
		// F3 code-review fix — banner shown when the section-tree load fails but
		// the roster itself loaded fine.
		roster_sections_load_error: () => 'Section grouping failed to load.',
		// #155/S1 — the view-mode chip selector above the groups (supersedes the
		// old collapse-all/expand-all toggle); this file's concerns don't touch
		// it, the keys just need to resolve so the grouped view renders without
		// throwing.
		roster_view_modes_label: () => 'Roster view',
		roster_view_collapsed: () => 'Collapsed',
		roster_view_expanded: () => 'Expanded',
		roster_view_arrange: () => 'Arrange'
	}
}));

const { loadRosterMock, listSectionsMock } = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
// TS.1/#95 — the page now ALSO loads the section tree; this file's concerns
// (loading/ready/empty/error/no-collective/staleness) are section-agnostic, so
// listSections is pinned to an empty tree (every member renders under Unassigned;
// roster-row-* testids must survive the grouped rewrite). groupBySection stays REAL
// (partial mock) — the page must run the genuine grouping.
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
// Severs the entu-config → $env/dynamic/public import under happy-dom (same pattern
// as page.rsvp-membership.spec.ts / page.profile.spec.ts / collectives/store.spec.ts):
// $lib/collectives/store imports discoverCollectives (real chain touches $env, which
// throws outside a SvelteKit request context under this environment).
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
// Same severing, for the OTHER real chain this page now pulls in: sectionData's
// mock below keeps groupBySection real (importOriginal), which loads sectionData.ts's
// own `entuFetch` import (→ $lib/entu-config → $env/dynamic/public) at module scope.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

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

function setNoCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: {},
		expMs: Date.now() + 100_000
	});
	collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(null);
}

beforeEach(() => {
	listSectionsMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/roster — loading state', () => {
	it('shows the skeleton while loadRoster is in flight', async () => {
		loadRosterMock.mockReturnValue(new Promise(() => {})); // never resolves
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-skeleton"]')).not.toBeNull();
		});
	});
});

describe('/roster — ready state', () => {
	it('renders each row (name always shown; a row with no email omits the email node entirely, not just an empty string)', async () => {
		loadRosterMock.mockResolvedValue([
			{ memberId: 'member-1', personId: 'person-a', name: 'Ada Lovelace', email: 'ada@example.com' },
			{ memberId: 'member-2', personId: 'person-b', name: 'Bea Noe', email: '' }
		]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		// TU.2/#110 finding #9 — sections (incl. the Unassigned pseudo-group, which
		// is where every member here lands — `listSectionsMock` is pinned to an
		// empty tree) default COLLAPSED; expand it to get rows on screen.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="section-toggle-unassigned"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="section-toggle-unassigned"]') as HTMLElement
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-row-member-1"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="roster-row-member-2"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-row-member-1"]')?.textContent).toContain(
			'Ada Lovelace'
		);
		expect(container.querySelector('[data-testid="roster-row-member-1"]')?.textContent).toContain(
			'ada@example.com'
		);
		const row2 = container.querySelector('[data-testid="roster-row-member-2"]');
		expect(row2?.textContent).toContain('Bea Noe');
		expect(row2?.querySelector('[data-testid="roster-row-email"]')).toBeNull();
	});
});

describe('/roster — empty state', () => {
	it('shows roster-empty and no roster-list when loadRoster resolves []', async () => {
		loadRosterMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-list"]')).toBeNull();
	});
});

describe('/roster — load-error state', () => {
	it('shows a generic localized error (not the raw thrown message); logs detail to console.error; retry calls loadRoster again', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockRejectedValue(new Error('boom 500'));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-load-error"]')).not.toBeNull();
		});
		// Generic message shown, raw error NOT shown
		expect(container.textContent).toContain('Something went wrong loading the roster.');
		expect(container.textContent).not.toContain('boom 500');
		// Detail logged to console
		expect(consoleSpy).toHaveBeenCalled();
		const loggedArgs = consoleSpy.mock.calls.flat();
		const loggedDetail = loggedArgs.some(
			(arg) => arg instanceof Error && arg.message === 'boom 500'
		);
		expect(loggedDetail).toBe(true);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);

		// Retry still works
		const retryBtn = container.querySelector('[data-testid="roster-retry-load"]') as HTMLButtonElement;
		expect(retryBtn).not.toBeNull();
		await fireEvent.click(retryBtn);

		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(2);
		});

		consoleSpy.mockRestore();
	});
});

describe('/roster — no-collective state', () => {
	it('shows roster-no-collective and never calls loadRoster', async () => {
		setNoCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-no-collective"]')).not.toBeNull();
		});
		expect(loadRosterMock).not.toHaveBeenCalled();
	});
});

describe('/roster — staleness guard (generation discipline)', () => {
	it('a stale (superseded) load resolving after a collective switch does not clobber the newer result', async () => {
		let resolveFirst!: (rows: unknown[]) => void;
		loadRosterMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				})
		);
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(1));

		// Switch collective before the first load resolves — this should start a second,
		// newer load.
		loadRosterMock.mockResolvedValueOnce([
			{ memberId: 'member-2', personId: 'person-b', name: 'Second Collective Member', email: '' }
		]);
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
				{ db: 'otherdb', name: 'Other', personId: 'person-p2' }
			],
			erroredDbs: []
		});
		selectedCollectiveDbStore.set('otherdb');

		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(2));

		// Now resolve the FIRST (stale) call, with a member from the earlier collective.
		resolveFirst([{ memberId: 'member-1', personId: 'person-a', name: 'Stale Member', email: '' }]);

		// TU.2/#110 finding #9 — expand Unassigned to get member-2's row on screen
		// (every member here is Unassigned; listSectionsMock is pinned to []).
		await waitFor(() => {
			expect(container.querySelector('[data-testid="section-toggle-unassigned"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="section-toggle-unassigned"]') as HTMLElement
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-row-member-2"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-row-member-1"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
