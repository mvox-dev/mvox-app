// @vitest-environment happy-dom
// The roster: the inactive surface and reinstating a member.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
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
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal)
);

import Page from './roster/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { signIn } from '$lib/testing/session';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { createInviteMock, mintSelfLinkInviteMock } from '$lib/testing/mocks/admin';
import {
	deactivateMemberMock,
	loadActiveAndArchivedRostersMock,
	loadInactiveRosterMock,
	loadRosterMock,
	reinstateMemberMock
} from '$lib/testing/mocks/roster';
import { altoSection } from '$lib/testing/pages/rosterFixtures';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { openCard, renderRosterAs, useRosterDeactivatePage } from '$lib/testing/pages/rosterDeactivate';

useRosterDeactivatePage();

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

	it('a failed archived read is reported and the active list still loads (#756)', async () => {
		const { container } = await renderWithInactive();
		const boom = new Error('archived read failed');
		loadActiveAndArchivedRostersMock.mockRejectedValue(boom);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await fireEvent.click(container.querySelector('[data-testid="roster-inactive-toggle"]')!);
		await waitFor(() =>
			expect(consoleSpy).toHaveBeenCalledWith('roster: loading the archived roster failed', boom)
		);
		consoleSpy.mockRestore();
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

// (*MVOX:Tallis*) (*MVOX:Josquin*)
