// @vitest-environment happy-dom
// #1049: each failed roster or section write shows its error and keeps one report, filed
// under the collective the write started in, even when it settles after a switch.
import { cleanup, fireEvent, render as renderPage, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule({ archived: true })
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal, { writes: true })
);
vi.mock('$lib/library/libraryRights', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
);
vi.mock('$lib/nav/dbRights', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).dbRightOverRealModule(importOriginal)
);
vi.mock('$lib/profile/linkedIdentities', async (importOriginal) => ({
	...((await importOriginal()) as object),
	listJoinStateDetails: async () => ({})
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

import type { RosterRow } from '$lib/roster/rosterData';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { selectedCollectiveDbStore, selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { resolveMyLibraryId, resolveLibraryEditRight } from '$lib/library/libraryRights';
import { MemberRecordPartialSaveError } from '$lib/roster/memberRecord';
import { resetAppState } from '$lib/testing/appReset';
import { deferred } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { resolveDbRightMock } from '$lib/testing/mocks/admin';
import {
	createMemberRecordMock,
	deactivateMemberMock,
	listDeactivateBlockersMock,
	loadActiveAndArchivedRostersMock,
	loadInactiveRosterMock,
	loadMemberRecordMock,
	loadRosterMock,
	reinstateMemberMock,
	updateMemberRecordMock
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
import { ORG_A, treeA } from '$lib/testing/pages/rosterFixtures';
import { renderInArrangeMode } from '$lib/testing/pages/rosterRender';
import { openCard, setAuthedWithTwoCollectives } from '$lib/testing/pages/roster';
import { dbEditRight, resetDbEditRight } from '$lib/nav/dbRights';
import { q } from '$lib/testing/pages/dom';
import Page from './roster/+page.svelte';

useKeptProblems();

// The background IndexedDB write must have had its chance before "nothing kept" means anything.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// B reuses A's ids, so a stale error keyed by id would show on B; only the names differ.
const B = (db: string) => (db === 'sampledb' ? '' : ' B');
const OWNERS = ['person-p', 'person-q'];
const rowsOf = (db: string): RosterRow[] => [
	{ memberId: 'm-ada', personId: 'p-ada', name: `Ada${B(db)}`, email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: ORG_A, ownerIds: OWNERS },
	{ memberId: 'm-bea', personId: 'p-bea', name: `Bea${B(db)}`, email: 'bea@x.com', sectionIds: [], dbEntityId: ORG_A, ownerIds: OWNERS }
];
const treeOf = (db: string) => treeA().map((n) => ({ ...n, name: `${n.name}${B(db)}`, ownerIds: OWNERS }));
const inactive = (db: string): RosterRow[] => [
	{ memberId: 'm-ina', personId: 'p-ina', name: `Ina${B(db)}`, email: 'ina@x.com', sectionIds: [], dbEntityId: ORG_A }
];
const oneRecord = {
	state: 'one',
	record: { _id: 'rec-ada', name: 'Ada Lovelace', phone: '', email: 'ada@x.com', birthdate: '', id_code: '' }
};

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(rowsOf(cfg.db)))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(treeOf(cfg.db))
	);
	for (const write of [assignMock, unassignMock, reorderMock, deleteMock, reparentMock, renameMock]) {
		write.mockResolvedValue(undefined);
	}
	createMock.mockResolvedValue('sec-created');
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(inactive(cfg.db)))
	);
	loadActiveAndArchivedRostersMock.mockImplementation(async (cfg: { db: string }) => ({
		active: await loadRosterMock(cfg),
		inactive: await loadInactiveRosterMock(cfg)
	}));
	listDeactivateBlockersMock.mockResolvedValue([]);
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
	vi.mocked(resolveLibraryEditRight).mockResolvedValue({ state: 'editor', libraryId: 'lib-1' });
	resolveDbRightMock.mockResolvedValue('owner');
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
	createMemberRecordMock.mockResolvedValue('rec-new');
	updateMemberRecordMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	resetAppState();
	resetDbEditRight();
});

