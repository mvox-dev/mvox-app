// @vitest-environment happy-dom
// #682: /admin runs on the shared route-load machine: a dead session gets the shared notice.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const h = vi.hoisted(() => ({
	resolveAdmin: vi.fn(),
	resolveOwnerTier: vi.fn(),
	resolveLibrarian: vi.fn(),
	resolveDatabaseEntityId: vi.fn(),
	loadRoster: vi.fn(),
	listSections: vi.fn(),
	listAdmins: vi.fn(),
	listLibrarians: vi.fn(),
	resolveCollectiveNameMarker: vi.fn(),
	resolvePersonParentId: vi.fn(),
	resolveInviteParentId: vi.fn(),
	listJoinStates: vi.fn()
}));
vi.mock('$lib/admin/roleManagement', () => ({
	RoleLockoutError: class extends Error {},
	RoleGrantMissingError: class extends Error {},
	fetchRights: vi.fn(),
	listAdmins: h.listAdmins,
	addAdmin: vi.fn(),
	removeAdmin: vi.fn(),
	listLibrarians: h.listLibrarians,
	addLibrarian: vi.fn(),
	removeLibrarian: vi.fn()
}));
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: h.resolveAdmin,
	resolveOwnerTier: h.resolveOwnerTier
}));
vi.mock('$lib/library/librarianStore', () => ({ resolveLibrarian: h.resolveLibrarian }));
vi.mock('$lib/profile/linkedIdentities', () => ({ listJoinStates: h.listJoinStates }));
vi.mock('$lib/collective/databaseEntity', () => ({
	resolveDatabaseEntityId: h.resolveDatabaseEntityId
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRoster }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: h.listSections
}));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarker,
	updateCollectiveName: vi.fn()
}));
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: class extends Error {},
	resolvePersonParentId: h.resolvePersonParentId,
	resolveInviteParentId: h.resolveInviteParentId,
	createInvite: vi.fn()
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './admin/+page.svelte';
import { collectiveState, selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

function setCollective(name: string) {
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name, personId: 'admin-p' }],
		erroredDbs: []
	});
}

function selectSampledb() {
	signIn({
		token: 'jwt-admin',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }]
	});
}

function loadOk() {
	h.resolveDatabaseEntityId.mockResolvedValue('org-1');
	h.resolveAdmin.mockResolvedValue('admin');
	h.resolveOwnerTier.mockResolvedValue('error');
	h.resolveLibrarian.mockResolvedValue({ state: 'librarian', libraryId: null });
	h.loadRoster.mockResolvedValue(toListRead([]));
	h.listSections.mockResolvedValue([]);
	h.listAdmins.mockResolvedValue({ persons: [], canManage: false });
	h.listLibrarians.mockResolvedValue({ persons: [], canManage: false });
	h.resolveCollectiveNameMarker.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	h.resolvePersonParentId.mockResolvedValue('parent-1');
	h.resolveInviteParentId.mockResolvedValue('org-1');
	h.listJoinStates.mockResolvedValue({});
}

function q(root: ParentNode, testid: string): Element | null {
	return root.querySelector(`[data-testid="${testid}"]`);
}

beforeEach(() => {
	for (const mock of Object.values(h)) mock.mockReset();
	loadOk();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	resetAppState();
});

describe('/admin — session expired', () => {
	it('an auth-expired first read shows the session-expired notice, not the load error', async () => {
		h.resolveDatabaseEntityId.mockRejectedValue(authExpiredError());
		selectSampledb();

		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'session-expired')).not.toBeNull();
		});
		expect(q(container, 'admin-roles-load-error')).toBeNull();
		expect(q(container, 'admin-roles-no-access')).toBeNull();
		expect(h.resolveAdmin).not.toHaveBeenCalled();
	});

	it('an auth-expired read after the gate shows the notice too', async () => {
		h.loadRoster.mockRejectedValue(authExpiredError());
		selectSampledb();

		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'session-expired')).not.toBeNull();
		});
		expect(q(container, 'admin-roles-load-error')).toBeNull();
	});
});

describe('/admin — a collective switch during the gate', () => {
	it("the first load's late entity answer never reaches the second load", async () => {
		let releaseFirst!: (id: string) => void;
		h.resolveDatabaseEntityId
			.mockImplementationOnce(() => new Promise((res) => (releaseFirst = res)))
			.mockResolvedValueOnce('org-2');
		let releaseAdmin!: (state: string) => void;
		h.resolveAdmin.mockImplementation((_c, _p, _f, id) =>
			id === 'org-2' ? new Promise((res) => (releaseAdmin = res)) : Promise.resolve('admin')
		);
		selectSampledb();
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' },
				{ db: 'bravura', name: 'Bravura', personId: 'admin-b' }
			],
			erroredDbs: []
		});
		const { container } = render(Page);
		await tick();

		selectedCollectiveDbStore.set('bravura');
		await vi.waitFor(() => expect(h.resolveAdmin).toHaveBeenCalledTimes(1));
		releaseFirst('org-1');
		await tick();
		releaseAdmin('admin');

		await waitFor(() => {
			expect(q(container, 'admin-roles-admins')).not.toBeNull();
		});
		expect(h.resolveLibrarian.mock.calls.map((call) => call[3])).toEqual(['org-2']);
		expect(h.listAdmins.mock.calls.map((call) => call[1])).toEqual(['org-2']);
	});
});

describe('/admin — a collective rename', () => {
	it('relabels without reloading: the gate and the reads run once', async () => {
		selectSampledb();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-admins')).not.toBeNull();
		});

		setCollective('Uus Koorinimi');
		await tick();
		await tick();

		expect(h.resolveDatabaseEntityId).toHaveBeenCalledTimes(1);
		expect(h.resolveAdmin).toHaveBeenCalledTimes(1);
		expect(h.loadRoster).toHaveBeenCalledTimes(1);
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});
});

// (*MVOX:Josquin*)
