// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
		roster_view_modes_label: () => 'Roster view',
		roster_view_collapsed: () => 'Collapsed',
		roster_view_expanded: () => 'Expanded',
		roster_view_arrange: () => 'Arrange'
	})
);

const { loadRosterMock, listSectionsMock } = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
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
import { collectiveState, selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function setAuthedWithOneCollective() {
	signIn();
}

function setNoCollective() {
	signIn({ collectives: [] });
}

beforeEach(() => {
	listSectionsMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	resetAppState();
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
		loadRosterMock.mockResolvedValue(toListRead([
			{ memberId: 'member-1', personId: 'person-a', name: 'Ada Lovelace', email: 'ada@example.com' },
			{ memberId: 'member-2', personId: 'person-b', name: 'Bea Noe', email: '' }
		]));
		setAuthedWithOneCollective();

		const { container } = render(Page);

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
		loadRosterMock.mockResolvedValue(toListRead([]));
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
		expect(container.textContent).toContain('Something went wrong loading the roster.');
		expect(container.textContent).not.toContain('boom 500');
		expect(consoleSpy).toHaveBeenCalled();
		const loggedArgs = consoleSpy.mock.calls.flat();
		const loggedDetail = loggedArgs.some(
			(arg) => arg instanceof Error && arg.message === 'boom 500'
		);
		expect(loggedDetail).toBe(true);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);

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
		let resolveFirst!: (read: { items: unknown[]; total: number; truncated: boolean }) => void;
		loadRosterMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				})
		);
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(1));

		loadRosterMock.mockResolvedValueOnce(toListRead([
			{ memberId: 'member-2', personId: 'person-b', name: 'Second Collective Member', email: '' }
		]));
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'otherdb', name: 'Other', personId: 'person-p2' }
			],
			erroredDbs: []
		});
		selectedCollectiveDbStore.set('otherdb');

		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(2));

		resolveFirst(
			toListRead([{ memberId: 'member-1', personId: 'person-a', name: 'Stale Member', email: '' }])
		);

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
