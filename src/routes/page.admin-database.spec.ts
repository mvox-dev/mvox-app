// @vitest-environment happy-dom
import { toListRead } from '$lib/testing/listReadFixtures';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

const h = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	addAdminMock: vi.fn(),
	removeAdminMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	addLibrarianMock: vi.fn(),
	removeLibrarianMock: vi.fn(),
	resolveAdminMock: vi.fn(),
	resolveOwnerTierMock: vi.fn().mockResolvedValue('error'),
	listJoinStatesMock: vi.fn().mockResolvedValue({}),
	resolveLibrarianMock: vi.fn(),
	entuFetchMock: vi.fn(),
	loadRosterMock: vi.fn(),
	resolveParentMock: vi.fn(),
	createInviteMock: vi.fn(),
	resolveCollectiveNameMarkerMock: vi.fn(),
	updateCollectiveNameMock: vi.fn()
}));

vi.mock('$lib/admin/roleManagement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/admin/roleManagement')>();
	return {
		...actual,
		listAdmins: h.listAdminsMock,
		addAdmin: h.addAdminMock,
		removeAdmin: h.removeAdminMock,
		listLibrarians: h.listLibrariansMock,
		addLibrarian: h.addLibrarianMock,
		removeLibrarian: h.removeLibrarianMock
	};
});
vi.mock('$lib/nav/adminStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/nav/adminStore')>();
	return { ...actual, resolveAdmin: h.resolveAdminMock, resolveOwnerTier: h.resolveOwnerTierMock };
});
vi.mock('$lib/library/librarianStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/library/librarianStore')>();
	return { ...actual, resolveLibrarian: h.resolveLibrarianMock };
});
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/entu/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/entu/request')>();
	return { ...actual, entuFetch: h.entuFetchMock };
});
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRosterMock }));
vi.mock('$lib/profile/linkedIdentities', () => ({ listJoinStates: h.listJoinStatesMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/invite/inviteData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/invite/inviteData')>();
	return {
		...actual,
		resolvePersonParentId: h.resolveParentMock,
		createInvite: h.createInviteMock
	};
});
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
import type { RolePerson } from '$lib/admin/roleManagement';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';

const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // the database entity — THE collective (#161)

const ANNA: RolePerson = {
	id: 'p-anna',
	name: 'Anna Arro',
	role: 'owner',
	valueIds: ['pv-own-anna']
};

const ROSTER = [{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }];

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

beforeEach(() => {
	h.resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue(DB_ENTITY);
	h.entuFetchMock.mockRejectedValue(
		new Error(
			'wire disabled in this spec — collective resolution must go through resolveDatabaseEntityId'
		)
	);
	h.resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	h.resolveParentMock.mockResolvedValue(DB_ENTITY);
	h.createInviteMock.mockResolvedValue({
		personId: 'p-new',
		memberId: 'm-new',
		inviteToken: 'a.b.c'
	});
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	selectSampledb();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});
	return container;
}

describe('/admin — the role lists are keyed to the DATABASE entity (#161)', () => {
	it('reaches ready via resolveDatabaseEntityId and hands ITS id to listAdmins — no member/organization wire walk', async () => {
		await renderReady();

		expect(resolveDatabaseEntityIdMock).toHaveBeenCalled();
		expect(resolveDatabaseEntityIdMock.mock.calls[0][0]).toMatchObject({ db: 'sampledb' });

		expect(h.listAdminsMock).toHaveBeenCalled();
		expect(h.listAdminsMock.mock.calls[0][1]).toBe(DB_ENTITY);

		expect(h.entuFetchMock).not.toHaveBeenCalled();
	});
});

describe('/admin — the embedded InviteSurface targets the DATABASE entity (#161)', () => {
	it('submitting an invite calls createInvite with dbEntityId = the database entity id (the member is parented to the collective = database)', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'invite-admin-submit')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'invite-admin-submit') as HTMLElement);

		await waitFor(() => {
			expect(h.createInviteMock).toHaveBeenCalledTimes(1);
		});
		expect(h.createInviteMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'sampledb' }),
			{ dbEntityId: DB_ENTITY }
		);
	});
});

// (*MVOX:Tallis* — #161 RED)
