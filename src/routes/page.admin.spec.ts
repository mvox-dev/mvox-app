// @vitest-environment happy-dom
//
// #134/S3 RED — the /admin role-management surface. Contract:
//
// - no available collective → no-collective state, zero data calls
// - access gate: `resolveAdmin` (adminStore) answers per-person on HER OWN org —
//   'not-admin' → no-access block, NO role data is fetched; 'error' → load-error
//   + retry (a network failure is NEVER presented as "not admin" — house rule)
// - ready → two managed lists:
//     - Administrators: `listAdmins(cfg, orgId)` — orgId from `resolveDatabaseEntityId`
//       (the person's own member `_parent`; never an `organization&limit=1`
//       guess, which live-returns the umbrella federation)
//     - Librarians: `listLibrarians(cfg, libraryId)` — libraryId from
//       `resolveLibrarian`'s result (the existing library-entity resolution;
//       no new lookup invented). libraryId null → no-library state, list
//       fetch skipped
// - adding: one REUSED Autocomplete (#132 T2) per section, fed from the roster
//   (loadRoster) — people already holding the section's role are EXCLUDED from
//   the options; free text NEVER grants (allowFreeText stays off); a pick calls
//   addAdmin/addLibrarian and the list refetches
// - removing: a remove button per entry → removeAdmin/removeLibrarian + refetch;
//   the LAST 'owner' entry's button is DISABLED (lockout prevention, UI leg —
//   the data layer's RoleLockoutError is the enforcement leg); a LIBRARY owner's
//   button is DISABLED too (removeLibrarian is 'editor-only' scope and would
//   reject before any write — a guaranteed dead click); a rejected remove
//   surfaces a generic localized action error (raw message stays out of the
//   DOM), the entry stays listed
// - write gate: the listing's `canManage` (viewer holds an `_owner` value on the
//   entity, inherited included) decides whether the WRITE controls exist at all.
//   `resolveAdmin` says 'admin' for a mere org `_editor`, but entu-api 403s
//   every rights write from a non-owner — so an org editor sees the lists
//   read-only: no Autocomplete, every Remove disabled, a localized explanation
// - navigation: NAV_ENTRIES carries an admin-only /admin entry
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		admin_roles_title: () => 'Role management',
		admin_roles_no_collective: () => 'Select a collective to manage roles.',
		admin_roles_no_access: () => 'Managing roles requires administrator rights.',
		admin_roles_load_error: () => 'Could not load role management.',
		admin_roles_retry_load: () => 'Retry',
		admin_roles_admins_title: () => 'Administrators',
		admin_roles_librarians_title: () => 'Librarians',
		admin_roles_add_admin_label: () => 'Add an administrator',
		admin_roles_add_admin_placeholder: () => 'Search people…',
		admin_roles_add_librarian_label: () => 'Add a librarian',
		admin_roles_add_librarian_placeholder: () => 'Search people…',
		admin_roles_remove: (p: { name: string }) => `Remove ${p.name}`,
		admin_roles_last_owner_hint: () => 'The last owner cannot be removed.',
		admin_roles_no_library: () => 'No library entity is visible in this collective.',
		admin_roles_action_error: () => 'Role change failed.',
		admin_roles_empty: () => 'No matching people.',
		admin_roles_read_only: () => 'Only an owner of this collective can change these roles.',
		admin_roles_remove_self_hint: () => 'Cannot remove your own rights.',
		// Deliberately NOT the English words: the row badge must render the
		// localized label, never the raw `RolePerson.role` enum. An assertion on
		// 'owner'/'editor' would pass against `{person.role}` and prove nothing.
		admin_roles_role_owner: () => 'omanik',
		admin_roles_role_editor: () => 'toimetaja',
		nav_admin: () => 'Admin',
		// #140/S3 — the merged /admin page now also renders InviteSurface
		// (src/lib/components/admin/InviteSurface.svelte); this file doesn't
		// exercise the invite flow itself (that's page.navshell-merge.spec.ts +
		// page.admin-invite.spec.ts), but the component still renders its own
		// heading/labels and needs every key it can reach in its default states.
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

