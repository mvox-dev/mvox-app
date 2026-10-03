// @vitest-environment happy-dom
// The roster page's deactivate flow, end to end.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule({ archived: true })
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: false })
);
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
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal)
);

import Page from './roster/+page.svelte';
import { LibraryLookupError, resolveMyLibraryId } from '$lib/library/librarianStore';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { REDACT_ATTR, REDACT_TOGGLE_ATTR } from '$lib/redact/redact';
import { deferred } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { createInviteMock, mintSelfLinkInviteMock } from '$lib/testing/mocks/admin';
import {
	deactivateMemberMock,
	listDeactivateBlockersMock,
	listInactiveMembersMock,
	loadActiveAndArchivedRostersMock,
	loadInactiveRosterMock,
	loadMemberRecordMock,
	loadRosterMock,
	reinstateMemberMock
} from '$lib/testing/mocks/roster';

function setAuthedWithOneCollective() {
	signIn();
}

const rosterTwo = [
	{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: 'db-1' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
];

const altoSection = {
	id: 'sec-alto',
	name: 'Alto',
	displayOrder: 0,
	parentId: null,
	dbEntityId: 'db-1',
	depth: 0,
	children: []
};

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(rosterTwo));
	listSectionsMock.mockResolvedValue([]);
	listDeactivateBlockersMock.mockResolvedValue([]);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	loadActiveAndArchivedRostersMock.mockImplementation(async (cfg: unknown) => {
		const [active, inactive] = await Promise.all([
			loadRosterMock(cfg),
			loadInactiveRosterMock(cfg)
		]);
		return { active, inactive };
	});
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
});

async function renderRosterAs(admin: 'admin' | 'not-admin') {
	const utils = render(Page);
	setAuthedWithOneCollective();
	adminStore.set(admin);
	await waitFor(() =>
		expect(
			utils.container.querySelector('[data-testid="section-toggle-unassigned"]')
		).not.toBeNull()
	);
	await fireEvent.click(
		utils.container.querySelector('[data-testid="section-toggle-unassigned"]')!
	);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="roster-row-m2"]')).not.toBeNull()
	);
	return utils;
}

