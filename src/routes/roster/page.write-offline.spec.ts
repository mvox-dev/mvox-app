// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const h = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	loadActiveAndArchivedRostersMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createSectionMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteSectionMock: vi.fn(),
	reparentMock: vi.fn(),
	renameMock: vi.fn(),
	loadMemberRecordMock: vi.fn(),
	createMemberRecordMock: vi.fn(),
	updateMemberRecordMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn(),
	withdrawInviteMock: vi.fn(),
	listJoinStateDetailsMock: vi.fn(),
	resolveOwnerTierMock: vi.fn()
}));

vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: h.deactivateMemberMock,
	reinstateMember: h.reinstateMemberMock,
	loadInactiveRoster: h.loadInactiveRosterMock,
	loadActiveAndArchivedRosters: h.loadActiveAndArchivedRostersMock,
	listInactiveMembers: h.listInactiveMembersMock,
	listDeactivateBlockers: h.listDeactivateBlockersMock
}));
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: h.loadMemberRecordMock,
	createMemberRecord: h.createMemberRecordMock,
	updateMemberRecord: h.updateMemberRecordMock
}));
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: h.assignMock,
	unassignMemberSection: h.unassignMock,
	createSection: h.createSectionMock,
	reorderSections: h.reorderMock,
	deleteSection: h.deleteSectionMock,
	reparentSection: h.reparentMock,
	renameSection: h.renameMock
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	mintSelfLinkInvite: h.mintSelfLinkInviteMock,
	withdrawInvite: h.withdrawInviteMock
}));
vi.mock('$lib/profile/linkedIdentities', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/linkedIdentities')>()),
	listJoinStateDetails: h.listJoinStateDetailsMock
}));
vi.mock('$lib/nav/adminStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/nav/adminStore')>()),
	resolveOwnerTier: h.resolveOwnerTierMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	isWriteDisabled,
	expectVisibleReason,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock } from '$lib/testing/moduleHandles';

const REASON = '[write_unavailable_no_signal]';

const ROWS = [
	{
		memberId: 'm1',
		personId: 'person-p',
		name: 'Alice Alto',
		email: 'alice@example.com',
		sectionIds: [],
		ownerIds: ['person-p'],
		dbEntityId: 'db-1'
	},
	{
		memberId: 'm2',
		personId: 'pp-2',
		name: 'Berta Bass',
		email: 'berta@example.com',
		sectionIds: [],
		ownerIds: ['person-p'],
		dbEntityId: 'db-1'
	}
];

function fixtureTree(): SectionNode[] {
	return [
		{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, dbEntityId: 'db-1', depth: 0, children: [] },
		{ id: 'sec-bass', name: 'Bass', displayOrder: 2, parentId: null, dbEntityId: 'db-1', depth: 0, children: [] }
	];
}

function setAuthed() {
	signIn();
}

beforeEach(async () => {
	for (const mock of Object.values(h)) mock.mockReset();
	h.loadRosterMock.mockResolvedValue(toListRead(ROWS));
	h.loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	h.loadActiveAndArchivedRostersMock.mockImplementation(async (cfg: unknown) => ({
		active: await h.loadRosterMock(cfg),
		inactive: await h.loadInactiveRosterMock(cfg)
	}));
	h.listInactiveMembersMock.mockResolvedValue(toListRead([]));
	h.listDeactivateBlockersMock.mockResolvedValue([]);
	h.deactivateMemberMock.mockResolvedValue(undefined);
	h.reinstateMemberMock.mockResolvedValue(undefined);
	listSectionsMock.mockResolvedValue(fixtureTree());
	h.assignMock.mockResolvedValue(undefined);
	h.unassignMock.mockResolvedValue(undefined);
	h.createSectionMock.mockResolvedValue('sec-created');
	h.reorderMock.mockResolvedValue(undefined);
	h.deleteSectionMock.mockResolvedValue(undefined);
	h.reparentMock.mockResolvedValue(undefined);
	h.renameMock.mockResolvedValue(undefined);
	h.loadMemberRecordMock.mockResolvedValue({ state: 'none' });
	h.createMemberRecordMock.mockResolvedValue(undefined);
	h.updateMemberRecordMock.mockResolvedValue(undefined);
	h.mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: 'tok' });
	h.withdrawInviteMock.mockResolvedValue(undefined);
	h.resolveOwnerTierMock.mockResolvedValue('owner');
	h.listJoinStateDetailsMock.mockResolvedValue({
		'person-p': { state: 'linked' },
		'pp-2': { state: 'absent' }
	});
	await goOnline();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
	resetOnLine();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function recordNameInput(container: HTMLElement): HTMLInputElement {
	const node = container.querySelector('[data-testid="roster-record-name"]');
	expect(node, 'the record editor must be open').not.toBeNull();
	const input = (node!.tagName === 'INPUT' ? node : node!.querySelector('input')) as
		| HTMLInputElement
		| null;
	expect(input, 'roster-record-name must resolve to an <input>').not.toBeNull();
	return input!;
}