// Mock every data seam at its module boundary. Error classes are defined
// INSIDE the hoisted block so `instanceof` checks in the page match the
// instances these tests reject with.
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
	// #140/S3 — InviteSurface's own error class, mirrored here so the embedded
	// component's `instanceof` checks match (see page.admin-invite.spec.ts /
	// page.navshell-merge.spec.ts for the same pattern).
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
		resolveParentMock: vi.fn(),
		resolveOrgMock: vi.fn(),
		createInviteMock: vi.fn()
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
// #140/S3 — the merged page also mounts InviteSurface; mock its data seam at
// the same boundary page.admin-invite.spec.ts / page.navshell-merge.spec.ts use.
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: h.resolveParentMock,
	resolveOrgId: h.resolveOrgMock,
	createInvite: h.createInviteMock
}));
// Sever the $env chain the collectives store pulls in (discover → marker →
// entu-config) and the store's `goto` import — same discipline as
// page.admin-invite.spec.ts.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

import Page from './admin/+page.svelte';
import type { RolePerson } from '$lib/admin/roleManagement';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { NAV_ENTRIES } from '$lib/nav/entries';

const CFG = { db: 'polyphony', token: 'jwt-admin' };

// RolePerson rows as listAdmins/listLibrarians answer them — ONE ROW PER PERSON,
// carrying EVERY backing rights property value id (see roleManagement.spec.ts,
// rollup contract). The route keys its {#each} on `id`, so a repeated id would
// take the whole page down with Svelte's `each_key_duplicate`.
const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] };
const BELA = {
	id: 'p-bela',
	name: 'Bela Brauer',
	role: 'editor' as const,
	valueIds: ['pv-ed-bela']
};
const CILLA = {
	id: 'p-cilla',
	name: 'Cilla Cane',
	role: 'editor' as const,
	valueIds: ['pv-ed-cilla']
};
const DORA_ADMIN = {
	id: 'p-dora',
	name: 'Dora Duncan',
	role: 'editor' as const,
	valueIds: ['pv-ed-dora']
};

/**
 * The `{ persons, canManage }` shape listAdmins/listLibrarians resolve with.
 * `RolePerson` is imported for real (type-only — erased, so the vi.mock above
 * still stands) so these fixtures cannot drift from the data layer's contract.
 */
function listing(persons: RolePerson[], canManage = true) {
	return { persons, canManage };
}

// The person source for BOTH autocompletes: the roster (personId + name).
const ROSTER = [
	{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' },
	{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' },
	{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '' }
];

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
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue(listing([ANNA, BELA]));
	h.listLibrariansMock.mockResolvedValue(listing([CILLA]));
	h.loadRosterMock.mockResolvedValue(ROSTER);
	h.addAdminMock.mockResolvedValue(undefined);
	h.addLibrarianMock.mockResolvedValue(undefined);
	h.removeAdminMock.mockResolvedValue(undefined);
	h.removeLibrarianMock.mockResolvedValue(undefined);
	// #140/S3 — InviteSurface's own prerequisite resolution, so the embedded
	// component settles into 'ready' instead of hanging mid-load.
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveOrgMock.mockResolvedValue('org-1');
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

/** The section container, asserted present. */
function section(container: HTMLElement, testid: string): HTMLElement {
	const el = q<HTMLElement>(container, testid);
	expect(el, `expected [data-testid="${testid}"] to be rendered`).not.toBeNull();
	return el!;
}

async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
		expect(q(rendered.container, 'admin-roles-librarians')).not.toBeNull();
	});
	return rendered;
}

