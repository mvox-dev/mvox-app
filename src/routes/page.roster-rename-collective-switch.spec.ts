// @vitest-environment happy-dom
// The rename state resets on a collective switch; a late result is dropped.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
}));

const {
	loadRosterMock,
	listSectionsMock,
	assignMock,
	unassignMock,
	createMock,
	reorderMock,
	deleteMock,
	reparentMock,
	renameMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn(),
	renameMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock,
	reparentSection: reparentMock,
	renameSection: renameMock
}));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: createInviteMock,
	mintSelfLinkInvite: mintSelfLinkInviteMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function treeA(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

function treeB(): SectionNode[] {
	return [
		{ id: 'sec-b1', name: 'Bass I', displayOrder: 1, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] },
		{ id: 'sec-b2', name: 'Bass II', displayOrder: 2, parentId: null, dbEntityId: ORG_B, depth: 0, children: [] }
	];
}

function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: 'bea@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B }
	];
}

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p', 'other-choir': 'person-q' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

beforeEach(() => {
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
});

afterEach(() => {
	cleanup();
	renameMock.mockReset();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function renameStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-rename-status')?.textContent ?? '').trim();
}

function anyRenameErrorAlert(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-error-"]');
}

function anyRenameInput(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid^="arrange-rename-input-"]');
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function renderInArrangeMode(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

async function switchToOtherChoirArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-sop')).toBeNull();
}

async function switchBackToSampledbArrange(container: HTMLElement) {
	selectedCollectiveDbStore.set('sampledb');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-sop')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-b1')).toBeNull();
}