function noWriteSeamCalled() {
	expect(h.deactivateMemberMock).not.toHaveBeenCalled();
	expect(h.reinstateMemberMock).not.toHaveBeenCalled();
	expect(h.createMemberRecordMock).not.toHaveBeenCalled();
	expect(h.updateMemberRecordMock).not.toHaveBeenCalled();
	expect(h.assignMock).not.toHaveBeenCalled();
	expect(h.unassignMock).not.toHaveBeenCalled();
	expect(h.createSectionMock).not.toHaveBeenCalled();
	expect(h.reorderMock).not.toHaveBeenCalled();
	expect(h.deleteSectionMock).not.toHaveBeenCalled();
	expect(h.reparentMock).not.toHaveBeenCalled();
	expect(h.renameMock).not.toHaveBeenCalled();
	expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	expect(h.withdrawInviteMock).not.toHaveBeenCalled();
}

async function renderMemberSurface() {
	setAuthed();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'section-toggle-unassigned')).not.toBeNull());
	await fireEvent.click(q(container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(container, 'roster-row-m2')).not.toBeNull());
	await fireEvent.click(q(container, 'roster-row-card-m2')!);
	await waitFor(() => expect(q(container, 'roster-record-save')).not.toBeNull());
	return container;
}

async function renderArrangeSurface() {
	setAuthed();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'roster-view-chip-arrange')).not.toBeNull());
	await fireEvent.click(q(container, 'roster-view-chip-arrange')!);
	await waitFor(() => expect(q(container, 'arrange-rename-sec-alto')).not.toBeNull());
	return container;
}

describe('/roster — the member surface while offline (#434 slice 6 review F1)', () => {
	it('offline: the record save, the invite control and the deactivate arm are disabled, reason visible once', async () => {
		const container = await renderMemberSurface();
		expect(isWriteDisabled(q(container, 'roster-record-save')!)).toBe(false);
		await goOffline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'roster-record-save')!)).toBe(true);
		});
		const invite = q(container, 'roster-member-invite-m2');
		expect(invite, 'the owner-tier invite control must render').not.toBeNull();
		expect(isWriteDisabled(invite!)).toBe(true);
		const deactivate = q(container, 'member-deactivate-m2');
		if (deactivate) expect(isWriteDisabled(deactivate)).toBe(true);
		expectVisibleReason(container, 'roster-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="roster-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: a typed member record does not save and is not discarded', async () => {
		const container = await renderMemberSurface();
		const nameInput = recordNameInput(container);
		await fireEvent.input(nameInput, { target: { value: 'Berta B.' } });
		await goOffline();

		await fireEvent.click(q(container, 'roster-record-save')!);
		await settle();

		expect(h.createMemberRecordMock).not.toHaveBeenCalled();
		expect(h.updateMemberRecordMock).not.toHaveBeenCalled();
		expect(recordNameInput(container).value).toBe('Berta B.');
	});

	it('offline: operating every enabled control on the member surface calls no write seam', async () => {
		const container = await renderMemberSurface();
		await goOffline();
		await settle();
		for (const mock of Object.values(h)) mock.mockClear();

		const touched = await exerciseEveryEnabledControl(container);

		expect(touched.length).toBeGreaterThan(2);
		noWriteSeamCalled();
	});
});

describe('/roster — the arrange surface while offline (#434 slice 6 review F1)', () => {
	it('offline: rename, indent/unindent, remove and new-section are all disabled', async () => {
		const container = await renderArrangeSurface();
		expect(isWriteDisabled(q(container, 'arrange-rename-sec-alto')!)).toBe(false);
		await goOffline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'arrange-rename-sec-alto')!)).toBe(true);
		});
		for (const testid of [
			'arrange-indent-sec-bass',
			'arrange-unindent-sec-alto',
			'section-remove-sec-alto',
			'roster-new-section'
		]) {
			const el = q(container, testid);
			if (el) expect(isWriteDisabled(el), testid).toBe(true);
		}
		expectVisibleReason(container, 'roster-write-unavailable', REASON);
	});

	it('offline: a rename input open when the signal drops keeps its text and writes nothing', async () => {
		const container = await renderArrangeSurface();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto')!);
		const input = await waitFor(() => {
			const el = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el!;
		});
		await fireEvent.input(input, { target: { value: 'Aldid' } });
		await goOffline();

		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();

		expect(h.renameMock).not.toHaveBeenCalled();
		const still = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement | null;
		expect(still, 'a refusal is not a discard — the input stays open').not.toBeNull();
		expect(still!.value).toBe('Aldid');
	});

	it('offline: operating every enabled control on the arrange surface calls no write seam', async () => {
		const container = await renderArrangeSurface();
		await goOffline();
		await settle();
		for (const mock of Object.values(h)) mock.mockClear();

		const touched = await exerciseEveryEnabledControl(container, {
			skip: ['roster-view-chip-collapsed', 'roster-view-chip-expanded']
		});

		expect(touched.length).toBeGreaterThan(0);
		noWriteSeamCalled();
	});

	it('back online: the arrange controls enable again, the sentence goes, and a rename writes', async () => {
		const container = await renderArrangeSurface();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'arrange-rename-sec-alto')!)).toBe(false);
		});
		expect(q(container, 'roster-write-unavailable')).toBeNull();

		await fireEvent.click(q(container, 'arrange-rename-sec-alto')!);
		const input = await waitFor(() => {
			const el = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement | null;
			expect(el).not.toBeNull();
			return el!;
		});
		await fireEvent.input(input, { target: { value: 'Aldid' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => expect(h.renameMock).toHaveBeenCalledTimes(1));
	});
});

// (*MVOX:Josquin*)