/** Open a section's (reused #132 Autocomplete) combobox and pick an option. */
async function openCombobox(sectionEl: HTMLElement): Promise<HTMLInputElement> {
	const input = q<HTMLInputElement>(sectionEl, 'autocomplete-input');
	expect(input, 'expected the section to hold a reused Autocomplete combobox').not.toBeNull();
	expect(input!.getAttribute('role')).toBe('combobox');
	await fireEvent.keyDown(input!, { key: 'ArrowDown' });
	await waitFor(() => {
		expect(q(sectionEl, 'autocomplete-listbox')).not.toBeNull();
	});
	return input!;
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
		h.resolveParentMock,
		h.resolveOrgMock,
		h.createInviteMock
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

// ── access gate ─────────────────────────────────────────────────────────────────

describe('/admin — access gate', () => {
	it('without an available collective shows the no-collective state and issues ZERO data calls', async () => {
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-no-collective')).not.toBeNull();
		});
		expect(h.resolveAdminMock).not.toHaveBeenCalled();
		expect(h.listAdminsMock).not.toHaveBeenCalled();
		expect(h.listLibrariansMock).not.toHaveBeenCalled();
	});

	it("resolveAdmin → 'not-admin': the no-access block, and NO role data is fetched (the lists are rights-bearing reads)", async () => {
		selectPolyphony();
		loadOk();
		h.resolveAdminMock.mockResolvedValue('not-admin');

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-no-access')).not.toBeNull();
		});
		expect(container.textContent).toContain('administrator rights');
		expect(q(container, 'admin-roles-admins')).toBeNull();
		expect(q(container, 'admin-roles-librarians')).toBeNull();
		expect(h.listAdminsMock).not.toHaveBeenCalled();
		expect(h.listLibrariansMock).not.toHaveBeenCalled();

		// The gate ran per-person on the selected collective's cfg — the same
		// person-scoped resolution the nav uses, never an org guess.
		expect(h.resolveAdminMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'admin-p'
		);
	});

	it("resolveAdmin → 'error': the load-error state with retry — a network failure is NEVER rendered as not-admin", async () => {
		selectPolyphony();
		loadOk();
		h.resolveAdminMock.mockResolvedValueOnce('error');

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-load-error')).not.toBeNull();
		});
		expect(q(container, 'admin-roles-no-access')).toBeNull();

		// Retry is real: with the backend recovered, the same button reaches ready.
		h.resolveAdminMock.mockResolvedValue('admin');
		const retry = q<HTMLButtonElement>(container, 'admin-roles-retry-load');
		expect(retry).not.toBeNull();
		await fireEvent.click(retry!);
		await waitFor(() => {
			expect(q(container, 'admin-roles-admins')).not.toBeNull();
		});
	});
});

// ── ready — the two managed lists ───────────────────────────────────────────────

describe('/admin — role lists', () => {
	it('renders the admin + librarian lists off listAdmins(cfg, orgId) / listLibrarians(cfg, libraryId) — org from resolveDatabaseEntityId, library from resolveLibrarian (the EXISTING resolutions, no new lookups)', async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();

		const admins = section(container, 'admin-roles-admins');
		expect(q(admins, 'admin-entry-p-anna')).not.toBeNull();
		expect(q(admins, 'admin-entry-p-bela')).not.toBeNull();
		expect(admins.textContent).toContain('Anna Arro');
		expect(admins.textContent).toContain('Bela Brauer');

		const librarians = section(container, 'admin-roles-librarians');
		expect(q(librarians, 'librarian-entry-p-cilla')).not.toBeNull();
		expect(librarians.textContent).toContain('Cilla Cane');

		expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG)
		);
		expect(h.resolveLibrarianMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'admin-p'
		);
		// The VIEWER rides along: her own `_owner` membership on each entity is
		// what decides whether the write controls may be offered at all. The
		// roster rides along too (#146) — the id→name lookup for rows whose
		// display name hasn't caught up in Entu's aggregated read yet.
		expect(h.listAdminsMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'org-1',
			'admin-p',
			undefined,
			ROSTER
		);
		expect(h.listLibrariansMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'lib-1',
			'admin-p',
			undefined,
			ROSTER
		);
	});

	it('a person holding BOTH an _owner and a separate _editor value arrives as ONE folded row and renders ONE entry — a repeated key would kill the page (each_key_duplicate)', async () => {
		selectPolyphony();
		loadOk();
		const ANNA_FOLDED = { ...ANNA, valueIds: ['pv-own-anna', 'pv-ed-anna'] };
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA_FOLDED, BELA]));

		const { container } = await renderReady();

		expect(container.querySelectorAll('[data-testid="admin-entry-p-anna"]')).toHaveLength(1);
		const entries = container.querySelectorAll('[data-testid^="admin-entry-"]');
		expect(entries).toHaveLength(2);
		// Anna reports the outranking role, not one row per rights value.
		expect(q(container, 'admin-entry-p-anna')!.textContent).toContain('omanik');
	});

	it('the role badge renders the LOCALIZED label, never the raw RolePerson.role enum — in both lists', async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();

		expect(q(container, 'admin-entry-p-anna')!.textContent).toContain('(omanik)');
		expect(q(container, 'admin-entry-p-bela')!.textContent).toContain('(toimetaja)');
		expect(q(container, 'librarian-entry-p-cilla')!.textContent).toContain('(toimetaja)');
		// The wire enum must not reach the DOM anywhere on the page.
		expect(container.textContent).not.toContain('(owner)');
		expect(container.textContent).not.toContain('(editor)');
	});

	it('resolveLibrarian answering libraryId: null → the no-library state; listLibrarians is NOT called; the admin list still renders', async () => {
		selectPolyphony();
		loadOk();
		h.resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-admins')).not.toBeNull();
			expect(q(container, 'admin-roles-no-library')).not.toBeNull();
		});
		expect(h.listLibrariansMock).not.toHaveBeenCalled();
	});

	it("resolveLibrarian → { state: 'error', libraryId: null }: the load-error state with retry — a FAILED library read is NEVER rendered as \"no library exists\"", async () => {
		selectPolyphony();
		loadOk();
		h.resolveLibrarianMock.mockResolvedValueOnce({ state: 'error', libraryId: null });

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-load-error')).not.toBeNull();
		});
		// The failure must not masquerade as the legitimate "no library" answer.
		expect(q(container, 'admin-roles-no-library')).toBeNull();
		expect(container.textContent).not.toContain('No library entity is visible');
		expect(h.listLibrariansMock).not.toHaveBeenCalled();

		// Retry is real: with the library read recovered, the same button reaches ready.
		h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		const retry = q<HTMLButtonElement>(container, 'admin-roles-retry-load');
		expect(retry).not.toBeNull();
		await fireEvent.click(retry!);
		await waitFor(() => {
			expect(q(container, 'admin-roles-librarians')).not.toBeNull();
			expect(q(container, 'librarian-entry-p-cilla')).not.toBeNull();
		});
	});
});

