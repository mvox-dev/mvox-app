// @vitest-environment happy-dom
// #1049: each failed write on /profile (fields, links, storage, admin, invite) keeps one report,
// filed under the collective the write started in, and a late failure never shows on the next.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const h = vi.hoisted(() => ({
	readRosterNames: vi.fn(),
	updateRosterNames: vi.fn(),
	store: null as unknown
}));

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/profile/applyProfileSave', async () =>
	(await import('$lib/testing/mocks/profile')).applyProfileSaveModule('shared')
);
vi.mock('$lib/profile/fieldMove', async (importOriginal) =>
	(await import('$lib/testing/mocks/profile')).fieldWritesModule(importOriginal)
);
vi.mock('$lib/profile/seasonAttendance', () => ({
	loadSeasonAttendance: async () => null,
	loadSeasonMemberRates: async () => []
}));
vi.mock('$lib/profile/linkedIdentities', async (importOriginal) => ({
	...((await importOriginal()) as object),
	listLinkedIdentities: async () => ({ identities: [] }),
	listJoinStates: async () => ({})
}));
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: false })
);
vi.mock('$lib/admin/roleManagement', async () =>
	(await import('$lib/testing/mocks/admin')).roleManagementModule({ errors: true })
);
vi.mock('$lib/nav/dbRights', async () =>
	(await import('$lib/testing/mocks/admin')).dbRightsModule()
);
vi.mock('$lib/library/libraryRights', async () =>
	(await import('$lib/testing/mocks/admin')).libraryRightsModule()
);
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', async () =>
	(await import('$lib/testing/mocks/admin')).collectiveNameModule()
);
vi.mock('$lib/collective/rosterNames', () => ({
	readRosterNamesSetting: h.readRosterNames,
	readRosterNamesSettingOf: h.readRosterNames,
	updateRosterShowRealNames: h.updateRosterNames
}));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => h.store }));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './profile/+page.svelte';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { selectedCollectiveDbStore, selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { FieldMoveError } from '$lib/profile/fieldMove';
import { InviteCreateError } from '$lib/invite/inviteData';
import { dbEditRight } from '$lib/nav/dbRights';
import { resetAppState } from '$lib/testing/appReset';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { deferred } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	addAdminMock,
	addLibrarianMock,
	createInviteMock,
	listAdminsMock,
	listLibrariansMock,
	mintSelfLinkInviteMock,
	removeAdminMock,
	removeLibrarianMock,
	resolveCollectiveNameMarkerMock,
	resolveDbRightMock,
	resolveLibraryEditRightMock,
	sendInviteMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import {
	applyConflictResolutionMock,
	applyDuplicateRepairMock,
	applyFieldMoveMock,
	applyProfileSaveMock
} from '$lib/testing/mocks/profile';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { ANNA, BELA, CILLA, ROSTER, listing } from '$lib/testing/pages/admin';
import { q } from '$lib/testing/pages/dom';
import { COLLECTIVE_A, COLLECTIVE_B } from '$lib/testing/pages/profile';
import { signIn } from '$lib/testing/session';

useKeptProblems();

// The background IndexedDB write must have had its chance before "nothing kept" means anything.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

type Profile = { _id: string; name: string; email: string; _sharing: string };
// B reuses A's ids, so a stale error keyed by id or field would show on B; only the names differ.
const B = (db: string) => (db === COLLECTIVE_A.db ? '' : ' B');
const oneHolder = (db: string): Profile[] => [
	{ _id: 'prof-dom', name: `Ada${B(db)}`, email: 'ada@x.io', _sharing: 'domain' }
];
const duplicate = (db: string): Profile[] => [
	{ _id: 'prof-priv', name: `Ada${B(db)}`, email: '', _sharing: 'private' },
	{ _id: 'prof-dom', name: `Ada${B(db)}`, email: '', _sharing: 'domain' }
];
const conflict = (db: string): Profile[] => [
	{ _id: 'prof-dom', name: `Ann${B(db)}`, email: '', _sharing: 'domain' },
	{ _id: 'prof-pub', name: `Annie${B(db)}`, email: '', _sharing: 'public' }
];

let store: FakeByteStore;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	store = createFakeByteStore();
	h.store = store;
	signIn({ token: 'jwt-admin', collectives: [COLLECTIVE_A, COLLECTIVE_B], selected: COLLECTIVE_A.db });
	dbEditRight.set('editor');
	listMyProfilesMock.mockImplementation(async (cfg: { db: string }) => oneHolder(cfg.db));
	applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibraryEditRightMock.mockResolvedValue({ state: 'editor', libraryId: 'lib-1' });
	listAdminsMock.mockResolvedValue(listing([ANNA, BELA]));
	listLibrariansMock.mockResolvedValue(listing([CILLA]));
	for (const write of [addAdminMock, addLibrarianMock, removeAdminMock, removeLibrarianMock]) {
		write.mockResolvedValue(undefined);
	}
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	resolveCollectiveNameMarkerMock.mockImplementation(async (cfg: { db: string }) => ({
		markerId: 'marker-1',
		name: cfg.db === COLLECTIVE_A.db ? 'Sampledb' : 'Bravura'
	}));
	updateCollectiveNameMock.mockResolvedValue(undefined);
	resolveDbRightMock.mockResolvedValue('error');
	createInviteMock.mockResolvedValue({ personId: 'p-new' });
	sendInviteMock.mockResolvedValue({ sent: true, email: 'new@x.io' });
	h.readRosterNames.mockResolvedValue({ dbEntityId: 'org-1', showRealNames: false });
	h.updateRosterNames.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	resetAppState();
});

