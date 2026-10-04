// Roster page harness: auth, queries and hooks its specs had word for word.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { expect, vi } from 'vitest';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { resetAdmin } from '$lib/nav/adminStore';
import { resetAppState } from '$lib/testing/appReset';
import { testCfg } from '$lib/testing/entuFetchKit';
import { toListRead } from '$lib/testing/listReadFixtures';
import {
	deactivateMemberMock,
	listDeactivateBlockersMock,
	listInactiveMembersMock,
	loadInactiveRosterMock,
	loadRosterMock,
	reinstateMemberMock
} from '$lib/testing/mocks/roster';
import {
	assignMock,
	createMock,
	createSectionMock,
	deleteMock,
	renameMock,
	reorderMock,
	reparentMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { signIn } from '$lib/testing/session';
import { q } from './dom';
import { fixtureRows, liveShapedTree, ORG_EFK, rowsA, rowsB, treeA, treeB } from './rosterFixtures';

export const CFG = testCfg('sampledb', 'jwt-abc');

export { JSON_HEADERS } from './event';

export const flush = () => new Promise((r) => setTimeout(r, 0));

export function setAuthedWithOneCollective() {
	signIn();
}

export function setAuthed() {
	signIn();
}

export function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		]
	});
}

export function renameStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-rename-status')?.textContent ?? '').trim();
}

export function removeStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-remove-status')?.textContent ?? '').trim();
}

export async function typeName(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
		target: { value }
	});
}

export async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
}

export async function openCard(container: HTMLElement, memberId: string) {
	const li = q(container, `roster-row-${memberId}`);
	expect(li, `roster-row-${memberId} must render`).not.toBeNull();
	if (li!.querySelector('[data-testid="roster-record-name"]')) return; // already open
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `#302: collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card as HTMLElement);
	await waitFor(() => {
		expect(
			q(container, `roster-row-${memberId}`)!.querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull();
	});
}

export async function switchToOtherChoirGroups(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => {
		expect(q(container, 'section-toggle-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'section-toggle-sec-sop')).toBeNull();
	await fireEvent.click(q(container, 'section-toggle-unassigned') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-row-m-bob')).not.toBeNull();
	});
}

export async function switchToOtherChoirArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-alto')).toBeNull();
}

export async function switchBackToSampledbArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('sampledb');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-sop')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-b1')).toBeNull();
}

export function anyRenameInput(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-input-"]');
}

export function anyRenameErrorAlert(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-error-"]');
}

export function cleanupResetRosterReads(): void {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	resetAppState();
}

export function cleanupResetCreateSectionMocks(): void {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createSectionMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resetAppState();
	resetAdmin();
}

export function cleanupUnstubResetRoster(): void {
	cleanup();
	vi.unstubAllGlobals();
	loadRosterMock.mockReset();
	resetAppState();
	resetAdmin();
}

export function cleanupResetArrangeMocks(): void {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	resetAppState();
	resetAdmin();
}

export function cleanupResetReparentMocks(): void {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	reparentMock.mockReset();
	resetAppState();
	resetAdmin();
}

export function cleanupResetRenameMocks(): void {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	reparentMock.mockReset();
	renameMock.mockReset();
	resetAppState();
	resetAdmin();
}

export function cleanupClearResetAdmin(): void {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
}

export function seedCreateSectionMocks(): void {
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue(liveShapedTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
}

export function seedTwoCollectiveMocks(): void {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsB()))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
	renameMock.mockResolvedValue(undefined);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
}

export function setNoCollective() {
	signIn({ collectives: [] });
}

// (*MVOX:Josquin*)