// ── adding via the reused Autocomplete ──────────────────────────────────────────

describe('/admin — adding people (reused #132 Autocomplete, roster-fed)', () => {
	it('the admin combobox lists roster people MINUS current admins; a pick calls addAdmin(cfg, orgId, personId) and the list refetches with the new entry', async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock
			.mockReset()
			.mockResolvedValueOnce(listing([ANNA, BELA]))
			.mockResolvedValueOnce(listing([ANNA, BELA, DORA_ADMIN]));

		const { container } = await renderReady();
		expect(h.loadRosterMock).toHaveBeenCalledWith(expect.objectContaining(CFG));

		const admins = section(container, 'admin-roles-admins');
		await openCombobox(admins);

		// Already-admins are NOT offered again; everyone else is (Cilla is a
		// librarian but not an admin — she belongs in THIS list's options).
		expect(q(admins, 'autocomplete-option-p-anna')).toBeNull();
		expect(q(admins, 'autocomplete-option-p-bela')).toBeNull();
		expect(q(admins, 'autocomplete-option-p-cilla')).not.toBeNull();
		const dora = q<HTMLButtonElement>(admins, 'autocomplete-option-p-dora');
		expect(dora).not.toBeNull();

		await fireEvent.click(dora!);

		await waitFor(() => {
			expect(h.addAdminMock).toHaveBeenCalledWith(
				expect.objectContaining(CFG),
				'org-1',
				'p-dora'
			);
		});
		// The list is REFETCHED (server truth), not hand-patched only.
		await waitFor(() => {
			expect(h.listAdminsMock).toHaveBeenCalledTimes(2);
			expect(q(container, 'admin-entry-p-dora')).not.toBeNull();
		});
	});

	it('free text never grants: typing a non-roster name and pressing Enter calls NO add function', async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();
		const admins = section(container, 'admin-roles-admins');
		const input = await openCombobox(admins);

		await fireEvent.input(input, { target: { value: 'Nobody Anyone Knows' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(h.addAdminMock).not.toHaveBeenCalled();
		expect(h.addLibrarianMock).not.toHaveBeenCalled();
	});

	it('the librarian combobox excludes current librarians and a pick calls addLibrarian(cfg, libraryId, personId)', async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();
		const librarians = section(container, 'admin-roles-librarians');
		await openCombobox(librarians);

		// Cilla already IS a librarian → excluded HERE (though offered in the
		// admin list); Anna is an admin but not a librarian → offered here.
		expect(q(librarians, 'autocomplete-option-p-cilla')).toBeNull();
		expect(q(librarians, 'autocomplete-option-p-anna')).not.toBeNull();

		const dora = q<HTMLButtonElement>(librarians, 'autocomplete-option-p-dora');
		expect(dora).not.toBeNull();
		await fireEvent.click(dora!);

		await waitFor(() => {
			expect(h.addLibrarianMock).toHaveBeenCalledWith(
				expect.objectContaining(CFG),
				'lib-1',
				'p-dora'
			);
		});
	});
});

