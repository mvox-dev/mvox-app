// Admin page harness (no page import): the setup its specs had word for word.
import type { RolePerson } from '$lib/admin/roleManagement';
import { testCfg } from '$lib/testing/entuFetchKit';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	addAdminMock,
	addLibrarianMock,
	createInviteMock,
	listAdminsMock,
	listJoinStatesMock,
	listLibrariansMock,
	removeAdminMock,
	removeLibrarianMock,
	resolveAdminMock,
	resolveCollectiveNameMarkerMock,
	resolveInviteParentMock,
	resolveLibrarianMock,
	resolveOwnerTierMock,
	resolveParentMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { signIn } from '$lib/testing/session';

export const CFG = testCfg('sampledb', 'jwt-admin');

export const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // the database entity: THE collective (#161)

export const ANNA = {
	id: 'p-anna',
	name: 'Anna Arro',
	role: 'owner' as const,
	valueIds: ['pv-own-anna']
};
export const BELA = {
	id: 'p-bela',
	name: 'Bela Brauer',
	role: 'editor' as const,
	valueIds: ['pv-ed-bela']
};
export const CILLA = {
	id: 'p-cilla',
	name: 'Cilla Cane',
	role: 'editor' as const,
	valueIds: ['pv-ed-cilla']
};

export const ROSTER = [
	{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' },
	{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' },
	{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '' }
];

export function listing(persons: RolePerson[], canManage = true) {
	return { persons, canManage };
}

export function selectSampledb(): void {
	signIn({
		token: 'jwt-admin',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }]
	});
}

export function loadOk(): void {
	resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	listAdminsMock.mockResolvedValue(listing([ANNA, BELA]));
	listLibrariansMock.mockResolvedValue(listing([CILLA]));
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	addAdminMock.mockResolvedValue(undefined);
	addLibrarianMock.mockResolvedValue(undefined);
	removeAdminMock.mockResolvedValue(undefined);
	removeLibrarianMock.mockResolvedValue(undefined);
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	updateCollectiveNameMock.mockResolvedValue(undefined);
	resolveOwnerTierMock.mockResolvedValue('error');
	listJoinStatesMock.mockResolvedValue({});
}

export function resetAdminMocks(): void {
	for (const mock of [
		listAdminsMock,
		addAdminMock,
		removeAdminMock,
		listLibrariansMock,
		addLibrarianMock,
		removeLibrarianMock,
		resolveAdminMock,
		resolveLibrarianMock,
		resolveDatabaseEntityIdMock,
		loadRosterMock,
		listSectionsMock,
		resolveParentMock,
		resolveInviteParentMock,
		createInviteMock,
		resolveCollectiveNameMarkerMock,
		updateCollectiveNameMock
	]) {
		mock.mockReset();
	}
}

export function resetInviteMocks(): void {
	resolveParentMock.mockReset();
	resolveInviteParentMock.mockReset();
	createInviteMock.mockReset();
}

export function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

export function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

// (*MVOX:Josquin*)
