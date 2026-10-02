// @vitest-environment happy-dom
// Section create paths drop a parent id kept across a collective switch.
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
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: [], dbEntityId: ORG_A, ownerIds: ['person-p'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: 'bea@x.com', sectionIds: [], dbEntityId: ORG_A, ownerIds: ['person-p'] }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: [], dbEntityId: ORG_B, ownerIds: ['person-q'] }
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
	createInviteMock.mockResolvedValue({ inviteId: 'inv-1', url: 'https://x.invalid/i/1' });
	mintSelfLinkInviteMock.mockResolvedValue({ inviteId: 'inv-2', url: 'https://x.invalid/i/2' });
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
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

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function createStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-create-status')?.textContent ?? '').trim();
}

function removeStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-remove-status')?.textContent ?? '').trim();
}

function renameStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-rename-status')?.textContent ?? '').trim();
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
	expect(q(container, 'arrange-row-sec-alto')).toBeNull();
}

async function renderGroupsRoster(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'section-toggle-unassigned')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-toggle-unassigned') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-row-m-ada')).not.toBeNull();
	});
	return container;
}

async function switchToOtherChoirGroups(container: HTMLElement) {
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

async function openPageCreateForm(container: HTMLElement, name: string) {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
	await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
		target: { value: name }
	});
}