async function click(c: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(q(c, id) as HTMLElement);
}

async function shown(c: HTMLElement, id: string): Promise<void> {
	await waitFor(() => expect(q(c, id)).not.toBeNull());
}

// Ready on both halves: the fields, and the admin section with its name marker.
async function ready(c: HTMLElement, name: string, collective: string): Promise<void> {
	await waitFor(() => {
		expect(q(c, 'profile-field-name')?.textContent).toContain(name);
		expect(q(c, 'admin-collective-name')?.textContent).toContain(collective);
		expect(q(c, 'profile-storage')).not.toBeNull();
		expect(q(c, 'profile-linked-accounts')).not.toBeNull();
		expect((q(c, 'profile-roster-names') as HTMLSelectElement | null)?.disabled).toBe(false);
	});
}

// B's own alerts (its repair banner) stand; a late failure from A must add none.
const alerts = (c: HTMLElement) =>
	Array.from(c.querySelectorAll('[role="alert"]'), (el) => el.textContent?.trim());

async function pick(c: HTMLElement, id: string, value: string): Promise<void> {
	await fireEvent.change(q(c, id) as HTMLElement, { target: { value } });
}

async function saveName(c: HTMLElement): Promise<void> {
	await click(c, 'profile-name-edit');
	await shown(c, 'profile-name');
	const input = q(c, 'profile-name') as HTMLInputElement;
	await fireEvent.input(input, { target: { value: 'Ada King' } });
	await fireEvent.blur(input);
}

async function resolveConflict(c: HTMLElement): Promise<void> {
	await click(c, 'profile-vis-name-public');
	await shown(c, 'profile-vis-name-public-preview');
	await click(c, 'profile-vis-name-public');
}

async function openLinkPicker(c: HTMLElement): Promise<void> {
	await click(c, 'profile-link-another');
	await shown(c, 'profile-link-provider-google');
}

async function armRemoveMine(c: HTMLElement): Promise<void> {
	await click(c, 'profile-storage-remove-mine');
	await shown(c, 'profile-storage-remove-mine-confirm');
}

async function armRemoveAll(c: HTMLElement): Promise<void> {
	await click(c, 'profile-storage-remove-all');
	await shown(c, 'profile-storage-remove-all-confirm');
}

async function renameCollective(c: HTMLElement): Promise<void> {
	await click(c, 'admin-collective-name-edit');
	await shown(c, 'admin-collective-name-input');
	const input = q(c, 'admin-collective-name-input') as HTMLInputElement;
	await fireEvent.input(input, { target: { value: 'Uus nimi' } });
	await fireEvent.keyDown(input, { key: 'Enter' });
}

