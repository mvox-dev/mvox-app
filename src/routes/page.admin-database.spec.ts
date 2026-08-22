// @vitest-environment happy-dom
//
// #161 RED — the /admin page resolves the collective as the DATABASE entity
// (integration: real admin/+page.svelte + embedded InviteSurface; data seams
// mocked — same harness family as page.admin.spec.ts).
//
// Pinned wiring contract (GREEN must implement):
//   - the page imports `resolveDatabaseEntityId` ($lib/collective/databaseEntity)
//     — the #161 successor of `resolveMyDbEntityId` — and threads ITS id into
//     `listAdmins`/`addAdmin`/`removeAdmin` (signature-compatible: an entity id
//     is an entity id) and into the embedded InviteSurface's preset, so the
//     member created by an invite is parented to the DATABASE entity.
//   - NO wire traffic resolves the collective besides that seam: `entuFetch` is
//     stubbed to REJECT, so a leftover member/organization walk fails loudly.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const h = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	addAdminMock: vi.fn(),
	removeAdminMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	addLibrarianMock: vi.fn(),
	removeLibrarianMock: vi.fn(),
	resolveAdminMock: vi.fn(),
	resolveLibrarianMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	entuFetchMock: vi.fn(),
	loadRosterMock: vi.fn(),
	resolveParentMock: vi.fn(),
	createInviteMock: vi.fn(),
	// #165 — the page's `load()` now also resolves the collective-name marker.
	// Mocked here purely as scaffolding (this file has no opinion on that
	// surface) so it doesn't fall through the disabled `entuFetch` wire below.
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
	return { ...actual, resolveAdmin: h.resolveAdminMock };
});
vi.mock('$lib/library/librarianStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/library/librarianStore')>();
	return { ...actual, resolveLibrarian: h.resolveLibrarianMock };
});
// #161 — THE resolution seam (see module header).
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: h.resolveDatabaseEntityIdMock };
});
// Every OTHER wire path is disabled — a leftover resolveMyDbEntityId walk rejects.
vi.mock('$lib/entu/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/entu/request')>();
	return { ...actual, entuFetch: h.entuFetchMock };
});
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRosterMock }));
// #165 scaffolding (see the hoisted mock's comment above).
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
// InviteSurface's data seam — createInvite captured so the spec can assert the
// member's structural parent; resolvePersonParentId mocked (its own #161-correct
// database read would otherwise hit the disabled wire).
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
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // the database entity — THE collective (#161)

const ANNA: RolePerson = {
	id: 'p-anna',
	name: 'Anna Arro',
	role: 'owner',
	valueIds: ['pv-own-anna']
};

const ROSTER = [{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }];

function selectPolyphony() {
	setToken('jwt-admin');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'admin-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue(DB_ENTITY);
	h.entuFetchMock.mockRejectedValue(
		new Error(
			'wire disabled in this spec — collective resolution must go through resolveDatabaseEntityId'
		)
	);
	h.resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(ROSTER);
	h.resolveParentMock.mockResolvedValue(DB_ENTITY);
	h.createInviteMock.mockResolvedValue({
		personId: 'p-new',
		memberId: 'm-new',
		inviteToken: 'a.b.c'
	});
	// #165 scaffolding — benign resolution, see the hoisted mock's comment.
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	selectPolyphony();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});
	return container;
}

describe('/admin — the role lists are keyed to the DATABASE entity (#161)', () => {
	it('reaches ready via resolveDatabaseEntityId and hands ITS id to listAdmins — no member/organization wire walk', async () => {
		await renderReady();

		expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalled();
		expect(h.resolveDatabaseEntityIdMock.mock.calls[0][0]).toMatchObject({ db: 'polyphony' });

		expect(h.listAdminsMock).toHaveBeenCalled();
		// listAdmins(cfg, <collective entity id>, viewerId, …) — the collective
		// entity IS the database entity now.
		expect(h.listAdminsMock.mock.calls[0][1]).toBe(DB_ENTITY);

		// With every seam mocked, the page itself has no business on the wire.
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
			expect.objectContaining({ db: 'polyphony' }),
			{ dbEntityId: DB_ENTITY }
		);
	});
});

// (*MVOX:Tallis* — #161 RED)