async function failedAssign(container: HTMLElement, memberId: string, sectionId: string) {
	await fireEvent.click(q(container, `section-picker-add-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `section-picker-select-${memberId}-blank`)).not.toBeNull();
	});
	await fireEvent.change(q(container, `section-picker-select-${memberId}-blank`) as HTMLElement, {
		target: { value: sectionId }
	});
}

describe('/roster — #299 CLASS B: the retained page-create parent id (synchronous — no race required)', () => {
	it("LYING PARENT: submitting after a collective switch must never send the PREVIOUS collective's section id as parentId — the select displays 'top level' while the variable still holds A's node", async () => {
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Chorus');
		const parentSelect = q(container, 'roster-new-section-parent') as HTMLSelectElement;
		await fireEvent.change(parentSelect, { target: { value: 'sec-sop' } });
		expect(parentSelect.value).toBe('sec-sop');

		await switchToOtherChoirArrange(container);

		const submit = q(container, 'roster-new-section-submit');
		if (submit) {
			await fireEvent.click(submit);
			await flush();
		}

		for (const call of createMock.mock.calls) {
			const input = call[1] as { name: string; parentId: string | null };
			expect(
				[null, 'sec-b1', 'sec-b2'],
				`createSection was handed parentId ${JSON.stringify(input.parentId)} — a section id from the collective the admin is no longer looking at`
			).toContain(input.parentId);
		}
	});

	it('the open create form does not survive the switch — pageCreateOpen, pageCreateName and pageCreateParentId all clear together (PO ruling)', async () => {
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Draft name');
		await fireEvent.change(q(container, 'roster-new-section-parent') as HTMLSelectElement, {
			target: { value: 'sec-sop' }
		});

		await switchToOtherChoirArrange(container);

		expect(
			q(container, 'roster-new-section-form'),
			"the form opened on A must not still be open on B — its typed name and retained parent belong to a tree that is no longer on screen"
		).toBeNull();
		expect(q(container, 'roster-new-section')).not.toBeNull();
	});
});

describe('/roster — #299 CLASS A: submitPageCreate has no collective-switch guard at all', () => {
	it("STALE SETTLE: A's page-level create resolving after the switch must not insert into B's tree, and announces nothing", async () => {
		const gate = deferred<string>();
		createMock.mockImplementationOnce(() => gate.promise);
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Chorus');
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		gate.resolve('sec-created');
		await flush();

		expect(
			q(container, 'arrange-row-sec-created'),
			"a section created on collective A must not appear in collective B's tree"
		).toBeNull();
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
		expect(createStatusText(container)).toBe('');
	});

	it("STALE FAILURE: A's page-level create rejecting after the switch must not render a create error on B", async () => {
		const gate = deferred<string>();
		createMock.mockImplementationOnce(() => gate.promise);
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Chorus');
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
		await waitFor(() => {
			expect(createMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		gate.reject(new Error('boom'));
		await flush();

		expect(
			q(container, 'roster-new-section-error'),
			"a create that failed on collective A must not put a failure alert on collective B's screen"
		).toBeNull();
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
});

describe('/roster — #299/#470: sectionWriteError clears on a collective switch', () => {
	it('an assign failure from a previous visit must not still be on screen after leaving and returning', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		assignMock.mockRejectedValueOnce(new Error('boom-a'));
		const container = await renderGroupsRoster();

		await failedAssign(container, 'm-ada', 'sec-sop');
		await waitFor(() => {
			expect(q(container, 'section-write-error-m-ada')).not.toBeNull();
		});
		consoleSpy.mockRestore();

		await switchToOtherChoirGroups(container);
		selectedCollectiveDbStore.set('sampledb');
		await waitFor(() => {
			expect(q(container, 'section-toggle-sec-sop')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-toggle-unassigned') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});

		expect(
			q(container, 'section-write-error-m-ada'),
			'an assign failure from a previous visit to this collective must not resurface after a round-trip switch'
		).toBeNull();
	});
});

describe('/roster — #299/#470 F3: a section write that SETTLES after the switch touches nothing of the new collective', () => {

	async function failBobOnB(container: HTMLElement) {
		assignMock.mockRejectedValueOnce(new Error('boom-b'));
		await failedAssign(container, 'm-bob', 'sec-b1');
		await waitFor(() => {
			expect(q(container, 'section-write-error-m-bob')).not.toBeNull();
		});
	}

	async function renderWithAdaInSoprano(): Promise<HTMLElement> {
		loadRosterMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(
				toListRead(
					cfg.db === 'sampledb'
						? [{ ...rowsA()[0], sectionIds: ['sec-sop'] }, rowsA()[1]]
						: rowsB()
				)
			)
		);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'section-toggle-sec-sop')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-toggle-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});
		return container;
	}

	it("ASSIGN: a refused assign from collective A, settling on B, must not wipe B's own failure banner", async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const gate = deferred();
		assignMock.mockImplementationOnce(() => gate.promise);
		const container = await renderGroupsRoster();

		await failedAssign(container, 'm-ada', 'sec-sop'); // held by the gate
		await waitFor(() => {
			expect(assignMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await failBobOnB(container);

		gate.reject(new Error('boom-a'));
		await flush();

		expect(
			q(container, 'section-write-error-m-bob'),
			"A's late assign failure must not take B's own banner off the screen"
		).not.toBeNull();
		expect(q(container, 'section-write-error-m-ada')).toBeNull();
		consoleSpy.mockRestore();
	});

	it("UNASSIGN: a refused unassign from collective A, settling on B, must not wipe B's own failure banner", async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const gate = deferred();
		unassignMock.mockImplementationOnce(() => gate.promise);
		const container = await renderWithAdaInSoprano();

		await fireEvent.change(
			q(container, 'section-picker-select-m-ada-sec-sop') as HTMLElement,
			{ target: { value: '' } }
		);
		await waitFor(() => {
			expect(unassignMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await failBobOnB(container);

		gate.reject(new Error('boom-a'));
		await flush();

		expect(
			q(container, 'section-write-error-m-bob'),
			"A's late unassign failure must not take B's own banner off the screen"
		).not.toBeNull();
		expect(q(container, 'section-write-error-m-ada')).toBeNull();
		consoleSpy.mockRestore();
	});

	it("MOVE: a refused move from collective A, settling on B, must not wipe B's own failure banner", async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const gate = deferred();
		assignMock.mockImplementationOnce(() => gate.promise);
		const container = await renderWithAdaInSoprano();

		await fireEvent.change(
			q(container, 'section-picker-select-m-ada-sec-sop') as HTMLElement,
			{ target: { value: 'sec-alto' } }
		);
		await waitFor(() => {
			expect(assignMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await failBobOnB(container);

		gate.reject(new Error('boom-a'));
		await flush();

		expect(
			q(container, 'section-write-error-m-bob'),
			"A's late move failure must not take B's own banner off the screen"
		).not.toBeNull();
		expect(q(container, 'section-write-error-m-ada')).toBeNull();
		expect(unassignMock).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

describe('/roster — #299 status regions clear on a collective switch (PO amendment)', () => {

	it("pageCreateStatus: A's create announcement is not still in the region after switching to B", async () => {
		const container = await renderInArrangeMode();

		await openPageCreateForm(container, 'Chorus');
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
		await waitFor(() => {
			expect(createStatusText(container)).toContain('roster_section_created');
		});

		await switchToOtherChoirArrange(container);

		expect(
			createStatusText(container),
			"'Chorus created' is a fact about collective A — rendered without context inside B it reads as a fact about B"
		).toBe('');
	});

	it("removeStatus: A's removal announcement is not still in the region after switching to B", async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(removeStatusText(container)).toContain('roster_section_removed');
		});

		await switchToOtherChoirArrange(container);

		expect(
			removeStatusText(container),
			"'Tenor removed' is a fact about collective A — rendered without context inside B it reads as a fact about B"
		).toBe('');
	});

	it("renameStatus: A's rename announcement is not still in the region after switching to B", async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'arrange-rename-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-sop')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'arrange-rename-input-sec-sop') as HTMLElement, {
			target: { value: 'Sopranos' }
		});
		await fireEvent.keyDown(q(container, 'arrange-rename-input-sec-sop') as HTMLElement, {
			key: 'Enter'
		});
		await waitFor(() => {
			expect(renameStatusText(container)).toContain('roster_section_renamed');
		});

		await switchToOtherChoirArrange(container);

		expect(
			renameStatusText(container),
			"'Sopranos renamed' is a fact about collective A — rendered without context inside B it reads as a fact about B"
		).toBe('');
	});
});

describe("/roster — #299 handleRemoveSection's terminal failure writes", () => {
	it("a wrong-collective removal-failure banner cannot appear: A's remove rejecting after the switch renders no section-remove-error on B", async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		gate.reject(new Error('boom'));
		await flush();

		expect(
			q(container, 'section-remove-error'),
			"a removal that failed on collective A must not put a failure alert on collective B's screen"
		).toBeNull();
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-tenor')).toBeNull();
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina*)
