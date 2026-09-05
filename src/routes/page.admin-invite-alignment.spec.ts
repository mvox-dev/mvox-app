// @vitest-environment happy-dom
//
// #235 RED — InviteSurface root-layout class contract, per mount site.
//
// Defect (Mihkel live-gate, 2026-09-03): InviteSurface's root div hardcodes
// `mx-auto flex w-full max-w-md flex-col gap-4` (InviteSurface.svelte:285).
// Correct on the standalone /admin/invite route (full-bleed main — the
// component's own classes are the SOLE centering mechanism there). But /admin
// embeds the same component inside its own centered `max-w-2xl` column
// (admin/+page.svelte:501), whose sibling sections (Administrators,
// Librarians) are plain `flex flex-col gap-3` — full column width. The
// embedded invite section is the ONLY one that re-constrains its own width,
// so it renders as a narrower block centered INSIDE the column: its h2 and
// content sit indented relative to the page h1 and the sibling h2s on any
// viewport wider than ~28rem.
//
// Contract pinned here (nothing pinned these classes before — full-string
// assertions, house partial-assertion rule):
// - EMBEDDED (/admin, the real route page — integration mount): the
//   InviteSurface root div carries NO mx-auto and NO max-w-md; its class
//   string is exactly today's minus those two tokens, so the section fills
//   the column flush like its siblings.
// - STANDALONE (/admin/invite, the real route page): the root div class
//   string stays byte-identical to today's — pixel-identity regression pin
//   (this one is GREEN at RED time by design; the embedded pins are the
//   failing half).
//
// Mechanism (engineer's call, GREEN): expected to follow the existing
// `heading` prop pattern — a layout/embedded prop defaulting to today's
// standalone classes, gated off at the /admin embed only.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		// /admin role-management surface
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
		// InviteSurface (both mounts)
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
		admin_invite_create_another: () => 'Create another invite'
	}
}));

// Mock every data seam at its module boundary — same discipline and shapes as
// page.admin.spec.ts / page.admin-invite.spec.ts (error classes inside the
// hoisted block so `instanceof` checks in the pages match).
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
		resolveLibrarianMock: vi.fn(),
		resolveDatabaseEntityIdMock: vi.fn(),
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		resolveParentMock: vi.fn(),
		resolveInviteParentMock: vi.fn(),
		createInviteMock: vi.fn(),
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
	resolveAdmin: h.resolveAdminMock
}));
vi.mock('$lib/library/librarianStore', () => ({
	resolveLibrarian: h.resolveLibrarianMock
}));
vi.mock('$lib/collective/databaseEntity', () => ({
	resolveDatabaseEntityId: h.resolveDatabaseEntityIdMock
}));
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: h.loadRosterMock
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: h.listSectionsMock
}));
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
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import AdminPage from './admin/+page.svelte';
import InvitePage from './admin/invite/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// The exact root class string InviteSurface ships today. The STANDALONE mount
// must keep this byte-identical (pixel-identity); the EMBEDDED mount must drop
// exactly the two centering tokens and keep the rest byte-identical.
const STANDALONE_ROOT_CLASSES = 'mx-auto flex w-full max-w-md flex-col gap-4';
const EMBEDDED_ROOT_CLASSES = 'flex w-full flex-col gap-4';

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

function loadOk() {
	// /admin's own resolutions
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({
		persons: [{ id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] }],
		canManage: true
	});
	h.listLibrariansMock.mockResolvedValue({
		persons: [{ id: 'p-cilla', name: 'Cilla Cane', role: 'editor' as const, valueIds: ['pv-ed-cilla'] }],
		canManage: true
	});
	h.loadRosterMock.mockResolvedValue([
		{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
		{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' }
	]);
	h.listSectionsMock.mockResolvedValue([]);
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
	// InviteSurface's prerequisite resolution (both mounts)
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
}

/** InviteSurface's root div, located structurally: the element rendering the
 *  invite title heading is the root div's first child — robust against the
 *  class changes this very spec pins. */
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
		h.resolveDatabaseEntityIdMock,
		h.loadRosterMock,
		h.listSectionsMock,
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
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('#235 — embedded InviteSurface on /admin (integration: real route page)', () => {
	async function renderAdminReady() {
		selectPolyphony();
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

		// Readable diagnostics first: the two tokens that cause the mis-indent.
		expect(Array.from(root.classList)).not.toContain('mx-auto');
		expect(Array.from(root.classList)).not.toContain('max-w-md');
		// No self-width-constraint of ANY size when embedded — the max-w-2xl
		// column (admin/+page.svelte:501) is the only width authority.
		expect(Array.from(root.classList).filter((c) => c.startsWith('max-w-'))).toEqual([]);

		// Full-string pin (house rule — partial assertions hide bugs): every
		// OTHER token stays byte-identical, in today's order.
		expect(root.getAttribute('class')).toBe(EMBEDDED_ROOT_CLASSES);
	});

	it('aligns like its siblings: Administrators/Librarians sections carry no width/centering of their own, and neither does the invite section wrapper', async () => {
		const { container, section } = await renderAdminReady();

		// Sibling oracle — the sections the invite block must sit flush with.
		for (const testid of ['admin-roles-admins', 'admin-roles-librarians']) {
			const sibling = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
			expect(sibling, `expected [data-testid="${testid}"]`).not.toBeNull();
			expect(sibling!.getAttribute('class')).toBe('flex flex-col gap-3');
		}
		// The invite section wrapper itself already matches that pattern…
		expect(section.getAttribute('class')).toBe('flex flex-col gap-3');
		// …so the ONLY way the invite content can sit indented is InviteSurface's
		// own root re-centering itself. Pin the whole subtree free of the tokens.
		expect(section.querySelector('.mx-auto')).toBeNull();
		expect(section.querySelector('.max-w-md')).toBeNull();
	});
});

describe('#235 — standalone /admin/invite stays pixel-identical (integration: real route page)', () => {
	it("root div class string is byte-identical to today's — the component's own classes remain the sole centering mechanism on the full-bleed route", async () => {
		selectPolyphony();
		h.resolveParentMock.mockResolvedValue('parent-1');
		h.resolveInviteParentMock.mockResolvedValue('org-1');

		const { container } = render(InvitePage);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});

		const root = inviteSurfaceRoot(container, 'h1');
		expect(root.getAttribute('class')).toBe(STANDALONE_ROOT_CLASSES);

		// The route wrapper stays a full-bleed main with no width constraint of
		// its own (admin/invite/+page.svelte:15) — pinned so a "fix" cannot move
		// the centering problem out here and silently change the standalone page.
		const main = container.querySelector('main');
		expect(main).not.toBeNull();
		expect(main!.getAttribute('class')).toBe('min-h-screen bg-paper px-6 py-10 text-ink');
	});
});

// (*MVOX:Tallis* — #235 RED: class contract for InviteSurface per mount site)