async function click(c: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(q(c, id) as HTMLElement);
}

async function shown(c: HTMLElement, id: string): Promise<void> {
	await waitFor(() => expect(q(c, id)).not.toBeNull());
}

async function onB(c: HTMLElement): Promise<void> {
	await waitFor(() => expect(c.textContent).toContain('Alto B'));
}

async function renderGroupsRoster(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	dbEditRight.set('editor');
	const { container } = renderPage(Page);
	await shown(container, 'section-toggle-sec-sop');
	return container;
}

async function openGroup(c: HTMLElement, id: string, rowTestId: string): Promise<void> {
	const toggle = q(c, `section-toggle-${id}`) as HTMLElement;
	if (toggle.getAttribute('aria-expanded') !== 'true') await fireEvent.click(toggle);
	await shown(c, rowTestId);
}

async function pick(c: HTMLElement, select: string, value: string): Promise<void> {
	await fireEvent.change(q(c, select) as HTMLElement, { target: { value } });
}

async function moveSopranoDown(c: HTMLElement): Promise<void> {
	let target = q(c, 'arrange-row-sec-sop') as HTMLElement;
	target.focus();
	await fireEvent.keyDown(target, { key: 'Enter' });
	await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
	await fireEvent.keyDown(target, { key: 'ArrowDown' });
	target = q(c, 'arrange-row-sec-sop') as HTMLElement;
	await fireEvent.keyDown(target, { key: 'Enter' });
}