// ── removing ────────────────────────────────────────────────────────────────────

describe('/admin — removing people', () => {
	it('each admin entry carries a remove button; activating it calls removeAdmin(cfg, orgId, personId) and the list refetches', async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock
			.mockReset()
			.mockResolvedValueOnce(listing([ANNA, BELA]))
			.mockResolvedValueOnce(listing([ANNA]));

		const { container } = await renderReady();
		const removeBela = q<HTMLButtonElement>(container, 'admin-remove-p-bela');
		expect(removeBela).not.toBeNull();
		await fireEvent.click(removeBela!);

		await waitFor(() => {
			expect(h.removeAdminMock).toHaveBeenCalledWith(
				expect.objectContaining(CFG),
				'org-1',
				'p-bela'
			);
		});
		await waitFor(() => {
			expect(h.listAdminsMock).toHaveBeenCalledTimes(2);
			expect(q(container, 'admin-entry-p-bela')).toBeNull();
		});
	});

	it("the LAST 'owner' entry's remove button is DISABLED (lockout prevention, UI leg); editors' buttons stay enabled", async () => {
		selectPolyphony();
		loadOk(); // one owner (Anna) + one editor (Bela)

		const { container } = await renderReady();
		const removeAnna = q<HTMLButtonElement>(container, 'admin-remove-p-anna');
		const removeBela = q<HTMLButtonElement>(container, 'admin-remove-p-bela');
		expect(removeAnna).not.toBeNull();
		expect(removeBela).not.toBeNull();
		expect(removeAnna!.disabled).toBe(true);
		expect(removeBela!.disabled).toBe(false);
	});

	it('with TWO owners, BOTH owner remove buttons are enabled (the guard is about the last owner, not owners in general)', async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock
			.mockReset()
			.mockResolvedValue(
				listing([
					ANNA,
					{ id: 'p-emil', name: 'Emil Erg', role: 'owner' as const, valueIds: ['pv-own-emil'] }
				])
			);

		const { container } = await renderReady();
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-anna')!.disabled).toBe(false);
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-emil')!.disabled).toBe(false);
	});

	it('a rejected removeAdmin surfaces the generic localized action error (raw message stays OUT of the DOM) and the entry stays listed', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		loadOk();
		h.removeAdminMock.mockRejectedValue(new Error('remove failed: 500'));

		const { container } = await renderReady();
		await fireEvent.click(q<HTMLButtonElement>(container, 'admin-remove-p-bela')!);

		await waitFor(() => {
			expect(q(container, 'admin-roles-action-error')).not.toBeNull();
		});
		const errorBlock = q(container, 'admin-roles-action-error')!;
		expect(errorBlock.textContent).toContain('Role change failed.');
		expect(container.textContent).not.toContain('remove failed: 500');
		expect(q(container, 'admin-entry-p-bela')).not.toBeNull();

		consoleSpy.mockRestore();
	});

	it('each librarian entry carries a remove button wired to removeLibrarian(cfg, libraryId, personId)', async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();
		const removeCilla = q<HTMLButtonElement>(container, 'librarian-remove-p-cilla');
		expect(removeCilla).not.toBeNull();
		await fireEvent.click(removeCilla!);

		await waitFor(() => {
			expect(h.removeLibrarianMock).toHaveBeenCalledWith(
				expect.objectContaining(CFG),
				'lib-1',
				'p-cilla'
			);
		});
	});
});

// ── #147 self-lockout: an admin/librarian can never remove HER OWN rights ───────

