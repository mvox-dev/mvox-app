// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const { loadRosterMock, listSectionsMock, loadInactiveRosterMock, listInactiveMembersMock, loadActiveAndArchivedRostersMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		loadInactiveRosterMock: vi.fn(),
		loadActiveAndArchivedRostersMock: vi.fn(),
		listInactiveMembersMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: vi.fn(),
	reinstateMember: vi.fn(),
	loadInactiveRoster: loadInactiveRosterMock,
	loadActiveAndArchivedRosters: loadActiveAndArchivedRostersMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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

function setAuthedWithOneCollective() {
	signIn();
}

function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'otherdb', name: 'Other', personId: 'person-o' }
		]
	});
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

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
});

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
	it('a truncated member read renders a VISIBLE, persistent role="status" notice with the i18n copy', async () => {
		loadRosterMock.mockResolvedValue(partial(rows, 640));
		const { container } = await renderReady();

		await waitFor(() => expect(container.querySelector(NOTICE)).not.toBeNull());
		const notice = container.querySelector(NOTICE)!;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toContain('sr-only');
		expect(notice.textContent?.trim()).toBe('[roster_partial_notice]');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="section-toggle-unassigned"]')).not.toBeNull()
		);
		expect(container.querySelector(NOTICE)).not.toBeNull();
	});

	it('a complete read leaves the notice ABSENT from the DOM (not hidden)', async () => {
		const { container } = await renderReady();
		expect(container.querySelector(NOTICE)).toBeNull();
	});

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

	it('a collective switch does not carry A\'s truncation onto B\'s roster', async () => {
		loadRosterMock.mockResolvedValue(partial(rows, 640));
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		await waitFor(() => expect(utils.container.querySelector(NOTICE)).not.toBeNull());

		loadRosterMock.mockResolvedValue(toListRead(rows));
		selectedCollectiveDbStore.set('otherdb');

		await waitFor(() => expect(loadRosterMock).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(utils.container.querySelector(NOTICE)).toBeNull());
	});
});

// (*MVOX:Josquin*)
