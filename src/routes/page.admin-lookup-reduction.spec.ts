// @vitest-environment happy-dom
import { toListRead } from '$lib/testing/listReadFixtures';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '$lib/testing/entuFetchKit';

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
	resolveDatabaseEntityIdMock: vi.fn(),
	entuFetchMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
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
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: h.resolveDatabaseEntityIdMock };
});
vi.mock('$lib/entu/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/entu/request')>();
	return { ...actual, entuFetch: h.entuFetchMock };
});
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: h.listSectionsMock
}));
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
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './admin/+page.svelte';
import type { RolePerson } from '$lib/admin/roleManagement';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // the database entity — THE collective
const VIEWER = 'admin-p';

const ANNA: RolePerson = {
	id: 'p-anna',
	name: 'Anna Arro',
	role: 'owner',
	valueIds: ['pv-own-anna']
};

const ROSTER = [{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }];

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: VIEWER }] });
}

beforeEach(() => {
	h.resolveDatabaseEntityIdMock.mockResolvedValue(DB_ENTITY);
	h.entuFetchMock.mockImplementation((_db: string, path: string) => {
		if (path.startsWith(`entity/${DB_ENTITY}?props=_owner`)) {
			return Promise.resolve(
				json({ entity: { _id: DB_ENTITY, _owner: [{ reference: VIEWER }], _editor: [] } })
			);
		}
		if (path.includes('_type.string=library')) {
			// Factual "no library in this collective": refreshRole('librarian') is skipped.
			return Promise.resolve(json({ entities: [] }));
		}
		if (path.includes('props=entu_user')) {
			return Promise.resolve(
				json({
					entity: {
						entu_user: [{ _id: 'eu-anna', uid: 'u-anna', provider: 'google', email: 'a@x.test' }]
					}
				})
			);
		}
		return Promise.reject(
			new Error(`unexpected wire traffic during admin load: ${path} (#173 harness)`)
		);
	});
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	h.listSectionsMock.mockResolvedValue([]);
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

function fetchedPaths(): string[] {
	return h.entuFetchMock.mock.calls.map((c) => String(c[1]));
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	selectSampledb();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});
	// The admins' sign-in lookup is the load's last read; without it, it lands in the next test.
	await waitFor(() => expect(fetchedPaths().some((p) => p.includes('props=entu_user'))).toBe(true));
	return container;
}

describe('/admin — one database-entity resolution per load (#173)', () => {
	it('reaches ready with resolveDatabaseEntityId called exactly ONCE', async () => {
		await renderReady();

		expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(1);
	});

	it('same data, fewer fetches — the id still reaches listAdmins and the rights/library reads still happen', async () => {
		await renderReady();

		expect(h.listAdminsMock).toHaveBeenCalled();
		expect(h.listAdminsMock.mock.calls[0][1]).toBe(DB_ENTITY);

		const paths = fetchedPaths();
		expect(paths.filter((p) => p.startsWith(`entity/${DB_ENTITY}?props=_owner`))).toHaveLength(2);
		expect(paths.filter((p) => p.includes('_type.string=library'))).toHaveLength(1);
		expect(paths.filter((p) => p.includes('props=entu_user'))).toHaveLength(1);
		expect(paths).toHaveLength(4);
	});
});