describe('/admin — self-lockout guard (#147)', () => {
	// selectPolyphony() gives the viewer personId 'admin-p' — a row carrying
	// that same id is HER OWN grant.
	const SELF_EDITOR = {
		id: 'admin-p',
		name: 'Admin Person',
		role: 'editor' as const,
		valueIds: ['pv-ed-self']
	};
	const SELF_OWNER = {
		id: 'admin-p',
		name: 'Admin Person',
		role: 'owner' as const,
		valueIds: ['pv-own-self']
	};

	it("an admin holding only _editor sees HER OWN remove button disabled, even though canManage is true and she isn't the last owner", async () => {
		selectPolyphony();
		loadOk();
		const EMIL = { id: 'p-emil', name: 'Emil Erg', role: 'owner' as const, valueIds: ['pv-own-emil'] };
		// Two owners (Anna, Emil) so neither is the "last owner" — isolates the
		// self-lockout guard from the pre-existing last-owner guard.
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, EMIL, SELF_EDITOR]));

		const { container } = await renderReady();

		expect(q<HTMLButtonElement>(container, 'admin-remove-admin-p')!.disabled).toBe(true);
		// Anna's and Emil's rows are untouched by the guard — different people.
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-anna')!.disabled).toBe(false);
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-emil')!.disabled).toBe(false);
	});

	it('an owner among TWO owners still gets HER OWN remove button disabled — self-lockout applies even when she is not the last owner', async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, SELF_OWNER]));

		const { container } = await renderReady();

		// Two owners → isLastOwner is false for both, but isSelf still disables
		// her own row.
		expect(q<HTMLButtonElement>(container, 'admin-remove-admin-p')!.disabled).toBe(true);
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-anna')!.disabled).toBe(false);
	});

	it('clicking a self-disabled admin remove button never calls removeAdmin', async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, SELF_EDITOR]));

		const { container } = await renderReady();
		await fireEvent.click(q<HTMLButtonElement>(container, 'admin-remove-admin-p')!);
		expect(h.removeAdminMock).not.toHaveBeenCalled();
	});

	it('a librarian sees HER OWN remove button disabled in the librarian list too — same guard, both sections', async () => {
		selectPolyphony();
		loadOk();
		h.listLibrariansMock
			.mockReset()
			.mockResolvedValue(listing([CILLA, { ...SELF_EDITOR, valueIds: ['pv-ed-lib-self'] }]));

		const { container } = await renderReady();

		expect(q<HTMLButtonElement>(container, 'librarian-remove-admin-p')!.disabled).toBe(true);
		expect(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla')!.disabled).toBe(false);
		await fireEvent.click(q<HTMLButtonElement>(container, 'librarian-remove-admin-p')!);
		expect(h.removeLibrarianMock).not.toHaveBeenCalled();
	});

	// The guard is only half the fix: a greyed-out "Remove Admin Person" with no
	// stated reason is the bug report we'd get next. A `title` on a DISABLED
	// button is not that reason — UAs suppress tooltips on disabled controls and
	// the control is out of the tab order, so assistive tech never announces it.
	// The reason has to be rendered text, like the last-owner hint next to it.
	it('renders the self-lockout reason as VISIBLE text under the admin list, not only as a title on the disabled button', async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, SELF_EDITOR]));

		const { container } = await renderReady();

		const hint = q(container, 'admin-roles-admins-self-hint');
		expect(hint, 'expected a visible self-lockout hint in the admins section').not.toBeNull();
		expect(hint!.textContent).toContain('Cannot remove your own rights.');
		// It lives inside the admins section, next to the row it explains.
		expect(
			q(section(container, 'admin-roles-admins'), 'admin-roles-admins-self-hint')
		).not.toBeNull();
	});

	it('shows no self-lockout hint when the viewer holds no grant in the list — nothing is disabled, so there is nothing to explain', async () => {
		selectPolyphony();
		loadOk(); // ANNA + BELA in admins, CILLA in librarians — no 'admin-p' row

		const { container } = await renderReady();

		expect(q(container, 'admin-roles-admins-self-hint')).toBeNull();
		expect(q(container, 'admin-roles-librarians-self-hint')).toBeNull();
	});

	it('renders the same visible reason under the librarian list', async () => {
		selectPolyphony();
		loadOk();
		h.listLibrariansMock
			.mockReset()
			.mockResolvedValue(listing([CILLA, { ...SELF_EDITOR, valueIds: ['pv-ed-lib-self'] }]));

		const { container } = await renderReady();

		const hint = q(container, 'admin-roles-librarians-self-hint');
		expect(hint, 'expected a visible self-lockout hint in the librarians section').not.toBeNull();
		expect(hint!.textContent).toContain('Cannot remove your own rights.');
	});

	it('shows no librarian self-lockout hint when the viewer is a library OWNER — her row renders no button at all (#148), so nothing is greyed out to explain', async () => {
		selectPolyphony();
		loadOk();
		h.listLibrariansMock
			.mockReset()
			.mockResolvedValue(listing([CILLA, { ...SELF_OWNER, valueIds: ['pv-own-lib-self'] }]));

		const { container } = await renderReady();

		expect(q(container, 'librarian-remove-admin-p')).toBeNull();
		expect(q(container, 'admin-roles-librarians-self-hint')).toBeNull();
	});
});

