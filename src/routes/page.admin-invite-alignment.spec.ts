// @vitest-environment happy-dom
import { toListRead } from '$lib/testing/listReadFixtures';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		admin_roles_title: () => 'Role management',
		admin_roles_no_collective: () => 'Select a collective to manage roles.',
		admin_roles_no_access: () => 'Managing roles requires administrator rights.',
		admin_roles_load_error: () => 'Could not load role management.',
		admin_roles_retry_load: () => 'Retry',
		admin_roles_admins_title: () => 'Administrators',
		admin_roles_librarians_title: () => 'Librarians',
		admin_roles_add_admin_label: () => 'Add an administrator',
		admin_roles_add_admin_placeholder: () => 'Add administrator…',
		admin_roles_add_librarian_label: () => 'Add a librarian',
		admin_roles_add_librarian_placeholder: () => 'Add librarian…',
		picker_everyone_added: () => 'Everyone is already added',
		picker_no_members: () => 'No members to add',
		picker_order_fallback: () => 'Sorted by name — section order unavailable',
		admin_roles_remove: (p: { name: string }) => `Remove ${p.name}`,
		admin_roles_last_owner_hint: () => 'The last owner cannot be removed.',
		admin_roles_no_library: () => 'No library entity is visible in this collective.',
		admin_roles_action_error: () => 'Role change failed.',
		admin_roles_read_only: () => 'Only an owner of this collective can change these roles.',
		admin_roles_remove_self_hint: () => 'Cannot remove your own rights.',
		admin_roles_role_owner: () => 'omanik',
		admin_roles_role_editor: () => 'toimetaja',
		admin_collective_name_edit_aria_label: () => 'Edit collective name',
		admin_collective_name_save_error: () => "Couldn't save.",
		nav_admin: () => 'Admin',
		admin_invite_title: () => 'Invite a new member',
		admin_invite_no_collective: () => 'Select a collective before creating invites.',
		admin_invite_no_access: () => 'Creating invites requires administrator rights.',
		admin_invite_load_error: () => 'Could not load invite prerequisites.',
		admin_invite_retry_load: () => 'Retry',
		admin_invite_db_label: () => 'Collective',
		admin_invite_submit: () => 'Create invite',
		admin_invite_creating: () => 'Creating…',
		admin_invite_link_label: () => 'Invite link',
		admin_invite_copy: () => 'Copy link',
		admin_invite_copied: () => 'Copied',
		admin_invite_bearer_warning: () => 'Bearer secret — send only to the invited person.',
		admin_invite_show_once: (p: { date: string }) => `Shown only once. Expires on ${p.date}.`,
		admin_invite_error: () => 'Invite creation failed.',
		admin_invite_copy_error: () => "Couldn't copy the link.",
		admin_invite_partial_failure: (p: { personId: string }) =>
			`A person entity (${p.personId}) was already created and carries a live invite token.`,
		admin_invite_create_another: () => 'Create another invite',
		admin_invite_person_label: () => 'Who are you inviting?',
		admin_invite_person_new: () => 'A new person',
		admin_invite_submit_person: (p: { name: string }) => `Invite ${p.name}`,
		admin_invite_person_list_error: () => 'Could not load the list of uninvited people.',
		admin_invite_mint_error: (p: { name: string }) => `Could not invite ${p.name}.`,
		admin_invite_mint_owner_only: () => 'Inviting an existing person requires owner rights.',
		roster_member_invite_owner_only: () => 'Managing invites requires owner rights.'
	})
);

const h = vi.hoisted(() => {
	class RoleLockoutError extends Error {
		readonly code = 'role-lockout';
		constructor(entityId: string, personId: string) {
			super(`lockout ${entityId}/${personId}`);
			this.name = 'RoleLockoutError';
		}
	}
	class RoleGrantMissingError extends Error {
		readonly code = 'role-grant-missing';
		constructor(entityId: string, personId: string) {
			super(`missing ${entityId}/${personId}`);
			this.name = 'RoleGrantMissingError';
		}
	}
	class InviteCreateError extends Error {
		readonly phase: string;
		readonly reason: string;
		readonly personId?: string;
		constructor(message: string, opts: { phase: string; reason: string; personId?: string }) {
			super(message);
			this.name = 'InviteCreateError';
			this.phase = opts.phase;
			this.reason = opts.reason;
			this.personId = opts.personId;
		}
	}
	return {
		RoleLockoutError,
		RoleGrantMissingError,
		InviteCreateError,
		listAdminsMock: vi.fn(),
		addAdminMock: vi.fn(),
		removeAdminMock: vi.fn(),
		listLibrariansMock: vi.fn(),
		addLibrarianMock: vi.fn(),
		removeLibrarianMock: vi.fn(),
		resolveAdminMock: vi.fn(),
		resolveOwnerTierMock: vi.fn().mockResolvedValue('error'),
		resolveLibrarianMock: vi.fn(),
		loadRosterMock: vi.fn(),
		resolveParentMock: vi.fn(),
		resolveInviteParentMock: vi.fn(),
		createInviteMock: vi.fn(),
		listJoinStatesMock: vi.fn().mockResolvedValue({}),
		resolveCollectiveNameMarkerMock: vi.fn(),
		updateCollectiveNameMock: vi.fn()
	};
});
vi.mock('$lib/admin/roleManagement', () => ({
	RoleLockoutError: h.RoleLockoutError,
	RoleGrantMissingError: h.RoleGrantMissingError,
	fetchRights: vi.fn(),
	listAdmins: h.listAdminsMock,
	addAdmin: h.addAdminMock,
	removeAdmin: h.removeAdminMock,
	listLibrarians: h.listLibrariansMock,
	addLibrarian: h.addLibrarianMock,
	removeLibrarian: h.removeLibrarianMock
}));
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: h.resolveAdminMock,
	resolveOwnerTier: h.resolveOwnerTierMock
}));
vi.mock('$lib/library/librarianStore', () => ({
	resolveLibrarian: h.resolveLibrarianMock
}));
vi.mock('$lib/profile/linkedIdentities', () => ({
	listJoinStates: h.listJoinStatesMock
}));
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: h.loadRosterMock
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
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

