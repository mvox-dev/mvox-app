// @vitest-environment happy-dom
// #682: /admin runs on the shared route-load machine: a dead session gets the shared notice.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const h = vi.hoisted(() => ({
	resolveDbEditRight: vi.fn(),
	resolveDbRight: vi.fn(),
	resolveLibraryEditRight: vi.fn(),
	loadRoster: vi.fn(),
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
vi.mock('$lib/nav/dbRights', async () => ({
	dbEditRight: (await import('$lib/testing/mocks/admin')).dbEditRightStore,
	resolveDbEditRight: h.resolveDbEditRight,
	resolveDbRight: h.resolveDbRight
}));
vi.mock('$lib/library/libraryRights', () => ({ resolveLibraryEditRight: h.resolveLibraryEditRight }));
vi.mock('$lib/profile/linkedIdentities', () => ({ listJoinStates: h.listJoinStates }));
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRoster }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
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

vi.mock('$lib/profile/seasonAttendance', async () =>
	(await import('$lib/testing/mocks/profile')).noSeasonAttendanceModule()
);

import Page from './profile/+page.svelte';
import { collectiveState, selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import { authExpiredError, selectSampledb } from '$lib/testing/pages/admin';
import { dbEditRight } from '$lib/nav/dbRights';

function setCollective(name: string) {
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name, personId: 'admin-p' }],
		erroredDbs: []
	});
}

function loadOk() {
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveDbEditRight.mockResolvedValue('editor');
	dbEditRight.set('editor');
	h.resolveDbRight.mockResolvedValue('error');
	h.resolveLibraryEditRight.mockResolvedValue({ state: 'editor', libraryId: null });
	h.loadRoster.mockResolvedValue(toListRead([]));
	listSectionsMock.mockResolvedValue([]);
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
	listSectionsMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	loadOk();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	resetAppState();
});

describe('/admin — session expired', () => {
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

describe('/profile admin section — a collective switch mid-load', () => {
	it("the first load's late entity answer never reaches the second load", async () => {
		let releaseFirst!: (id: string) => void;
		const first = new Promise<string>((res) => (releaseFirst = res));
		resolveDatabaseEntityIdMock.mockImplementation((c: { db: string }) =>
			c.db === 'sampledb' ? first : Promise.resolve('org-2')
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
		await vi.waitFor(() => expect(resolveDatabaseEntityIdMock).toHaveBeenCalled());

		selectedCollectiveDbStore.set('bravura');
		await vi.waitFor(() =>
			expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(expect.objectContaining({ db: 'bravura' }))
		);
		releaseFirst('org-1');
		await tick();

		await waitFor(() => {
			expect(q(container, 'admin-roles-admins')).not.toBeNull();
		});
		expect(h.resolveLibraryEditRight.mock.calls.map((call) => call[3])).toEqual(['org-2']);
		expect(h.listAdmins.mock.calls.map((call) => call[1])).toEqual(['org-2']);
	});
});

describe('/profile admin section — a collective rename', () => {
	it('relabels without reloading: the reads run once', async () => {
		selectSampledb();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-admins')).not.toBeNull();
		});
		const resolves = resolveDatabaseEntityIdMock.mock.calls.length;

		setCollective('Uus Koorinimi');
		await tick();
		await tick();

		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(resolves);
		expect(h.loadRoster).toHaveBeenCalledTimes(1);
		expect(h.listAdmins).toHaveBeenCalledTimes(1);
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});
});

// (*MVOX:Josquin*)
