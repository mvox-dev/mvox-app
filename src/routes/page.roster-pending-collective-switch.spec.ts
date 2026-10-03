// @vitest-environment happy-dom
// Roster remove and deactivate pending flags reset on a collective switch.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

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
	mintSelfLinkInviteMock,
	loadMemberRecordMock
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
	mintSelfLinkInviteMock: vi.fn(),
	loadMemberRecordMock: vi.fn()
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
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: loadMemberRecordMock
}));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		]
	});
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
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function removeStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-remove-status')?.textContent ?? '').trim();
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

async function startHeldRemoveOnA(container: HTMLElement) {
	await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
	await waitFor(() => {
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});
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

async function openCard(container: HTMLElement, memberId: string) {
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

async function startHeldDeactivate(container: HTMLElement, memberId: string, nthWrite: number) {
	await openCard(container, memberId);
	await fireEvent.click(q(container, `member-deactivate-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `member-deactivate-confirm-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `member-deactivate-confirm-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(deactivateMemberMock).toHaveBeenCalledTimes(nthWrite);
	});
}

describe('/roster — #287 removePending across a collective switch', () => {
	it("STALE DISABLE: with collective A's delete WRITE still in flight, collective B's structural controls render ENABLED from load — A's unresolved write is not B's business", async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);

		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's in-flight write"
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

	it("CROSS-COLLECTIVE ANNOUNCEMENT: A's delete SUCCESS settling after the switch leaves roster-section-remove-status EMPTY — it must not name A's section into B's live region", async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);
		await switchToOtherChoirArrange(container);

		gate.resolve();
		await flush();

		expect(removeStatusText(container)).toBe('');
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
	});

	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new delete has started on B — B's armed pair stays mounted, stays disabled, and B's write cannot double-fire", async () => {
		const gateA = deferred();
		const gateB = deferred();
		deleteMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);
		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must be enabled after the switch"
		).toBe(false);

		await fireEvent.click(q(container, 'section-remove-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-b2')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(2);
		});

		gateA.resolve();
		await flush();

		const confirmB = q(container, 'section-remove-confirm-sec-b2') as HTMLButtonElement | null;
		expect(confirmB, "B's armed pair must survive A's stale settle").not.toBeNull();
		expect(confirmB!.disabled, "B's write is STILL in flight — confirm stays disabled").toBe(true);
		expect(confirmB!.getAttribute('aria-busy')).toBe('true');
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's structural controls stay frozen while B's own write is in flight"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b1')?.getAttribute('draggable')).toBe('false');
		expect(removeStatusText(container)).toBe('');

		await fireEvent.click(confirmB!);
		confirmB!.click();
		await flush();
		expect(deleteMock).toHaveBeenCalledTimes(2);

		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(removeStatusText(container)).toContain('roster_section_removed');
		expect(removeStatusText(container)).toContain('Bass II');
		expect(removeStatusText(container)).not.toContain('Tenor');
		expect(deleteMock).toHaveBeenCalledTimes(2);
	});
});

describe('/roster — #287 deactivatePending across a collective switch', () => {
	it("STALE DISABLE: with collective A's deactivate WRITE still in flight, collective B's deactivate trigger renders ENABLED from load", async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const container = await renderGroupsRoster();

		await startHeldDeactivate(container, 'm-ada', 1);
		await switchToOtherChoirGroups(container);
		await openCard(container, 'm-bob');

		expect(
			(q(container, 'member-deactivate-m-bob') as HTMLButtonElement).disabled,
			"B's deactivate trigger must not be disabled by A's in-flight write"
		).toBe(false);

		gate.resolve();
		await flush();
	});

	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new deactivate has started on B — B's armed pair stays mounted, disabled and aria-busy; no double-fire; B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		deactivateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderGroupsRoster();

		await startHeldDeactivate(container, 'm-ada', 1);
		await switchToOtherChoirGroups(container);
		await openCard(container, 'm-bob');

		expect(
			(q(container, 'member-deactivate-m-bob') as HTMLButtonElement).disabled,
			"B's deactivate trigger must be enabled after the switch"
		).toBe(false);

		await startHeldDeactivate(container, 'm-bob', 2);

		gateA.resolve();
		await flush();

		const confirmB = q(container, 'member-deactivate-confirm-m-bob') as HTMLButtonElement | null;
		expect(confirmB, "B's armed pair must survive A's stale settle").not.toBeNull();
		expect(confirmB!.disabled, "B's write is STILL in flight — confirm stays disabled").toBe(true);
		expect(confirmB!.getAttribute('aria-busy')).toBe('true');
		expect(
			(q(container, 'member-deactivate-cancel-m-bob') as HTMLButtonElement).disabled
		).toBe(true);

		await fireEvent.click(confirmB!);
		confirmB!.click();
		await flush();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(2);

		loadRosterMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : []))
		);
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect(q(container, 'roster-row-m-bob')).toBeNull();
		});
		expect(q(container, 'member-deactivate-confirm-m-bob')).toBeNull();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(2);
	});
});

// (*MVOX:Tallis*)