import AdminPage from './admin/+page.svelte';
import InvitePage from './admin/invite/+page.svelte';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';

const STANDALONE_ROOT_CLASSES = 'mx-auto flex w-full max-w-md flex-col gap-4';
const EMBEDDED_ROOT_CLASSES = 'flex w-full flex-col gap-4';

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({
		persons: [{ id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] }],
		canManage: true
	});
	h.listLibrariansMock.mockResolvedValue({
		persons: [{ id: 'p-cilla', name: 'Cilla Cane', role: 'editor' as const, valueIds: ['pv-ed-cilla'] }],
		canManage: true
	});
	h.loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
		{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' }
	]));
	listSectionsMock.mockResolvedValue([]);
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
}

function inviteSurfaceRoot(scope: ParentNode, headingLevel: 'h1' | 'h2'): HTMLElement {
	const headings = Array.from(scope.querySelectorAll(headingLevel)).filter(
		(el) => el.textContent?.trim() === 'Invite a new member'
	);
	expect(headings, `expected exactly one ${headingLevel} "Invite a new member"`).toHaveLength(1);
	const root = headings[0].parentElement as HTMLElement;
	expect(root).not.toBeNull();
	expect(root.tagName).toBe('DIV');
	return root;
}

beforeEach(() => {
	for (const mock of [
		h.listAdminsMock,
		h.addAdminMock,
		h.removeAdminMock,
		h.listLibrariansMock,
		h.addLibrarianMock,
		h.removeLibrarianMock,
		h.resolveAdminMock,
		h.resolveLibrarianMock,
		resolveDatabaseEntityIdMock,
		h.loadRosterMock,
		listSectionsMock,
		h.resolveParentMock,
		h.resolveInviteParentMock,
		h.createInviteMock,
		h.resolveCollectiveNameMarkerMock,
		h.updateCollectiveNameMock
	]) {
		mock.mockReset();
	}
});

afterEach(() => {
	cleanup();
	resetAppState();
});

describe('#235 — embedded InviteSurface on /admin (integration: real route page)', () => {
	async function renderAdminReady() {
		selectSampledb();
		loadOk();
		const { container } = render(AdminPage);
		const section = await waitFor(() => {
			const el = container.querySelector<HTMLElement>('[data-testid="admin-invite-section"]');
			expect(el, 'expected the embedded invite section to render').not.toBeNull();
			return el!;
		});
		return { container, section };
	}

	it('root div drops BOTH centering tokens — full class string is exactly the standalone string minus mx-auto/max-w-md', async () => {
		const { section } = await renderAdminReady();
		const root = inviteSurfaceRoot(section, 'h2');

		expect(Array.from(root.classList)).not.toContain('mx-auto');
		expect(Array.from(root.classList)).not.toContain('max-w-md');
		expect(Array.from(root.classList).filter((c) => c.startsWith('max-w-'))).toEqual([]);

		expect(root.getAttribute('class')).toBe(EMBEDDED_ROOT_CLASSES);
	});

	it('aligns like its siblings: Administrators/Librarians sections carry no width/centering of their own, and neither does the invite section wrapper', async () => {
		const { container, section } = await renderAdminReady();

		for (const testid of ['admin-roles-admins', 'admin-roles-librarians']) {
			const sibling = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
			expect(sibling, `expected [data-testid="${testid}"]`).not.toBeNull();
			expect(sibling!.getAttribute('class')).toBe('flex flex-col gap-3');
		}
		expect(section.getAttribute('class')).toBe('flex flex-col gap-3');
		expect(section.querySelector('.mx-auto')).toBeNull();
		expect(section.querySelector('.max-w-md')).toBeNull();
	});
});

describe('#235 — standalone /admin/invite stays pixel-identical (integration: real route page)', () => {
	it("root div class string is byte-identical to today's — the component's own classes remain the sole centering mechanism on the full-bleed route", async () => {
		selectSampledb();
		h.resolveParentMock.mockResolvedValue('parent-1');
		h.resolveInviteParentMock.mockResolvedValue('org-1');

		const { container } = render(InvitePage);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});

		const root = inviteSurfaceRoot(container, 'h1');
		expect(root.getAttribute('class')).toBe(STANDALONE_ROOT_CLASSES);

		const main = container.querySelector('main');
		expect(main).not.toBeNull();
		expect(main!.getAttribute('class')).toBe('min-h-screen bg-paper px-6 py-10 text-ink');
	});
});

// (*MVOX:Tallis* — #235 RED: class contract for InviteSurface per mount site)