async function openRename(container: HTMLElement, sectionId: string, newName: string) {
	await fireEvent.click(q(container, `arrange-rename-${sectionId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `arrange-rename-input-${sectionId}`)).not.toBeNull();
	});
	const input = q(container, `arrange-rename-input-${sectionId}`) as HTMLInputElement;
	await fireEvent.input(input, { target: { value: newName } });
	return input;
}

async function submitHeldRename(
	container: HTMLElement,
	sectionId: string,
	newName: string,
	nthWrite: number
) {
	const input = await openRename(container, sectionId, newName);
	await fireEvent.keyDown(input, { key: 'Enter' });
	await waitFor(() => {
		expect(renameMock).toHaveBeenCalledTimes(nthWrite);
	});
	expect(q(container, `arrange-rename-input-${sectionId}`)).toBeNull();
}

describe('/roster — #297 rename settle across a collective switch', () => {
	it("CROSS-COLLECTIVE ANNOUNCEMENT: A's rename SUCCESS settling after the switch leaves roster-section-rename-status EMPTY — it must not name A's section into B's live region", async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		gate.resolve();
		await flush();

		expect(renameStatusText(container)).toBe('');
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
	});

	it("STALE DISABLE: with collective A's rename WRITE still in flight, collective B's structural controls render ENABLED from load — A's unresolved write is not B's business", async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);

		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-indent-sec-b2') as HTMLButtonElement).disabled,
			"B's indent control must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			q(container, 'arrange-row-sec-b1')?.getAttribute('draggable'),
			"B's rows must be draggable — no structural write is in flight HERE"
		).toBe('true');

		gate.resolve();
		await flush();
	});

	it("CROSS-COLLECTIVE ERROR: A's rename REJECTING after the switch paints no rename-failure alert — not on B, and not on A after switching back", async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		gate.reject(new Error('403'));
		await flush();
		await flush(); // catch → refetch (one more microtask hop) → guards

		expect(
			anyRenameErrorAlert(container),
			'no rename-failure alert may render against collective B'
		).toBeNull();
		expect(renameStatusText(container)).toBe('');
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();

		await switchBackToSampledbArrange(container);
		expect(
			anyRenameErrorAlert(container),
			"a superseded rename failure must not resurface on A's row after switching back"
		).toBeNull();
	});
});

describe('/roster — #297/#303 rename state across a collective switch: settled failures clear, open edits commit', () => {
	it('CLEARED ON SWITCH (renameError): a rename failure fully settled ON A does not resurface on its row after a round-trip through B', async () => {
		renameMock.mockRejectedValueOnce(new Error('403'));
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-error-sec-alto')).not.toBeNull();
		});

		await switchToOtherChoirArrange(container);
		expect(anyRenameErrorAlert(container)).toBeNull();

		await switchBackToSampledbArrange(container);
		expect(
			q(container, 'arrange-rename-error-sec-alto'),
			'a rename failure from before the switch must not survive it'
		).toBeNull();
	});

	it('#303 COMMITTED ON SWITCH (renamingSectionId/renameValue): an OPEN rename abandoned at switch time commits ONCE to the outgoing collective, and no editor re-mounts after a round-trip through B', async () => {
		const container = await renderInArrangeMode();

		await openRename(container, 'sec-alto', 'Half-typed');

		await switchToOtherChoirArrange(container);
		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(
			{ db: 'sampledb', token: 'jwt-abc' },
			'sec-alto',
			'Half-typed'
		);
		expect(anyRenameInput(container)).toBeNull();

		await switchBackToSampledbArrange(container);
		expect(
			anyRenameInput(container),
			'a committed rename must not leave the editor armed across a collective round-trip'
		).toBeNull();
		expect(q(container, 'arrange-row-sec-alto')).not.toBeNull();
		expect(renameMock).toHaveBeenCalledTimes(1);
	});
});

describe('/roster — #297 late settle vs a live write, and the focus contract', () => {
	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new rename has started on B — B's controls stay frozen, nothing announces A, and B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		renameMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must be enabled after the switch"
		).toBe(false);

		await submitHeldRename(container, 'sec-b1', 'Bass Uno', 2);
		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's own write is in flight — its structural controls are frozen"
		).toBe(true);

		gateA.resolve();
		await flush();

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's write is STILL in flight — structural controls stay frozen"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b2')?.getAttribute('draggable')).toBe('false');
		expect(renameStatusText(container)).toBe('');

		await fireEvent.click(q(container, 'arrange-rename-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-b2')).not.toBeNull();
		});
		const probeInput = q(container, 'arrange-rename-input-sec-b2') as HTMLInputElement;
		await fireEvent.input(probeInput, { target: { value: 'Bass Due' } });
		await fireEvent.keyDown(probeInput, { key: 'Enter' });
		await flush();
		expect(renameMock).toHaveBeenCalledTimes(2);
		expect(
			(q(container, 'arrange-rename-input-sec-b2') as HTMLInputElement)?.value,
			'the refused rename stays open — its text is not discardable'
		).toBe('Bass Due');
		await fireEvent.keyDown(probeInput, { key: 'Escape' });
		await waitFor(() => {
			expect(anyRenameInput(container)).toBeNull();
		});

		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled).toBe(false);
		});
		expect((q(container, 'arrange-rename-sec-b2') as HTMLButtonElement).disabled).toBe(false);
		expect(renameStatusText(container)).toContain('roster_section_renamed');
		expect(renameStatusText(container)).toContain('Bass Uno');
		expect(renameStatusText(container)).not.toContain('Contralto');
		expect(q(container, 'arrange-rename-sec-b1')?.textContent).toContain('Bass Uno');
		expect(renameMock).toHaveBeenCalledTimes(2);
	});

	it('FOCUS ON A SUPERSEDED SETTLE: the settle still lands focus on the rename trigger — and still announces NOTHING (gate the flag write, not the finally block)', async () => {
		const gate = deferred();
		renameMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await submitHeldRename(container, 'sec-alto', 'Contralto', 1);
		await switchToOtherChoirArrange(container);
		await switchBackToSampledbArrange(container);

		gate.resolve();
		await flush();

		expect(renameStatusText(container)).toBe('');
		await waitFor(() => {
			expect(document.activeElement?.getAttribute('data-testid')).toBe(
				'arrange-rename-sec-alto'
			);
		});
		expect(document.activeElement).not.toBe(document.body);
	});
});

// (*MVOX:Tallis*)
