// @vitest-environment happy-dom
import { toListRead } from '$lib/testing/listReadFixtures';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

const h = vi.hoisted(() => ({
	resolveAdminMock: vi.fn(),
	resolveOwnerTierMock: vi.fn().mockResolvedValue('error'),
	resolveLibrarianMock: vi.fn(),
}));

vi.mock('$lib/admin/roleManagement', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).roleManagementOverRealModule(importOriginal)
);
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
vi.mock('$lib/entu/request', async (importOriginal) =>
	(await import('$lib/testing/mocks/seasons')).entuRequestModule(importOriginal)
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/profile/linkedIdentities', async () =>
	(await import('$lib/testing/mocks/admin')).joinStatesModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', async () =>
	(await import('$lib/testing/mocks/admin')).collectiveNameModule()
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteDataOverRealModule(importOriginal)
);
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
import {
	createInviteMock,
	listAdminsMock,
	listJoinStatesMock,
	listLibrariansMock,
	resolveCollectiveNameMarkerMock,
	resolveParentMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { entuFetchMock } from '$lib/testing/mocks/seasons';

// Defaults the hoisted handles carried before they moved to the shared mocks.
listJoinStatesMock.mockResolvedValue({});

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
	entuFetchMock.mockRejectedValue(
		new Error(
			'wire disabled in this spec — collective resolution must go through resolveDatabaseEntityId'
		)
	);
	h.resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	resolveParentMock.mockResolvedValue(DB_ENTITY);
	createInviteMock.mockResolvedValue({
		personId: 'p-new',
		memberId: 'm-new',
		inviteToken: 'a.b.c'
	});
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	updateCollectiveNameMock.mockResolvedValue(undefined);
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

		expect(listAdminsMock).toHaveBeenCalled();
		expect(listAdminsMock.mock.calls[0][1]).toBe(DB_ENTITY);

		expect(entuFetchMock).not.toHaveBeenCalled();
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
			expect(createInviteMock).toHaveBeenCalledTimes(1);
		});
		expect(createInviteMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'sampledb' }),
			{ dbEntityId: DB_ENTITY }
		);
	});
});

// (*MVOX:Tallis* — #161 RED)