// ── the write gate: 'admin' access ≠ permission to write rights ─────────────────

describe('/admin — write gate (canManage)', () => {
	it("an org EDITOR (resolveAdmin 'admin', but no _owner value → canManage false) gets the lists READ-ONLY: no combobox, every Remove disabled, a localized explanation — the API would 403 every one of those writes", async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, BELA], false));
		h.listLibrariansMock.mockReset().mockResolvedValue(listing([CILLA], false));

		const { container } = await renderReady();

		// The lists themselves stay visible — reading is not what the API refuses.
		expect(q(container, 'admin-entry-p-anna')).not.toBeNull();
		expect(q(container, 'admin-entry-p-bela')).not.toBeNull();
		expect(q(container, 'librarian-entry-p-cilla')).not.toBeNull();

		// Zero enabled write controls anywhere on the page.
		const admins = section(container, 'admin-roles-admins');
		const librarians = section(container, 'admin-roles-librarians');
		expect(q(admins, 'autocomplete-input')).toBeNull();
		expect(q(librarians, 'autocomplete-input')).toBeNull();
		const removeButtons = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button[data-testid*="-remove-"]')
		);
		expect(removeButtons.length).toBeGreaterThan(0);
		for (const b of removeButtons) expect(b.disabled).toBe(true);

		expect(q(container, 'admin-roles-admins-read-only')).not.toBeNull();
		expect(q(container, 'admin-roles-librarians-read-only')).not.toBeNull();
	});

	it('a non-owner viewer cannot reach the write functions even by activating a disabled Remove', async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, BELA], false));
		h.listLibrariansMock.mockReset().mockResolvedValue(listing([CILLA], false));

		const { container } = await renderReady();
		await fireEvent.click(q<HTMLButtonElement>(container, 'admin-remove-p-bela')!);
		await fireEvent.click(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla')!);

		expect(h.removeAdminMock).not.toHaveBeenCalled();
		expect(h.removeLibrarianMock).not.toHaveBeenCalled();
	});

	it('canManage true keeps the write controls: both comboboxes render (the gate is not "always off")', async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();
		expect(q(section(container, 'admin-roles-admins'), 'autocomplete-input')).not.toBeNull();
		expect(q(section(container, 'admin-roles-librarians'), 'autocomplete-input')).not.toBeNull();
		expect(q(container, 'admin-roles-admins-read-only')).toBeNull();
		expect(q(container, 'admin-roles-librarians-read-only')).toBeNull();
	});
});

// ── library owners: listed, but not revocable from here ─────────────────────────