async function inviteNewPerson(c: HTMLElement): Promise<void> {
	await fireEvent.input(q(c, 'invite-email') as HTMLElement, { target: { value: 'new@x.io' } });
	await click(c, 'invite-admin-submit');
}

type Fail = () => Promise<never>;

interface Row {
	site: string;
	profiles?: (db: string) => Profile[];
	arm: (fail: Fail) => void;
	act: (c: HTMLElement) => Promise<void>;
	write: () => Mock;
	// How many calls the write has had once the act has reached it (a re-read counts its load).
	calls?: number;
	// What shows in place; null when the failure shows nothing (it still reports).
	error: string | null;
	area: string;
	action: string;
	// A move that fails at its second step throws a FieldMoveError of phase 'delete'.
	phase?: 'delete';
	// Opens on B, before the late failure, the place a stale error keyed by these ids would show.
	reveal?: (c: HTMLElement) => Promise<void>;
	// What reveal opened, which the late failure must leave open.
	revealed?: string;
}

const failNext = (mock: () => Mock) => (fail: Fail) => mock().mockImplementationOnce(fail);
const BOOM = 'Error: boom-a';

const ROWS: Row[] = [
	{
		site: 'profileEditQueue: a field save',
		area: 'profile',
		arm: failNext(() => applyProfileSaveMock),
		act: saveName,
		write: () => applyProfileSaveMock,
		error: 'profile-name-error',
		action: 'saving a profile field'
	},
	{
		site: 'fieldMoveQueue: a move, adding the value at the new level',
		area: 'profile',
		arm: (fail) => applyFieldMoveMock.mockImplementationOnce(fail),
		act: (c) => click(c, 'profile-vis-name-public'),
		write: () => applyFieldMoveMock,
		error: 'profile-vis-name-error',
		action: 'moving a profile field: adding it at the new level'
	},
	{
		site: 'fieldMoveQueue: a move, clearing the old level (nothing shown, the page reloads)',
		area: 'profile',
		arm: (fail) => applyFieldMoveMock.mockImplementationOnce(fail),
		act: (c) => click(c, 'profile-vis-name-public'),
		write: () => applyFieldMoveMock,
		error: null,
		action: 'moving a profile field: clearing it at the old level',
		phase: 'delete'
	},
	{
		site: 'fieldMoveQueue: a duplicate repair',
		area: 'profile',
		profiles: duplicate,
		arm: failNext(() => applyDuplicateRepairMock),
		act: (c) => click(c, 'profile-visibility-repair-name-fix'),
		write: () => applyDuplicateRepairMock,
		error: 'profile-visibility-repair-name-error',
		action: 'repairing a profile field held at two levels'
	},
	{
		site: 'profileFieldOps: a conflict resolution (nothing shown)',
		area: 'profile',
		profiles: conflict,
		arm: failNext(() => applyConflictResolutionMock),
		act: resolveConflict,
		write: () => applyConflictResolutionMock,
		error: null,
		action: 'resolving a profile field conflict'
	},
	{
		site: 'LinkedAccountsSection: the self-link mint',
		area: 'profile',
		arm: failNext(() => mintSelfLinkInviteMock),
		act: async (c) => {
			await openLinkPicker(c);
			await click(c, 'profile-link-provider-google');
		},
		write: () => mintSelfLinkInviteMock,
		error: 'profile-link-error',
		action: 'preparing to link another account',
		reveal: openLinkPicker,
		revealed: 'profile-link-provider-google'
	},
	{
		site: 'RosterNamesToggle: the roster names write',
		area: 'profile',
		arm: failNext(() => h.updateRosterNames),
		act: (c) => pick(c, 'profile-roster-names', 'real'),
		write: () => h.updateRosterNames,
		error: 'profile-roster-names-error',
		action: 'saving the roster names setting'
	},
	{
		site: 'ProfileStorageSection: remove this account’s parts',
		area: 'profile',
		arm: (fail) => vi.spyOn(store, 'clearPartition').mockImplementationOnce(fail),
		act: async (c) => {
			await armRemoveMine(c);
			await click(c, 'profile-storage-remove-mine-confirm');
		},
		write: () => store.clearPartition as Mock,
		error: 'profile-storage-error',
		action: 'removing this account’s downloaded parts',
		reveal: armRemoveMine,
		revealed: 'profile-storage-remove-mine-confirm'
	},
	{
		site: 'ProfileStorageSection: remove everything downloaded',
		area: 'profile',
		arm: (fail) => vi.spyOn(store, 'clearAllPartitions').mockImplementationOnce(fail),
		act: async (c) => {
			await armRemoveAll(c);
			await click(c, 'profile-storage-remove-all-confirm');
		},
		write: () => store.clearAllPartitions as Mock,
		error: 'profile-storage-error',
		action: 'removing everything downloaded',
		reveal: armRemoveAll,
		revealed: 'profile-storage-remove-all-confirm'
	},
	{
		site: 'AdminRoles: add an administrator',
		area: 'admin',
		arm: failNext(() => addAdminMock),
		act: (c) => pick(c, 'admin-add-admin-select', 'p-dora'),
		write: () => addAdminMock,
		error: 'admin-roles-action-error',
		action: 'adding an administrator'
	},
	{
		site: 'AdminRoles: add an administrator, the re-read after it',
		area: 'admin',
		arm: (fail) => listAdminsMock.mockResolvedValueOnce(listing([ANNA, BELA])).mockImplementationOnce(fail),
		act: (c) => pick(c, 'admin-add-admin-select', 'p-dora'),
		write: () => listAdminsMock,
		calls: 2,
		error: 'admin-roles-action-error',
		action: 'adding an administrator: re-reading the list'
	},
	{
		site: 'AdminRoles: remove an administrator',
		area: 'admin',
		arm: failNext(() => removeAdminMock),
		act: (c) => click(c, 'admin-remove-p-bela'),
		write: () => removeAdminMock,
		error: 'admin-roles-action-error',
		action: 'removing an administrator'
	},
	{
		site: 'AdminRoles: add a librarian',
		area: 'admin',
		arm: failNext(() => addLibrarianMock),
		act: (c) => pick(c, 'admin-add-librarian-select', 'p-dora'),
		write: () => addLibrarianMock,
		error: 'admin-roles-action-error',
		action: 'adding a librarian'
	},
	{
		site: 'AdminRoles: remove a librarian',
		area: 'admin',
		arm: failNext(() => removeLibrarianMock),
		act: (c) => click(c, 'librarian-remove-p-cilla'),
		write: () => removeLibrarianMock,
		error: 'admin-roles-action-error',
		action: 'removing a librarian'
	},
	{
		site: 'CollectiveNameEditor: the name save',
		area: 'admin',
		arm: failNext(() => updateCollectiveNameMock),
		act: renameCollective,
		write: () => updateCollectiveNameMock,
		error: 'admin-collective-name-error',
		action: 'renaming the collective'
	},
	{
		site: 'inviteSurfaceOps: creating the invited person',
		area: 'admin/invite',
		arm: failNext(() => createInviteMock),
		act: inviteNewPerson,
		write: () => createInviteMock,
		error: 'invite-admin-error',
		action: 'creating an invite'
	},
	{
		site: 'inviteSurfaceOps: sending the invite',
		area: 'admin/invite',
		arm: failNext(() => sendInviteMock),
		act: inviteNewPerson,
		write: () => sendInviteMock,
		error: 'invite-send-error',
		action: 'sending an invite'
	}
];

