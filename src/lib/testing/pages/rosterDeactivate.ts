// Roster deactivate specs: the setup and card helpers their files share.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import Page from '../../../routes/roster/+page.svelte';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
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
import { cleanupClearResetAdmin, setAuthedWithOneCollective } from '$lib/testing/pages/roster';

export const rosterTwo = [
	{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: 'db-1' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com', sectionIds: [], dbEntityId: 'db-1' }
];

export async function renderRosterAs(admin: 'admin' | 'not-admin') {
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

export async function openCard(container: HTMLElement, memberId: string) {
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

export function useRosterDeactivatePage(): void {
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

	afterEach(cleanupClearResetAdmin);
}

// (*MVOX:Tallis*) (*MVOX:Josquin*)