describe('/admin — a library OWNER row', () => {
	// #148 — a disabled Remove button plus an explanatory note was confusing;
	// the fix drops the control entirely for an owner row. The role badge
	// (rendered via roleLabel, asserted separately) already says why.
	it("renders NO Remove button at all — removeLibrarian is 'editor-only' scope and would reject before any write (a dead click); the role badge alone explains the row", async () => {
		selectPolyphony();
		loadOk();
		const LIB_OWNER = {
			id: 'p-anna',
			name: 'Anna Arro',
			role: 'owner' as const,
			valueIds: ['pv-own-anna-lib']
		};
		h.listLibrariansMock.mockReset().mockResolvedValue(listing([LIB_OWNER, CILLA]));

		const { container } = await renderReady();

		expect(q(container, 'librarian-entry-p-anna')).not.toBeNull();
		expect(q(container, 'librarian-remove-p-anna')).toBeNull();
		expect(h.removeLibrarianMock).not.toHaveBeenCalled();
		expect(q(container, 'admin-roles-action-error')).toBeNull();

		// A librarian (editor) in the same list is still revocable.
		expect(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla')!.disabled).toBe(false);
	});
});

// ── collective switch mid-load ──────────────────────────────────────────────────

describe('/admin — a collective switch that lands mid-load', () => {
	it('a slow EARLIER load never clobbers the newer collective: rows, the org acted on, and canManage all come from the collective now selected', async () => {
		setToken('jwt-admin');
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'alpha', name: 'Alpha', personId: 'p-alpha' },
				{ db: 'beta', name: 'Beta', personId: 'p-beta' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('alpha');

		// Alpha clears its access gate immediately, then STALLS on the parallel
		// resolutions — precisely the window a switch lands in. Selecting a
		// collective is an in-place store update (`selectCollective` goto's the
		// SAME pathname and the root layout has no `{#key}`), so this component
		// is never remounted and alpha's continuation runs against beta's state.
		let releaseAlpha!: () => void;
		const alphaGate = new Promise<void>((resolve) => {
			releaseAlpha = resolve;
		});

		h.resolveAdminMock.mockResolvedValue('admin');
		h.resolveDatabaseEntityIdMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'alpha' ? alphaGate.then(() => 'org-alpha') : Promise.resolve('org-beta')
		);
		h.resolveLibrarianMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve({
				state: 'librarian',
				libraryId: cfg.db === 'alpha' ? 'lib-alpha' : 'lib-beta'
			})
		);
		h.loadRosterMock.mockResolvedValue(ROSTER);
		h.listAdminsMock.mockImplementation((_cfg: unknown, orgId: string) =>
			Promise.resolve(
				orgId === 'org-alpha'
					? listing([ANNA, BELA], true)
					: listing([{ id: 'p-emil', name: 'Emil Erg', role: 'editor' as const, valueIds: ['pv-e'] }], false)
			)
		);
		h.listLibrariansMock.mockImplementation(() => Promise.resolve(listing([], false)));

		const { container } = render(Page);
		// Alpha is genuinely in flight and parked at the gate before we switch.
		await waitFor(() => {
			expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'alpha' })
			);
		});

		selectedCollectiveDbStore.set('beta');
		await waitFor(() => {
			expect(q(container, 'admin-entry-p-emil')).not.toBeNull();
		});

		// Now the superseded load resolves. Flush every microtask AND the Svelte
		// render queue, so a missing guard would visibly repaint alpha's data.
		releaseAlpha();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await tick();

		expect(q(container, 'admin-entry-p-emil')).not.toBeNull();
		expect(q(container, 'admin-entry-p-anna')).toBeNull();
		expect(q(container, 'admin-entry-p-bela')).toBeNull();
		// beta's canManage:false must survive too — alpha's true would hand a
		// non-owner write controls that entu-api 403s.
		expect(q(container, 'admin-roles-admins-read-only')).not.toBeNull();
		expect(q(section(container, 'admin-roles-admins'), 'autocomplete-input')).toBeNull();
		// The stale load never got to read alpha's org through beta's cfg.
		// Asserted on the RECORDED org-id argument rather than a matcher tuple:
		// `not.toHaveBeenCalledWith(...)` passes vacuously the moment the arity
		// drifts (and `expect.anything()` never matches the literal `undefined`
		// this call site passes for `fetchImpl`), so it would read as coverage
		// while checking nothing.
		expect(h.listAdminsMock.mock.calls.map((c: unknown[]) => c[1])).not.toContain('org-alpha');
	});
});

// ── navigation integration ──────────────────────────────────────────────────────

describe('/admin — navigation entry', () => {
	it('NAV_ENTRIES carries an admin-only /admin entry (visible ⇔ ctx.isAdmin, same gate as /admin/invite)', () => {
		const entry = NAV_ENTRIES.find((e) => e.route === '/admin');
		expect(entry, 'expected a NAV_ENTRIES entry routing to /admin').toBeDefined();
		expect(entry!.visible({ isAdmin: true, hasMultipleCollectives: false })).toBe(true);
		expect(entry!.visible({ isAdmin: false, hasMultipleCollectives: false })).toBe(false);
		expect(entry!.visible({ isAdmin: false, hasMultipleCollectives: true })).toBe(false);
	});
});

// (*MVOX:Tallis* — #134/S3 RED)