function failure(row: Row): Error {
	return row.phase === 'delete' ? new FieldMoveError('boom-a', 'delete') : new Error('boom-a');
}

function kept(row: Row) {
	const detail = row.phase === 'delete' ? 'FieldMoveError: boom-a' : BOOM;
	return [{ area: row.area, action: row.action, detail }];
}

async function renderPage(profiles: (db: string) => Profile[] = oneHolder): Promise<HTMLElement> {
	listMyProfilesMock.mockImplementation(async (cfg: { db: string }) => profiles(cfg.db));
	const { container } = render(Page);
	await ready(container, profiles(COLLECTIVE_A.db)[0].name, 'Sampledb');
	return container;
}

describe('/profile — a failed write keeps one report (#1049)', () => {
	it.each(ROWS.map((row) => [row.site, row] as const))('%s', async (_, row) => {
		row.arm(() => Promise.reject(failure(row)));
		const c = await renderPage(row.profiles);

		await row.act(c);

		if (row.error) await shown(c, row.error);
		await waitFor(async () => expect(await keptProblems()).toEqual(kept(row)));
		if (!row.error) expect(c.querySelector('[role="alert"]')).toBeNull();
	});

	it.each(ROWS.map((row) => [row.site, row] as const))(
		'%s, settling after a switch: kept under the collective it started in, nothing on the new one',
		async (_, row) => {
			const held = deferred<never>();
			row.arm(() => held.promise);
			const c = await renderPage(row.profiles);
			const identityA = get(selectedCollectiveIdentityStore);
			await row.act(c);
			await waitFor(() => expect(row.write()).toHaveBeenCalledTimes(row.calls ?? 1));

			selectedCollectiveDbStore.set(COLLECTIVE_B.db);
			const profiles = row.profiles ?? oneHolder;
			await ready(c, profiles(COLLECTIVE_B.db)[0].name, 'Bravura');
			const identityB = get(selectedCollectiveIdentityStore);
			await row.reveal?.(c);
			const alertsOnB = alerts(c);
			held.reject(failure(row));
			await settle();

			expect(await keptProblems(identityA)).toEqual(kept(row));
			expect(await keptProblems(identityB)).toEqual([]);
			if (row.error) expect(q(c, row.error)).toBeNull();
			expect(alerts(c)).toEqual(alertsOnB);
			if (row.revealed) expect(q(c, row.revealed)).not.toBeNull();
		}
	);

	it('a removal for A landing after a switch leaves B’s own count of stored parts', async () => {
		const held = deferred<void>();
		const part = { bytes: new ArrayBuffer(1), filetype: 'application/pdf', sha256: 'x' };
		store.seed({ db: COLLECTIVE_B.db, personId: COLLECTIVE_B.personId }, 'file-b1', part);
		store.seed({ db: COLLECTIVE_B.db, personId: COLLECTIVE_B.personId }, 'file-b2', part);
		const c = await renderPage();
		vi.spyOn(store, 'clearPartition').mockImplementationOnce(() => held.promise);
		await armRemoveMine(c);
		await click(c, 'profile-storage-remove-mine-confirm');

		selectedCollectiveDbStore.set(COLLECTIVE_B.db);
		await ready(c, 'Ada B', 'Bravura');
		await waitFor(() => expect(q(c, 'profile-storage-mine')?.textContent).toContain('"count":2'));
		held.resolve();
		await settle();

		expect(q(c, 'profile-storage-mine')?.textContent).toContain('"count":2');
	});

	it('a partial invite (person made, membership not) shows its person and keeps the error', async () => {
		const partial = new InviteCreateError('member create failed: HTTP 500', {
			phase: 'member-create',
			reason: 'http',
			personId: 'p-half'
		});
		createInviteMock.mockRejectedValueOnce(partial);
		const c = await renderPage();

		await inviteNewPerson(c);

		await shown(c, 'invite-partial-failure');
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'admin/invite', action: 'creating an invite', detail: 'InviteCreateError: member create failed: HTTP 500' }
			])
		);
	});

	it('a field save refused for an expired session shows its error and keeps nothing', async () => {
		applyProfileSaveMock.mockRejectedValueOnce(new AuthExpiredError());
		const c = await renderPage();

		await saveName(c);

		await shown(c, 'profile-name-error');
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('a page that loads without failing keeps nothing', async () => {
		const c = await renderPage();

		await settle();
		expect(q(c, 'profile-field-name')).not.toBeNull();
		expect(await keptProblems()).toEqual([]);
	});
});

// (*MVOX:Josquin*)