async function openCard(container: HTMLElement, memberId: string) {
	const li = container.querySelector(`[data-testid="roster-row-${memberId}"]`);
	expect(li, `roster-row-${memberId} must render`).not.toBeNull();
	if (li!.querySelector('[data-testid="roster-record-name"]')) return; // already open
	const card = container.querySelector(`[data-testid="roster-row-card-${memberId}"]`);
	expect(card, `#302: collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card!);
	await waitFor(() =>
		expect(
			container
				.querySelector(`[data-testid="roster-row-${memberId}"]`)!
				.querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull()
	);
}

describe('(A) deactivate — admin-only, never self (done-when 7)', () => {
	it('a collective admin sees the deactivate control on ANOTHER member\'s row', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit: control lives in the opened editor
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull();
	});

	it("the viewer's OWN row never carries a deactivate control — self-deactivation is impossible at the UI", async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm1');
		expect(container.querySelector('[data-testid="member-deactivate-m1"]')).toBeNull();
	});

	it('a NON-admin member sees no deactivate control anywhere', async () => {
		const { container } = await renderRosterAs('not-admin');
		expect(container.querySelector('[data-testid="member-deactivate-m1"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});
});

describe('(A) two-step confirm — the page\'s existing destructive idiom, reused', () => {
	it('arming swaps in confirm + cancel and writes NOTHING', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});

	it('cancel disarms — the arm control returns, still nothing written', async () => {
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});

	it('confirm calls deactivateMember for THAT member and refetches the roster (she drops out of the active reads)', async () => {
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		expect(deactivateMemberMock.mock.calls[0][1]).toBe('m2');
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
	});
});

describe('(A) refusal while a manageable grant is held — names the remedy (Gama binding)', () => {
	it('an admin-grant blocker REFUSES: no write, and the message carries the collective so it can say where to remove the role — never a bare "cannot deactivate"', async () => {
		listDeactivateBlockersMock.mockResolvedValue([{ role: 'admin' }]);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const refused = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-refused-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(refused.textContent).toContain('Sampledb');
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('FAIL-CLOSED: when the rights read itself rejects, deactivate does NOT proceed', async () => {
		listDeactivateBlockersMock.mockRejectedValue(new Error('rights read failed'));
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('FAIL-CLOSED: a roster with no resolvable database entity id NEVER deactivates', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [] },
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [] }
		]));
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-failed-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(resolveMyLibraryId).not.toHaveBeenCalled();
		expect(listDeactivateBlockersMock).not.toHaveBeenCalled();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('FAIL-CLOSED: when the LIBRARY lookup rejects, deactivate does NOT proceed and the row alerts', async () => {
		vi.mocked(resolveMyLibraryId).mockRejectedValue(
			new LibraryLookupError('library lookup failed: HTTP 500', 500)
		);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-failed-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(listDeactivateBlockersMock).not.toHaveBeenCalled();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('a genuine null library id still proceeds — no library is a FACT, not a failure', async () => {
		vi.mocked(resolveMyLibraryId).mockResolvedValue(null);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		expect(listDeactivateBlockersMock.mock.calls[0][3]).toBeNull();
	});
});

describe('(B) inactive surface — out of the normal flow, sections shown, reinstate without invite (done-when 4)', () => {
	const inactiveRoster = [
		{
			memberId: 'm9',
			personId: 'pp-9',
			name: 'Gone Girl',
			email: 'gone@example.com',
			sectionIds: ['sec-alto'],
			dbEntityId: 'db-1'
		}
	];

	async function renderWithInactive() {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(toListRead(inactiveRoster));
		const utils = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		return utils;
	}

	it('OUT of the normal flow: inactive rows are NOT rendered until the toggle opens the surface', async () => {
		const { container } = await renderWithInactive();
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();
	});

	it('opening the surface loads and renders each inactive member WITH her section assignment (adopted binding — explains the section ghost-blocker)', async () => {
		const { container } = await renderWithInactive();
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		const row = await waitFor(() => {
			const el = container.querySelector('[data-testid="inactive-member-row-m9"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(row.textContent).toContain('Gone Girl');
		const section = container.querySelector('[data-testid="inactive-member-section-m9"]');
		expect(section).not.toBeNull();
		expect(section?.textContent).toContain('Alto');
	});

	it('reinstate is ONE action: calls reinstateMember for her, mints NO invitation, and refreshes both lists', async () => {
		const { container } = await renderWithInactive();
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);
		const rosterLoadsBefore = loadRosterMock.mock.calls.length;
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));
		expect(reinstateMemberMock.mock.calls[0][1]).toBe('m9');
		expect(createInviteMock).not.toHaveBeenCalled();
		expect(mintSelfLinkInviteMock).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(rosterLoadsBefore)
		);
	});

	it('a second tap while the reinstate is in flight is refused — one write, no false failure alert', async () => {
		let release: () => void = () => {};
		reinstateMemberMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				})
		);
		const { container } = await renderWithInactive();
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);
		const button = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-reinstate-m9"]'
		)!;
		await fireEvent.click(button);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));
		expect(button.disabled).toBe(true);
		await fireEvent.click(button);
		button.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(reinstateMemberMock).toHaveBeenCalledTimes(1);
		release();
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector('[data-testid="member-reinstate-failed-m9"]')).toBeNull();
	});

	it('switching collectives clears the panel — one collective\'s inactive members never render under another\'s roster', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(toListRead(inactiveRoster));
		const { container } = render(Page);
		signIn({
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
			]
		});
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).not.toBeNull()
		);

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			const toggle = container.querySelector('[data-testid="roster-inactive-toggle"]');
			expect(toggle).not.toBeNull();
			expect(toggle!.getAttribute('aria-expanded')).toBe('false');
		});
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-inactive-list"]')).toBeNull();
	});

	it('a deactivate with the panel OPEN refreshes the panel too — she belongs in it now', async () => {
		loadInactiveRosterMock.mockResolvedValue(toListRead([]));
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		loadInactiveRosterMock.mockResolvedValue(toListRead([
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
		]));
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="inactive-member-row-m2"]')).not.toBeNull()
		);
		expect(
			container.querySelector('[data-testid="roster-inactive-toggle"]')?.getAttribute('aria-expanded')
		).toBe('true');
	});

	it('a FAILED panel refresh after a deactivate is not reported as a failed deactivate — the write landed', async () => {
		loadInactiveRosterMock.mockResolvedValue(toListRead([]));
		const { container } = await renderRosterAs('admin');
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		loadInactiveRosterMock.mockRejectedValue(new Error('inactive read failed'));
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
	});

	it('a NON-admin gets no inactive surface (reinstate is an admin write, done-when 7 symmetry)', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(toListRead(inactiveRoster));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('not-admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="section-toggle-unassigned"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).toBeNull();
	});
});

describe('(A/B) fail-LOUD — no lifecycle failure is allowed to be silent', () => {
	it('a rejected RIGHTS READ surfaces a role=alert on that row (not just a console line)', async () => {
		listDeactivateBlockersMock.mockRejectedValue(new Error('rights read failed'));
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-deactivate-failed-m2"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect((alert.textContent ?? '').replace(/\s+/g, '')).toBe('[roster_member_deactivate_failed]m2');
		expect(alert.textContent).not.toContain('Berta Bass');
		const links = alert.querySelectorAll('a');
		expect(links).toHaveLength(1);
		expect(links[0].textContent?.trim()).toBe('m2');
		expect(links[0].getAttribute('href')).toBe('https://entu.app/sampledb/m2');
		expect(links[0].getAttribute('title')).toBe('m2');
		expect(deactivateMemberMock).not.toHaveBeenCalled();
		const confirmAfter = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-confirm-m2"]'
		);
		expect(confirmAfter).not.toBeNull();
		expect(confirmAfter!.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('a rejected STATUS WRITE surfaces the same alert, and the roster is NOT refetched as if it worked', async () => {
		deactivateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = await renderRosterAs('admin');
		const rosterLoadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		expect(loadRosterMock.mock.calls.length).toBe(rosterLoadsBefore);
		const confirmAfter = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-confirm-m2"]'
		);
		expect(confirmAfter).not.toBeNull();
		expect(confirmAfter!.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
	});

	it('cancel-then-rearm after a failure: cancel disarms AND clears the alert; a fresh arm starts with no stale alert', async () => {
		deactivateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		const cancel = container.querySelector('[data-testid="member-deactivate-cancel-m2"]');
		expect(cancel, 'the pair must still be armed beside the failure alert').not.toBeNull();
		await fireEvent.click(cancel!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
	});

	it('a rejected REINSTATE surfaces a role=alert next to that inactive row — otherwise the tap produces no visible change at all', async () => {
		listSectionsMock.mockResolvedValue([altoSection]);
		loadInactiveRosterMock.mockResolvedValue(toListRead([
			{
				memberId: 'm9',
				personId: 'pp-9',
				name: 'Gone Girl',
				email: 'gone@example.com',
				sectionIds: ['sec-alto'],
				dbEntityId: 'db-1'
			}
		]));
		reinstateMemberMock.mockRejectedValue(new Error('403'));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="member-reinstate-failed-m9"]');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect((alert.textContent ?? '').replace(/\s+/g, '')).toBe('[roster_member_reinstate_failed]m9');
		expect(alert.textContent).not.toContain('Gone Girl');
		const links = alert.querySelectorAll('a');
		expect(links).toHaveLength(1);
		expect(links[0].textContent?.trim()).toBe('m9');
		expect(links[0].getAttribute('href')).toBe('https://entu.app/sampledb/m9');
		expect(links[0].getAttribute('title')).toBe('m9');
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).not.toBeNull();
	});
});

describe('(A) #286 — the armed pair through the in-flight deactivate: mounted, disabled, aria-busy; cancel inert; one write; one arm slot', () => {
	it('while the BLOCKER READ is in flight the pair stays mounted — both halves disabled, confirm aria-busy, labels unchanged', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el, 'confirm must stay mounted through the chain').not.toBeNull();
			expect(el!.disabled).toBe(true);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		);
		expect(cancel, 'cancel must stay mounted through the chain').not.toBeNull();
		expect(cancel!.disabled).toBe(true);
		expect(confirm.textContent).toContain('roster_member_deactivate_confirm');
		expect(cancel!.textContent).toContain('roster_member_deactivate_cancel');
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		gate.resolve([]);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
	});

	it('while the WRITE is in flight the pair is disabled + confirm aria-busy — a double-tap cannot fire two writes; release → she leaves the roster and the pair disarms', async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el, 'confirm must stay mounted through the write').not.toBeNull();
			expect(el!.disabled).toBe(true);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		expect(
			container.querySelector<HTMLButtonElement>('[data-testid="member-deactivate-cancel-m2"]')!
				.disabled
		).toBe(true);

		await fireEvent.click(confirm);
		confirm.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);

		loadRosterMock.mockResolvedValue(toListRead([rosterTwo[0]]));
		gate.resolve();
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).toBeNull();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
	});

	it('CANCEL during the held BLOCKER READ is INERT — no disarm, the pair stays mounted; release → the outcome lands honestly', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		await fireEvent.click(cancel);
		cancel.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			'the pair must not disarm while the chain is in flight'
		).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-cancel-m2"]')).not.toBeNull();
		expect(
			container.querySelector('[data-testid="member-deactivate-m2"]'),
			'the rest-state trigger must never render while the chain is running'
		).toBeNull();

		gate.resolve([]);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));
	});

	it('CANCEL during the held WRITE is INERT — release → the deactivation LANDS: refetch, row gone, never "stopped"', async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		const loadsBefore = loadRosterMock.mock.calls.length;
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		await fireEvent.click(cancel);
		cancel.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			'cancel mid-write must not imply the deactivation was stopped'
		).not.toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		loadRosterMock.mockResolvedValue(toListRead([rosterTwo[0]]));
		gate.resolve();
		await waitFor(() =>
			expect(loadRosterMock.mock.calls.length).toBeGreaterThan(loadsBefore)
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-row-m2"]')).toBeNull()
		);
		expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
	});

	it('a SECOND row cannot be armed mid-flight — the single arm slot is never stolen from the in-flight row', async () => {
		loadRosterMock.mockResolvedValue(toListRead([
			...rosterTwo,
			{ memberId: 'm3', personId: 'pp-3', name: 'Carla Cantus', email: 'carla@example.com', sectionIds: [], dbEntityId: 'db-1' }
		]));
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-row-card-m3"]')).not.toBeNull()
		);
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		await openCard(container, 'm3');
		const trigger3 = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-m3"]'
		)!;
		await fireEvent.click(trigger3);
		trigger3.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m3"]'),
			'no second row may arm while a deactivation is in flight'
		).toBeNull();
		expect(
			container.querySelector('[data-testid="member-deactivate-confirm-m2"]'),
			"the in-flight row's pair must survive the attempted steal"
		).not.toBeNull();

		gate.resolve();
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
	});

	it('REFUSAL (held read): the pair stays ARMED and re-enabled beside the refusal — explicit cancel disarms AND clears it (done-when 4)', async () => {
		const gate = deferred<{ role: string }[]>();
		listDeactivateBlockersMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1));

		gate.resolve([{ role: 'admin' }]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-refused-m2"]')).not.toBeNull()
		);
		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el).not.toBeNull();
			expect(el!.disabled).toBe(false);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).not.toBe('true');
		const cancel = container.querySelector<HTMLButtonElement>(
			'[data-testid="member-deactivate-cancel-m2"]'
		)!;
		expect(cancel.disabled).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();

		await fireEvent.click(cancel);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-m2"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-refused-m2"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull();
	});

	it('FAILURE (held write): the pair stays ARMED and re-enabled beside the error — direct retry through the SAME confirm succeeds', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const { container } = await renderRosterAs('admin');
		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(1));

		gate.reject(new Error('500'));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).not.toBeNull()
		);
		const confirm = await waitFor(() => {
			const el = container.querySelector<HTMLButtonElement>(
				'[data-testid="member-deactivate-confirm-m2"]'
			);
			expect(el).not.toBeNull();
			expect(el!.disabled).toBe(false);
			return el!;
		});
		expect(confirm.getAttribute('aria-busy')).not.toBe('true');
		expect(
			container.querySelector<HTMLButtonElement>('[data-testid="member-deactivate-cancel-m2"]')!
				.disabled
		).toBe(false);
		expect(container.querySelector('[data-testid="member-deactivate-m2"]')).toBeNull();

		deactivateMemberMock.mockResolvedValue(undefined);
		loadRosterMock.mockResolvedValue(toListRead([rosterTwo[0]]));
		await fireEvent.click(confirm);
		await waitFor(() => expect(deactivateMemberMock).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).toBeNull()
		);
		expect(container.querySelector('[data-testid="member-deactivate-failed-m2"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

describe('(B) #259 — in-flight inactive-panel loads must not outlive a collective switch', () => {
	type InactiveRow = {
		memberId: string;
		personId: string;
		name: string;
		email: string;
		sectionIds: string[];
		dbEntityId: string;
	};

	const goneGirl: InactiveRow = {
		memberId: 'm9',
		personId: 'pp-9',
		name: 'Gone Girl',
		email: 'gone@example.com',
		sectionIds: [],
		dbEntityId: 'db-1'
	};

	function setAuthedWithTwoCollectives() {
		signIn({
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
			]
		});
	}

	function holdInactiveLoads(): Array<(rows: InactiveRow[]) => void> {
		const settlers: Array<(rows: InactiveRow[]) => void> = [];
		loadInactiveRosterMock.mockImplementation(
			() =>
				new Promise<{ items: InactiveRow[]; total: number; truncated: boolean }>((resolve) => {
					settlers.push((rows: InactiveRow[]) => resolve(toListRead(rows)));
				})
		);
		return settlers;
	}

	async function renderTwoCollectiveRoster() {
		const utils = render(Page);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		return utils;
	}

	async function switchToOtherChoir(container: HTMLElement) {
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			const toggle = container.querySelector('[data-testid="roster-inactive-toggle"]');
			expect(toggle).not.toBeNull();
			expect(toggle!.getAttribute('aria-expanded')).toBe('false');
		});
	}

	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("a PANEL-OPEN load that settles after a switch writes NOTHING — reopening on the new collective never renders the old one's rows", async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));

		await switchToOtherChoir(container);

		settlers[0]!([goneGirl]);
		await flush();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();

		settlers[1]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();
	});

	it('a POST-DEACTIVATE panel reload that settles after a switch writes NOTHING', async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();
		await fireEvent.click(container.querySelector('[data-testid="section-toggle-unassigned"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-row-m2"]')).not.toBeNull()
		);

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		settlers[0]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);

		await openCard(container, 'm2'); // #302 drive-path edit
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-m2"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="member-deactivate-confirm-m2"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));

		await switchToOtherChoir(container);
		settlers[1]!([
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
		]);
		await flush();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(3));
		expect(container.querySelector('[data-testid="inactive-member-row-m2"]')).toBeNull();

		settlers[2]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
	});

	it('a POST-REINSTATE panel reload that settles after a switch writes NOTHING', async () => {
		const settlers = holdInactiveLoads();
		const { container } = await renderTwoCollectiveRoster();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(1));
		settlers[0]!([goneGirl]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);

		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(2));

		await switchToOtherChoir(container);
		settlers[1]!([goneGirl]);
		await flush();

		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() => expect(loadInactiveRosterMock).toHaveBeenCalledTimes(3));
		expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull();

		settlers[2]!([]);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
	});

	it('NON-RACE: an ordinary reinstate with the panel open still refreshes it — she leaves the panel', async () => {
		loadInactiveRosterMock.mockResolvedValue(toListRead([goneGirl]));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-reinstate-m9"]')).not.toBeNull()
		);

		loadInactiveRosterMock.mockResolvedValue(toListRead([]));
		await fireEvent.click(container.querySelector('[data-testid="member-reinstate-m9"]')!);
		await waitFor(() => expect(reinstateMemberMock).toHaveBeenCalledTimes(1));

		await waitFor(() =>
			expect(container.querySelector('[data-testid="inactive-member-row-m9"]')).toBeNull()
		);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="roster-inactive-empty"]')).not.toBeNull()
		);
		expect(
			container.querySelector('[data-testid="roster-inactive-toggle"]')?.getAttribute('aria-expanded')
		).toBe('true');
	});
});

describe('#388 — capture redaction: inactive row name marked; no unexplained real name or contact value with the toggle engaged', () => {
	const inactiveGone = [
		{
			memberId: 'm9',
			personId: 'pp-9',
			name: 'Gone Girl',
			email: 'gone@example.com',
			sectionIds: [],
			dbEntityId: 'db-1'
		}
	];
	const FIXTURE_VALUES = [
		'Alice Alto',
		'alice@example.com',
		'Berta Bass',
		'berta@example.com',
		'Gone Girl',
		'gone@example.com'
	];

	afterEach(() => {
		document.documentElement.removeAttribute(REDACT_TOGGLE_ATTR);
	});

	async function renderWithInactiveOpen() {
		loadInactiveRosterMock.mockResolvedValue(toListRead(inactiveGone));
		const utils = await renderRosterAs('admin');
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')).not.toBeNull()
		);
		await fireEvent.click(utils.container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="inactive-member-row-m9"]')).not.toBeNull()
		);
		return utils;
	}

	function sweep(root: Element) {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const unmarked: string[] = [];
		const found = new Set<string>();
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const text = n.textContent ?? '';
			for (const value of FIXTURE_VALUES) {
				if (!text.includes(value)) continue;
				found.add(value);
				if (!n.parentElement?.closest(`[${REDACT_ATTR}]`)) {
					const owner = n.parentElement?.closest('[data-testid]')?.getAttribute('data-testid');
					unmarked.push(`${value} @ ${owner ?? n.parentElement?.tagName}`);
				}
			}
		}
		return { unmarked, found: [...found].sort() };
	}

	it('the inactive-members row name sits inside a tight marker', async () => {
		const { container } = await renderWithInactiveOpen();
		const row = container.querySelector('[data-testid="inactive-member-row-m9"]')!;
		const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
		const hits: Text[] = [];
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if ((n.textContent ?? '').includes('Gone Girl')) hits.push(n as Text);
		}
		expect(hits.length, 'the inactive row renders her name').toBeGreaterThan(0);
		for (const hit of hits) {
			const marker = hit.parentElement?.closest(`[${REDACT_ATTR}]`) ?? null;
			expect(marker, `'Gone Girl' must sit inside a [${REDACT_ATTR}] element`).not.toBeNull();
			expect(row.contains(marker), 'the marker is inside the row, not around the panel').toBe(true);
			expect(marker!.textContent?.trim()).toBe('Gone Girl');
		}
	});

	it.each([
		['collapsed rows + inactive panel', false],
		['with m2\'s record editor open', true]
	] as const)('AC3 (%s): with data-redacting on <html>, every fixture name/email in a text node is inside a marked element', async (_label, openEditor) => {
		document.documentElement.setAttribute(REDACT_TOGGLE_ATTR, '');
		const { container } = await renderWithInactiveOpen();
		if (openEditor) await openCard(container, 'm2');
		expect(document.documentElement.hasAttribute(REDACT_TOGGLE_ATTR)).toBe(true);
		const { unmarked, found } = sweep(document.body);
		expect(unmarked).toEqual([]);
		expect(found).toEqual(
			['Alice Alto', 'Berta Bass', 'Gone Girl', 'alice@example.com', 'berta@example.com'].sort()
		);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
