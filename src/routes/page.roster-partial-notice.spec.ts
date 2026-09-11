// @vitest-environment happy-dom
//
// #321 review F2 — /roster says when its member list is partial.
//
// The finding: the roster surface had zero #321 treatment although its reads are
// the same reachable shape the branch itself gave detection elsewhere. Fixed by
// widening `listActiveMembers` / `listRecordNamesByPerson` / `listInactiveMembers`
// (and the two orchestrators over them) to the shared `ListRead` and raising ONE
// page-level notice off the result.
//
// Pinned here, deliberately in the SAME shape the library and agenda notices are
// pinned in (page.library-partial-notice.spec.ts / page.agenda-partial-notice.spec.ts):
//   - VISIBLE and persistent: a real <p>, never sr-only, `role="status"`, its own
//     testid, copy through i18n (the KEY is pinned here, the four locales'
//     sentences in page.partial-notice-i18n.spec.ts);
//   - ABSENT FROM THE DOM (not merely hidden) when every read is complete;
//   - raised by EITHER page read — the main roster load (active members or the
//     admin_member_record overlay behind the real names) and the archived-member
//     panel — because the reader needs the same thing to know either way;
//   - NEVER leaked across a collective switch: a truncation detected in A must not
//     keep asserting itself over B's roster.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Key-echo message mock (page.roster-deactivate.spec.ts's pattern): this file is
// about WHICH key the notice renders and when, not about the sentence — the copy
// itself is pinned per-locale in page.partial-notice-i18n.spec.ts.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const { loadRosterMock, listSectionsMock, loadInactiveRosterMock, listInactiveMembersMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		loadInactiveRosterMock: vi.fn(),
		listInactiveMembersMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: vi.fn(),
	reinstateMember: vi.fn(),
	loadInactiveRoster: loadInactiveRosterMock,
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
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';

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

/** A ListRead the server reported as PARTIAL (count above the rows returned). */
function partial<T>(items: T[], total: number) {
	return { items, total, truncated: true };
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

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', otherdb: 'person-o' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'otherdb', name: 'Other', personId: 'person-o' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(rows));
	listSectionsMock.mockResolvedValue([]);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
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
		// It is a standing fact, not a toast: still there after the load settles.
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
		// ONE notice for the page, not one per read.
		expect(container.querySelectorAll(NOTICE).length).toBe(1);
	});

	// #321 review F3 — the notice is PAGE-level, so a truncation detected in the
	// archived panel kept standing over the ACTIVE roster once the panel closed: a
	// claim about a list no longer on screen, read as a claim about the one that
	// is. `toggleInactive` returned early on close without dropping it.
	it('closing the archived panel takes its notice down with it (the active roster is complete)', async () => {
		loadInactiveRosterMock.mockResolvedValue(partial(inactiveRows, 812));
		const { container } = await renderReady();
		const toggle = container.querySelector('[data-testid="roster-inactive-toggle"]')!;

		await fireEvent.click(toggle);
		await waitFor(() => expect(container.querySelector(NOTICE)).not.toBeNull());

		await fireEvent.click(toggle);

		// The panel really is shut (its rows are gone) and the claim went with it.
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

// (*MVOX:Josquin* — #321 review F2)
