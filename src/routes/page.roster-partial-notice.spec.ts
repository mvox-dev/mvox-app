// @vitest-environment happy-dom
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const { loadInactiveRosterMock, listInactiveMembersMock, loadActiveAndArchivedRostersMock } = vi.hoisted(() => ({
		loadInactiveRosterMock: vi.fn(),
		loadActiveAndArchivedRostersMock: vi.fn(),
		listInactiveMembersMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: vi.fn(),
	reinstateMember: vi.fn(),
	loadInactiveRoster: loadInactiveRosterMock,
	loadActiveAndArchivedRosters: loadActiveAndArchivedRostersMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
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
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { cleanupClearResetAdmin, setAuthedWithOneCollective } from '$lib/testing/pages/roster';

const NOTICE = '[data-testid="roster-partial-notice"]';

const rows = [
	{
		memberId: 'm1',
		personId: 'person-p',
		name: 'Alice Alto',
		email: 'alice@example.com',
		sectionIds: [],
		dbEntityId: 'db-1'
	}
];

const inactiveRows = [
	{
		memberId: 'm9',
		personId: 'pp-9',
		name: 'Gone Girl',
		email: '',
		sectionIds: [],
		dbEntityId: 'db-1'
	}
];

function partial<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(rows));
	listSectionsMock.mockResolvedValue([]);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	loadActiveAndArchivedRostersMock.mockImplementation(async (cfg: unknown) => {
		const [active, inactive] = await Promise.all([
			loadRosterMock(cfg),
			loadInactiveRosterMock(cfg)
		]);
		return { active, inactive };
	});
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
});

afterEach(cleanupClearResetAdmin);

async function renderReady() {
	const utils = render(Page);
	setAuthedWithOneCollective();
	adminStore.set('admin');
	await waitFor(() =>
		expect(
			utils.container.querySelector('[data-testid="section-toggle-unassigned"]')
		).not.toBeNull()
	);
	return utils;
}

describe('#321 /roster — the partial notice', () => {
	it('the truncation of the archived-member panel raises the SAME notice', async () => {
		loadInactiveRosterMock.mockResolvedValue(partial(inactiveRows, 812));
		const { container } = await renderReady();
		expect(container.querySelector(NOTICE)).toBeNull();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);

		await waitFor(() => expect(container.querySelector(NOTICE)).not.toBeNull());
		expect(container.querySelectorAll(NOTICE).length).toBe(1);
	});

	it('closing the archived panel takes its notice down with it (the active roster is complete)', async () => {
		loadInactiveRosterMock.mockResolvedValue(partial(inactiveRows, 812));
		const { container } = await renderReady();
		const toggle = container.querySelector('[data-testid="roster-inactive-toggle"]')!;

		await fireEvent.click(toggle);
		await waitFor(() => expect(container.querySelector(NOTICE)).not.toBeNull());

		await fireEvent.click(toggle);

		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-list"]')).toBeNull()
		);
		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

// (*MVOX:Josquin*)