async function renameAlto(c: HTMLElement): Promise<void> {
	await click(c, 'arrange-rename-sec-alto');
	await shown(c, 'arrange-rename-input-sec-alto');
	const input = q(c, 'arrange-rename-input-sec-alto') as HTMLInputElement;
	await fireEvent.input(input, { target: { value: 'Altos' } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

async function createChorus(c: HTMLElement): Promise<void> {
	await click(c, 'roster-new-section');
	await fireEvent.input(q(c, 'roster-new-section-name') as HTMLElement, { target: { value: 'Chorus' } });
	await click(c, 'roster-new-section-submit');
}

async function armBea(c: HTMLElement): Promise<void> {
	await openGroup(c, 'unassigned', 'roster-row-m-bea');
	await openCard(c, 'm-bea');
	await click(c, 'member-deactivate-m-bea');
	await shown(c, 'member-deactivate-confirm-m-bea');
}

async function deactivateBea(c: HTMLElement): Promise<void> {
	await armBea(c);
	await click(c, 'member-deactivate-confirm-m-bea');
}

async function openAdaRecord(c: HTMLElement): Promise<void> {
	await openGroup(c, 'sec-sop', 'roster-row-m-ada');
	await openCard(c, 'm-ada');
	await waitFor(() => expect((q(c, 'roster-record-name') as HTMLInputElement).value).not.toBe(''));
}

async function saveAdaRecord(c: HTMLElement): Promise<void> {
	await openAdaRecord(c);
	await fireEvent.input(q(c, 'roster-record-name') as HTMLElement, { target: { value: 'Ada King' } });
	await click(c, 'roster-record-save');
}

type Fail = () => Promise<never>;

interface Row {
	site: string;
	view: 'groups' | 'arrange';
	arm: (fail: Fail) => void;
	act: (c: HTMLElement) => Promise<void>;
	write: Mock;
	error: string;
	action: string;
	// Opens on B, before the late failure, the place a stale error keyed by these ids would show.
	reveal?: (c: HTMLElement) => Promise<void>;
}

const failNext = (mock: Mock) => (fail: Fail) => mock.mockImplementationOnce(fail);
const BOOM = 'Error: boom-a';

const ROWS: Row[] = [
	{
		site: 'rosterSectionOps: assign',
		view: 'groups',
		arm: failNext(assignMock),
		act: async (c) => {
			await openGroup(c, 'unassigned', 'roster-row-m-bea');
			await click(c, 'section-picker-add-m-bea');
			await shown(c, 'section-picker-select-m-bea-blank');
			await pick(c, 'section-picker-select-m-bea-blank', 'sec-alto');
		},
		write: assignMock,
		error: 'section-write-error-m-bea',
		action: 'assigning a member to a section',
		reveal: (c) => openGroup(c, 'unassigned', 'roster-row-m-bea')
	},
	{
		site: 'rosterSectionOps: unassign',
		view: 'groups',
		arm: failNext(unassignMock),
		act: async (c) => {
			await openGroup(c, 'sec-sop', 'section-picker-select-m-ada-sec-sop');
			await pick(c, 'section-picker-select-m-ada-sec-sop', '');
		},
		write: unassignMock,
		error: 'section-write-error-m-ada',
		action: 'taking a member out of a section',
		reveal: (c) => openGroup(c, 'sec-sop', 'roster-row-m-ada')
	},
	{
		site: 'rosterSectionOps: move, the assign step',
		view: 'groups',
		arm: failNext(assignMock),
		act: async (c) => {
			await openGroup(c, 'sec-sop', 'section-picker-select-m-ada-sec-sop');
			await pick(c, 'section-picker-select-m-ada-sec-sop', 'sec-alto');
		},
		write: assignMock,
		error: 'section-write-error-m-ada',
		action: 'moving a member: adding the new section',
		reveal: (c) => openGroup(c, 'sec-sop', 'roster-row-m-ada')
	},
	{
		site: 'rosterSectionOps: move, the unassign step',
		view: 'groups',
		arm: failNext(unassignMock),
		act: async (c) => {
			await openGroup(c, 'sec-sop', 'section-picker-select-m-ada-sec-sop');
			await pick(c, 'section-picker-select-m-ada-sec-sop', 'sec-alto');
		},
		write: unassignMock,
		error: 'section-write-error-m-ada',
		action: 'moving a member: leaving the old section',
		reveal: (c) => openGroup(c, 'sec-sop', 'roster-row-m-ada')
	},
	{
		site: 'sectionReorderOps: reorder',
		view: 'arrange',
		arm: failNext(reorderMock),
		act: moveSopranoDown,
		write: reorderMock,
		error: 'section-reorder-error',
		action: 'reordering the sections'
	},
	{
		site: 'sectionReorderOps: indent',
		view: 'arrange',
		arm: failNext(reparentMock),
		act: (c) => click(c, 'arrange-indent-sec-alto'),
		write: reparentMock,
		error: 'section-reorder-error',
		action: 'moving a section under another'
	},
	{
		site: 'sectionReorderOps: indent landed, the renumber after it failed',
		view: 'arrange',
		arm: failNext(reorderMock),
		act: (c) => click(c, 'arrange-indent-sec-alto'),
		write: reorderMock,
		error: 'section-reorder-error',
		action: 'reordering the sections after a move'
	},
	{
		site: 'sectionRenameOps: rename',
		view: 'arrange',
		arm: failNext(renameMock),
		act: renameAlto,
		write: renameMock,
		error: 'arrange-rename-error-sec-alto',
		action: 'renaming a section'
	},
	{
		site: 'sectionRemoveOps: remove',
		view: 'arrange',
		arm: failNext(deleteMock),
		act: async (c) => {
			await click(c, 'section-remove-sec-tenor');
			await shown(c, 'section-remove-confirm-sec-tenor');
			await click(c, 'section-remove-confirm-sec-tenor');
		},
		write: deleteMock,
		error: 'section-remove-error',
		action: 'removing a section'
	},
	{
		site: 'sectionCreateOps: create',
		view: 'arrange',
		arm: failNext(createMock),
		act: createChorus,
		write: createMock,
		error: 'roster-new-section-error',
		action: 'creating a section',
		reveal: async (c) => {
			await click(c, 'roster-new-section');
			await shown(c, 'roster-new-section-form');
		}
	},
	{
		site: 'rosterDeactivateOps: the library read',
		view: 'groups',
		arm: (fail) => vi.mocked(resolveMyLibraryId).mockImplementationOnce(fail),
		act: deactivateBea,
		write: vi.mocked(resolveMyLibraryId),
		error: 'member-deactivate-failed-m-bea',
		action: 'deactivating a member: finding the library',
		reveal: armBea
	},
	{
		site: 'rosterDeactivateOps: the blockers read',
		view: 'groups',
		arm: failNext(listDeactivateBlockersMock),
		act: deactivateBea,
		write: listDeactivateBlockersMock,
		error: 'member-deactivate-failed-m-bea',
		action: 'deactivating a member: checking what blocks it',
		reveal: armBea
	},
	{
		site: 'rosterDeactivateOps: deactivate',
		view: 'groups',
		arm: failNext(deactivateMemberMock),
		act: deactivateBea,
		write: deactivateMemberMock,
		error: 'member-deactivate-failed-m-bea',
		action: 'deactivating a member',
		reveal: armBea
	},
	{
		site: 'rosterDeactivateOps: reinstate',
		view: 'groups',
		arm: failNext(reinstateMemberMock),
		act: async (c) => {
			await click(c, 'roster-inactive-toggle');
			await shown(c, 'member-reinstate-m-ina');
			await click(c, 'member-reinstate-m-ina');
		},
		write: reinstateMemberMock,
		error: 'member-reinstate-failed-m-ina',
		action: 'reinstating a member',
		reveal: async (c) => {
			if (!q(c, 'member-reinstate-m-ina')) await click(c, 'roster-inactive-toggle');
			await shown(c, 'member-reinstate-m-ina');
		}
	},
	{
		site: 'rosterRecordOps: the re-read before a save',
		view: 'groups',
		arm: (fail) => loadMemberRecordMock.mockResolvedValueOnce(oneRecord).mockImplementationOnce(fail),
		act: saveAdaRecord,
		write: loadMemberRecordMock,
		error: 'roster-record-save-error',
		action: 'saving a member record: reading it first',
		reveal: openAdaRecord
	},
	{
		site: 'rosterRecordOps: create the record',
		view: 'groups',
		arm: failNext(createMemberRecordMock),
		act: saveAdaRecord,
		write: createMemberRecordMock,
		error: 'roster-record-save-error',
		action: 'saving a member record',
		reveal: openAdaRecord
	},
	{
		site: 'rosterRecordOps: update the record',
		view: 'groups',
		arm: (fail) => {
			loadMemberRecordMock.mockResolvedValue(oneRecord);
			updateMemberRecordMock.mockImplementationOnce(fail);
		},
		act: saveAdaRecord,
		write: updateMemberRecordMock,
		error: 'roster-record-save-error',
		action: 'saving a member record',
		reveal: openAdaRecord
	}
];

const render = (view: Row['view']) => (view === 'groups' ? renderGroupsRoster() : renderInArrangeMode());

describe('/roster — a failed write shows its error and keeps one report (#1049)', () => {
	it.each(ROWS.map((row) => [row.site, row] as const))('%s', async (_, row) => {
		row.arm(() => Promise.reject(new Error('boom-a')));
		const c = await render(row.view);

		await row.act(c);

		await shown(c, row.error);
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([{ area: 'roster', action: row.action, detail: BOOM }])
		);
	});

	it.each(ROWS.map((row) => [row.site, row] as const))(
		'%s, settling after a switch: kept under the collective it started in, nothing on the new one',
		async (_, row) => {
			const held = deferred<never>();
			row.arm(() => held.promise);
			const c = await render(row.view);
			const identityA = get(selectedCollectiveIdentityStore);
			await row.act(c);
			await waitFor(() => expect(row.write).toHaveBeenCalled());

			selectedCollectiveDbStore.set('other-choir');
			await onB(c);
			const identityB = get(selectedCollectiveIdentityStore);
			await row.reveal?.(c);
			held.reject(new Error('boom-a'));
			await settle();

			expect(await keptProblems(identityA)).toEqual([{ area: 'roster', action: row.action, detail: BOOM }]);
			expect(await keptProblems(identityB)).toEqual([]);
			expect(q(c, row.error)).toBeNull();
			expect(c.querySelector('[role="alert"]')).toBeNull();
		}
	);

	it('a rename left open is committed by a switch: its failure is kept under the old collective', async () => {
		renameMock.mockRejectedValueOnce(new Error('boom-a'));
		const c = await renderInArrangeMode();
		const identityA = get(selectedCollectiveIdentityStore);
		await click(c, 'arrange-rename-sec-alto');
		await shown(c, 'arrange-rename-input-sec-alto');
		await fireEvent.input(q(c, 'arrange-rename-input-sec-alto') as HTMLElement, { target: { value: 'Altos' } });

		selectedCollectiveDbStore.set('other-choir');
		await onB(c);
		await waitFor(() => expect(renameMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'sampledb' }), 'sec-alto', 'Altos'));
		await settle();

		const renaming = { area: 'roster', action: 'renaming a section', detail: BOOM };
		expect(await keptProblems(identityA)).toEqual([renaming]);
		expect(await keptProblems(get(selectedCollectiveIdentityStore))).toEqual([]);
	});

	it('a partial record save keeps the field that failed and the ones that landed', async () => {
		loadMemberRecordMock.mockResolvedValue(oneRecord);
		updateMemberRecordMock.mockRejectedValueOnce(new MemberRecordPartialSaveError(['name'], 'phone', new Error('HTTP 500')));
		const c = await renderGroupsRoster();

		await saveAdaRecord(c);

		await shown(c, 'roster-record-save-error');
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'roster', action: 'saving a member record', detail: 'MemberRecordPartialSaveError: member record save incomplete: phone failed (HTTP 500); landed: name' }
			])
		);
	});

	it('a failed rename whose tree re-read also fails keeps both, the write first', async () => {
		renameMock.mockRejectedValueOnce(new Error('boom-a'));
		const c = await renderInArrangeMode();
		listSectionsMock.mockRejectedValueOnce(new Error('reread-boom'));

		await renameAlto(c);

		await shown(c, 'arrange-rename-error-sec-alto');
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'roster', action: 'renaming a section', detail: BOOM },
				{ area: 'roster', action: 're-reading the sections after a failed rename', detail: 'Error: reread-boom' }
			])
		);
	});

	it('a rights read that rejects shows the owners-only note and keeps a report', async () => {
		resolveDbRightMock.mockReset().mockRejectedValue(new Error('rights-boom'));
		const c = await renderGroupsRoster();

		await shown(c, 'roster-invite-owner-note');
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'roster', action: 'reading your rights on the collective', detail: 'Error: rights-boom' }
			])
		);
	});

	it('a write refused for an expired session keeps nothing', async () => {
		createMock.mockRejectedValueOnce(new AuthExpiredError());
		const c = await renderInArrangeMode();

		await createChorus(c);

		await shown(c, 'roster-new-section-error');
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('a section refused as not empty is a refusal: it shows and keeps nothing', async () => {
		const { SectionNotEmptyError } = await import('$lib/sections/sectionErrors');
		deleteMock.mockRejectedValueOnce(new SectionNotEmptyError('sec-tenor', 1, 0));
		const c = await renderInArrangeMode();

		await click(c, 'section-remove-sec-tenor');
		await shown(c, 'section-remove-confirm-sec-tenor');
		await click(c, 'section-remove-confirm-sec-tenor');

		await shown(c, 'section-remove-error');
		await settle();
		expect(await keptProblems()).toEqual([]);
	});
});

// (*MVOX:Josquin*)
