// @vitest-environment happy-dom
// Section create paths drop a parent id kept across a collective switch.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/sections/sectionActions', async () =>
	(await import('$lib/testing/mocks/sections')).sectionActionsModule(['reparent', 'rename'])
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule()
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: false })
);
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
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

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { adminStore } from '$lib/nav/adminStore';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { createInviteMock, mintSelfLinkInviteMock } from '$lib/testing/mocks/admin';
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
	deleteMock,
	renameMock,
	reorderMock,
	reparentMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import { ORG_A, ORG_B, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
import {
	cleanupClearResetAdmin,
	flush,
	removeStatusText,
	renameStatusText,
	setAuthedWithTwoCollectives,
	switchToOtherChoirArrange,
	switchToOtherChoirGroups
} from '$lib/testing/pages/roster';
import { renderGroupsRoster, renderInArrangeMode } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

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

afterEach(cleanupClearResetAdmin);

function createStatusText(container: HTMLElement): string {
	return (q(container, 'roster-section-create-status')?.textContent ?? '').trim();
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

// (*MVOX:Tallis*) (*MVOX:Palestrina*)
