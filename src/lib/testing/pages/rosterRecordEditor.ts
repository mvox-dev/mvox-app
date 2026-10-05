// Roster record editor specs: the setup and field locators their files share.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect } from 'vitest';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	createMemberRecordMock,
	deactivateMemberMock,
	listDeactivateBlockersMock,
	listInactiveMembersMock,
	loadInactiveRosterMock,
	loadMemberRecordMock,
	loadRosterMock,
	reinstateMemberMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { rosterTwo } from '$lib/testing/pages/rosterFixtures';
import { cleanupClearResetAdmin } from '$lib/testing/pages/roster';

export const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

export async function openEditor(container: HTMLElement, memberId: string) {
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `#302: collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card!);
	await waitFor(() => {
		const li = q(container, `roster-row-${memberId}`)!;
		expect(li.querySelector('[data-testid="roster-record-name"]')).not.toBeNull();
	});
}

export const nameInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-name"]') as HTMLInputElement;

export const phoneInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-phone"]') as HTMLInputElement;

export const emailInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-email"]') as HTMLInputElement;

export const birthdateInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-birthdate"]') as HTMLInputElement;

export const idCodeInput = (c: HTMLElement) =>
	c.querySelector('[data-testid="roster-record-id-code"]') as HTMLInputElement;

export function useRecordEditorPage(): void {
	beforeEach(() => {
		loadRosterMock.mockResolvedValue(toListRead(rosterTwo));
		listSectionsMock.mockResolvedValue([]);
		listDeactivateBlockersMock.mockResolvedValue([]);
		deactivateMemberMock.mockResolvedValue(undefined);
		reinstateMemberMock.mockResolvedValue(undefined);
		loadInactiveRosterMock.mockResolvedValue(toListRead([]));
		listInactiveMembersMock.mockResolvedValue(toListRead([]));
		loadMemberRecordMock.mockResolvedValue({ state: 'none' });
		createMemberRecordMock.mockResolvedValue('rec-new');
		updateMemberRecordMock.mockResolvedValue(undefined);
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'pr-priv', name: 'Secret Private Name', email: 'berta@example.com', _sharing: 'private' },
			{ _id: 'pr-dom', name: 'Berta Bass', email: 'berta@example.com', _sharing: 'domain' }
		]);
	});

	afterEach(cleanupClearResetAdmin);
}

// (*MVOX:Tallis*) (*MVOX:Josquin*)
