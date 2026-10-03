// @vitest-environment happy-dom
// The /admin role-management page.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
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
		picker_partial_members_notice: () => 'Not every member is listed here',
		admin_roles_remove: (p: { name: string }) => `Remove ${p.name}`,
		admin_roles_last_owner_hint: () => 'The last owner cannot be removed.',
		admin_roles_no_library: () => 'No library entity is visible in this collective.',
		admin_roles_action_error: () => 'Role change failed.',
		admin_roles_saving: () => 'Saving…',
		admin_roles_saved: () => 'Saved.',
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
		resolveDatabaseEntityIdMock: vi.fn(),
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
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

import Page from './admin/+page.svelte';
import type { RolePerson } from '$lib/admin/roleManagement';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { NAV_ENTRIES } from '$lib/nav/entries';
import { toListRead } from '$lib/testing/listReadFixtures';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const CFG = testCfg('sampledb', 'jwt-admin');

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

function listing(persons: RolePerson[], canManage = true) {
	return { persons, canManage };
}

const ROSTER = [
	{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' },
	{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' },
	{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '' }
];

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue(listing([ANNA, BELA]));
	h.listLibrariansMock.mockResolvedValue(listing([CILLA]));
	h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	h.listSectionsMock.mockResolvedValue([]);
	h.addAdminMock.mockResolvedValue(undefined);
	h.addLibrarianMock.mockResolvedValue(undefined);
	h.removeAdminMock.mockResolvedValue(undefined);
	h.removeLibrarianMock.mockResolvedValue(undefined);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
	h.resolveOwnerTierMock.mockResolvedValue('error');
	h.listJoinStatesMock.mockResolvedValue({});
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

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

function personSelect(sectionEl: HTMLElement, testid: string): HTMLSelectElement {
	const select = q<HTMLSelectElement>(sectionEl, testid);
	expect(select, `expected the section to hold a native [data-testid="${testid}"]`).not.toBeNull();
	expect(select!.tagName).toBe('SELECT');
	return select!;
}

function optionValues(select: HTMLSelectElement): string[] {
	return Array.from(select.querySelectorAll('option')).map((o) => o.value);
}

function promptOption(select: HTMLSelectElement): HTMLOptionElement {
	const prompt = select.querySelector('option') as HTMLOptionElement;
	expect(prompt, 'expected a first (prompt) option').not.toBeNull();
	expect(prompt.value).toBe('');
	expect(prompt.disabled).toBe(true);
	expect(prompt.hidden).toBe(true);
	return prompt;
}

async function pickPerson(select: HTMLSelectElement, personId: string): Promise<void> {
	await fireEvent.change(select, { target: { value: personId } });
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
	resetAppState();
});

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
		selectSampledb();
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

		expect(h.resolveAdminMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'admin-p',
			undefined,
			'org-1'
		);
	});

	it("resolveAdmin → 'error': the load-error state with retry — a network failure is NEVER rendered as not-admin", async () => {
		selectSampledb();
		loadOk();
		h.resolveAdminMock.mockResolvedValueOnce('error');

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-load-error')).not.toBeNull();
		});
		expect(q(container, 'admin-roles-no-access')).toBeNull();

		h.resolveAdminMock.mockResolvedValue('admin');
		const retry = q<HTMLButtonElement>(container, 'admin-roles-retry-load');
		expect(retry).not.toBeNull();
		await fireEvent.click(retry!);
		await waitFor(() => {
			expect(q(container, 'admin-roles-admins')).not.toBeNull();
		});
	});
});

describe('/admin — role lists', () => {
	it('renders the admin + librarian lists off listAdmins(cfg, dbEntityId) / listLibrarians(cfg, libraryId) — org from resolveDatabaseEntityId, library from resolveLibrarian (the EXISTING resolutions, no new lookups)', async () => {
		selectSampledb();
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
			'admin-p',
			undefined,
			'org-1'
		);
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
		selectSampledb();
		loadOk();
		const ANNA_FOLDED = { ...ANNA, valueIds: ['pv-own-anna', 'pv-ed-anna'] };
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA_FOLDED, BELA]));

		const { container } = await renderReady();

		expect(container.querySelectorAll('[data-testid="admin-entry-p-anna"]')).toHaveLength(1);
		const entries = container.querySelectorAll('[data-testid^="admin-entry-"]');
		expect(entries).toHaveLength(2);
		expect(q(container, 'admin-entry-p-anna')!.textContent).toContain('omanik');
	});

	it('the role badge renders the LOCALIZED label, never the raw RolePerson.role enum — in both lists', async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();

		expect(q(container, 'admin-entry-p-anna')!.textContent).toContain('(omanik)');
		expect(q(container, 'admin-entry-p-bela')!.textContent).toContain('(toimetaja)');
		expect(q(container, 'librarian-entry-p-cilla')!.textContent).toContain('(toimetaja)');
		expect(container.textContent).not.toContain('(owner)');
		expect(container.textContent).not.toContain('(editor)');
	});

	it('resolveLibrarian answering libraryId: null → the no-library state; listLibrarians is NOT called; the admin list still renders', async () => {
		selectSampledb();
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
		selectSampledb();
		loadOk();
		h.resolveLibrarianMock.mockResolvedValueOnce({ state: 'error', libraryId: null });

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-load-error')).not.toBeNull();
		});
		expect(q(container, 'admin-roles-no-library')).toBeNull();
		expect(container.textContent).not.toContain('No library entity is visible');
		expect(h.listLibrariansMock).not.toHaveBeenCalled();

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

describe('/admin — adding people (native <select>, roster-fed, #209)', () => {
	it('the admin select is a NATIVE <select data-testid="admin-add-admin-select"> named by admin_roles_add_admin_label, prompt option first (value "", disabled selected hidden, the reworded add-prompt), then roster people MINUS current admins — value = person id, text = display name', async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();
		expect(h.loadRosterMock).toHaveBeenCalledWith(expect.objectContaining(CFG));

		const admins = section(container, 'admin-roles-admins');
		const select = personSelect(admins, 'admin-add-admin-select');

		expect(select.getAttribute('aria-label')).toBe('Add an administrator');

		const prompt = promptOption(select);
		expect(prompt.textContent?.trim()).toBe('Add administrator…');
		expect(select.value).toBe('');

		expect(optionValues(select)).toEqual(['', 'p-cilla', 'p-dora']);
		const texts = Array.from(select.querySelectorAll('option')).map((o) =>
			o.textContent?.trim()
		);
		expect(texts).toEqual(['Add administrator…', 'Cilla Cane', 'Dora Duncan']);
	});

	it('changing the admin select to a person id calls addAdmin(cfg, dbEntityId, personId), the list refetches with the new entry, and the select RESETS to the prompt', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock
			.mockReset()
			.mockResolvedValueOnce(listing([ANNA, BELA]))
			.mockResolvedValueOnce(listing([ANNA, BELA, DORA_ADMIN]));

		const { container } = await renderReady();
		const admins = section(container, 'admin-roles-admins');
		const select = personSelect(admins, 'admin-add-admin-select');

		await pickPerson(select, 'p-dora');

		await waitFor(() => {
			expect(h.addAdminMock).toHaveBeenCalledWith(
				expect.objectContaining(CFG),
				'org-1',
				'p-dora'
			);
		});
		await waitFor(() => {
			expect(h.listAdminsMock).toHaveBeenCalledTimes(2);
			expect(q(container, 'admin-entry-p-dora')).not.toBeNull();
		});
		await waitFor(() => {
			expect(personSelect(admins, 'admin-add-admin-select').value).toBe('');
		});
	});

	it('re-selecting the prompt ("") grants nothing — only a person id is a pick', async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();
		const admins = section(container, 'admin-roles-admins');
		const select = personSelect(admins, 'admin-add-admin-select');

		await fireEvent.change(select, { target: { value: '' } });

		expect(h.addAdminMock).not.toHaveBeenCalled();
		expect(h.addLibrarianMock).not.toHaveBeenCalled();
	});

	it('the librarian select (admin-add-librarian-select) excludes current librarians and a pick calls addLibrarian(cfg, libraryId, personId) and resets to the prompt', async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();
		const librarians = section(container, 'admin-roles-librarians');
		const select = personSelect(librarians, 'admin-add-librarian-select');

		expect(select.getAttribute('aria-label')).toBe('Add a librarian');
		expect(promptOption(select).textContent?.trim()).toBe('Add librarian…');

		expect(optionValues(select)).toEqual(['', 'p-anna', 'p-bela', 'p-dora']);

		await pickPerson(select, 'p-dora');

		await waitFor(() => {
			expect(h.addLibrarianMock).toHaveBeenCalledWith(
				expect.objectContaining(CFG),
				'lib-1',
				'p-dora'
			);
		});
		await waitFor(() => {
			expect(personSelect(librarians, 'admin-add-librarian-select').value).toBe('');
		});
	});

	it('option order is ROSTER order — section (listSections tree order), then position within section — NOT alphabetical (Gama ruling 3)', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([]));
		h.loadRosterMock.mockReset().mockResolvedValue(
			toListRead([
				{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '', sectionIds: ['sec-t'] },
				{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '', sectionIds: [] },
				{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '', sectionIds: ['sec-s'] },
				{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '', sectionIds: ['sec-s'] }
			])
		);
		h.listSectionsMock.mockReset().mockResolvedValue([
			{ id: 'sec-s', name: 'Sopran', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-t', name: 'Tenor', displayOrder: 2, parentId: null, depth: 0, children: [] }
		]);

		const { container } = await renderReady();
		const admins = section(container, 'admin-roles-admins');
		const select = personSelect(admins, 'admin-add-admin-select');

		expect(optionValues(select)).toEqual(['', 'p-cilla', 'p-dora', 'p-anna', 'p-bela']);
	});

	it('EVERYONE already granted: the select stays MOUNTED but disabled and its prompt text becomes picker_everyone_added — never hidden, never an inert enabled select (Gama ruling 2)', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock
			.mockReset()
			.mockResolvedValue(listing([ANNA, BELA, CILLA, DORA_ADMIN]));

		const { container } = await renderReady();
		const admins = section(container, 'admin-roles-admins');
		const select = personSelect(admins, 'admin-add-admin-select');

		expect(select.disabled).toBe(true);
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('Everyone is already added');

		const librarians = section(container, 'admin-roles-librarians');
		const libSelect = personSelect(librarians, 'admin-add-librarian-select');
		expect(libSelect.disabled).toBe(false);
		expect(promptOption(libSelect).textContent?.trim()).toBe('Add librarian…');
	});
});

describe('/admin — a failed section read costs the pickers their order, not the page', () => {
	it('listSections rejects: the page still reaches READY (lists, remove buttons, invite section intact), both selects still offer the whole roster in name order, and each says its order degraded', async () => {
		selectSampledb();
		loadOk();
		h.listSectionsMock.mockReset().mockRejectedValue(new Error('sections boom'));

		const { container } = await renderReady();

		expect(q(container, 'admin-roles-load-error')).toBeNull();
		expect(q(container, 'admin-entry-p-anna')).not.toBeNull();
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-bela')).not.toBeNull();

		const admins = section(container, 'admin-roles-admins');
		const select = personSelect(admins, 'admin-add-admin-select');
		expect(select.disabled).toBe(false);
		expect(optionValues(select)).toEqual(['', 'p-cilla', 'p-dora']);
		expect(promptOption(select).textContent?.trim()).toBe('Add administrator…');
		await waitFor(() => {
			expect(q(container, 'admin-add-admin-order-note')?.textContent).toContain(
				'section order unavailable'
			);
		});
		expect(q(container, 'admin-add-librarian-order-note')).not.toBeNull();
	});

	it('an EMPTY roster is not "everyone is already added": the prompt says there is nobody to add', async () => {
		selectSampledb();
		loadOk();
		h.loadRosterMock.mockReset().mockResolvedValue(toListRead([]));
		h.listAdminsMock.mockReset().mockResolvedValue(listing([]));

		const { container } = await renderReady();
		const admins = section(container, 'admin-roles-admins');
		const select = personSelect(admins, 'admin-add-admin-select');

		expect(select.disabled).toBe(true);
		expect(optionValues(select)).toEqual(['']);
		expect(promptOption(select).textContent?.trim()).toBe('No members to add');
	});
});

describe('/admin — #321 review F2: a truncated roster makes a member ungrantable, so the selects say so', () => {
	function truncatedRoster() {
		h.loadRosterMock.mockReset().mockResolvedValue({
			items: ROSTER,
			total: 500,
			truncated: true
		});
	}

	it('both person selects carry the shared role="status" notice when the member read was partial', async () => {
		selectSampledb();
		loadOk();
		truncatedRoster();

		const { container } = await renderReady();

		for (const testid of ['admin-add-admin-partial-notice', 'admin-add-librarian-partial-notice']) {
			await waitFor(() => {
				expect(q(container, testid)).not.toBeNull();
			});
			expect(q(container, testid)!.getAttribute('role')).toBe('status');
			expect(q(container, testid)!.className).not.toMatch(/sr-only|hidden/);
		}
		expect(
			section(container, 'admin-roles-admins').querySelector(
				'[data-testid="admin-add-admin-partial-notice"]'
			)
		).not.toBeNull();
		expect(
			section(container, 'admin-roles-librarians').querySelector(
				'[data-testid="admin-add-librarian-partial-notice"]'
			)
		).not.toBeNull();
	});

	it('a complete roster read leaves both notices ABSENT from the DOM', async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();
		expect(q(container, 'admin-entry-p-anna')).not.toBeNull();

		expect(q(container, 'admin-add-admin-partial-notice')).toBeNull();
		expect(q(container, 'admin-add-librarian-partial-notice')).toBeNull();
	});
});

describe('/admin — removing people', () => {
	it('each admin entry carries a remove button; activating it calls removeAdmin(cfg, dbEntityId, personId) and the list refetches', async () => {
		selectSampledb();
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
		selectSampledb();
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
		selectSampledb();
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
		selectSampledb();
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
		selectSampledb();
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

describe('/admin — self-lockout guard (#147)', () => {
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

	it("an admin holding only _editor gets NO remove button on HER OWN row (#164 — not rendered, not merely disabled), even though canManage is true and she isn't the last owner", async () => {
		selectSampledb();
		loadOk();
		const EMIL = { id: 'p-emil', name: 'Emil Erg', role: 'owner' as const, valueIds: ['pv-own-emil'] };
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, EMIL, SELF_EDITOR]));

		const { container } = await renderReady();

		expect(q(container, 'admin-entry-admin-p')).not.toBeNull();
		expect(q(container, 'admin-remove-admin-p')).toBeNull();
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-anna')!.disabled).toBe(false);
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-emil')!.disabled).toBe(false);
	});

	it('an owner among TWO owners still gets NO remove button on HER OWN row — self-lockout applies even when she is not the last owner (#164)', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, SELF_OWNER]));

		const { container } = await renderReady();

		expect(q(container, 'admin-entry-admin-p')).not.toBeNull();
		expect(q(container, 'admin-remove-admin-p')).toBeNull();
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-anna')!.disabled).toBe(false);
	});

	it('with the self button unrendered there is nothing to click — removeAdmin is unreachable for the own row (#164)', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, SELF_EDITOR]));

		const { container } = await renderReady();
		expect(q(container, 'admin-remove-admin-p')).toBeNull();
		expect(h.removeAdminMock).not.toHaveBeenCalled();
	});

	it('a librarian sees HER OWN remove button disabled in the librarian list too — same guard, both sections', async () => {
		selectSampledb();
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

	it('renders the self-lockout reason as VISIBLE text under the admin list even though the own row carries no button', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, SELF_EDITOR]));

		const { container } = await renderReady();

		const hint = q(container, 'admin-roles-admins-self-hint');
		expect(hint, 'expected a visible self-lockout hint in the admins section').not.toBeNull();
		expect(hint!.textContent).toContain('Cannot remove your own rights.');
		expect(
			q(section(container, 'admin-roles-admins'), 'admin-roles-admins-self-hint')
		).not.toBeNull();
	});

	it('shows no self-lockout hint when the viewer holds no grant in the list — nothing is disabled, so there is nothing to explain', async () => {
		selectSampledb();
		loadOk(); // ANNA + BELA in admins, CILLA in librarians — no 'admin-p' row

		const { container } = await renderReady();

		expect(q(container, 'admin-roles-admins-self-hint')).toBeNull();
		expect(q(container, 'admin-roles-librarians-self-hint')).toBeNull();
	});

	it('renders the same visible reason under the librarian list', async () => {
		selectSampledb();
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
		selectSampledb();
		loadOk();
		h.listLibrariansMock
			.mockReset()
			.mockResolvedValue(listing([CILLA, { ...SELF_OWNER, valueIds: ['pv-own-lib-self'] }]));

		const { container } = await renderReady();

		expect(q(container, 'librarian-remove-admin-p')).toBeNull();
		expect(q(container, 'admin-roles-librarians-self-hint')).toBeNull();
	});
});

describe('/admin — #164 self Remove button is NOT rendered on the own row', () => {
	const SELF_OWNER = {
		id: 'admin-p',
		name: 'Mihkel Putrinš',
		role: 'owner' as const,
		valueIds: ['pv-own-self']
	};
	const DB_ROOT = {
		id: 'p-dbroot',
		name: 'db-root (mvox dev admin)',
		role: 'owner' as const,
		valueIds: ['pv-own-dbroot']
	};

	it("route integration — Mihkel's exact scenario: two owners, viewer is one of them; HIS row renders name+badge but NO Remove button; the OTHER owner's button renders enabled", async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([DB_ROOT, SELF_OWNER]));

		const { container } = await renderReady();
		const admins = section(container, 'admin-roles-admins');

		const selfRow = q(admins, 'admin-entry-admin-p');
		expect(selfRow, 'expected the viewer\'s own admin row to render').not.toBeNull();
		expect(selfRow!.textContent).toContain('Mihkel Putrinš');
		expect(selfRow!.textContent).toContain('(omanik)');

		expect(q(admins, 'admin-remove-admin-p')).toBeNull();
		expect(selfRow!.querySelector('button')).toBeNull();

		const removeDbRoot = q<HTMLButtonElement>(admins, 'admin-remove-p-dbroot');
		expect(removeDbRoot, 'expected the other owner\'s Remove button').not.toBeNull();
		expect(removeDbRoot!.disabled).toBe(false);
	});

	it("route integration — other admins' Remove buttons still WORK normally next to the buttonless own row: a click calls removeAdmin and the list refetches", async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock
			.mockReset()
			.mockResolvedValueOnce(listing([DB_ROOT, SELF_OWNER, BELA]))
			.mockResolvedValueOnce(listing([DB_ROOT, SELF_OWNER]));

		const { container } = await renderReady();
		expect(q(container, 'admin-remove-admin-p')).toBeNull();

		await fireEvent.click(q<HTMLButtonElement>(container, 'admin-remove-p-bela')!);

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
		expect(q(container, 'admin-entry-admin-p')).not.toBeNull();
		expect(q(container, 'admin-remove-admin-p')).toBeNull();
	});

	it('a self row hides its button even when the viewer is the LAST owner — the own row never grows a control regardless of which guard also applies', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([SELF_OWNER, BELA]));

		const { container } = await renderReady();

		expect(q(container, 'admin-entry-admin-p')).not.toBeNull();
		expect(q(container, 'admin-remove-admin-p')).toBeNull();
		expect(q<HTMLButtonElement>(container, 'admin-remove-p-bela')!.disabled).toBe(false);
	});

	it('rows NOT matching viewerId are unaffected: with no self row in the list, every entry renders its Remove button', async () => {
		selectSampledb();
		loadOk(); // ANNA + BELA — the viewer 'admin-p' holds no listed grant

		const { container } = await renderReady();

		expect(q(container, 'admin-remove-p-anna')).not.toBeNull();
		expect(q(container, 'admin-remove-p-bela')).not.toBeNull();
	});
});

describe('/admin — write gate (canManage)', () => {
	it("an org EDITOR (resolveAdmin 'admin', but no _owner value → canManage false) gets the lists READ-ONLY: no combobox, every Remove disabled, a localized explanation — the API would 403 every one of those writes", async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, BELA], false));
		h.listLibrariansMock.mockReset().mockResolvedValue(listing([CILLA], false));

		const { container } = await renderReady();

		expect(q(container, 'admin-entry-p-anna')).not.toBeNull();
		expect(q(container, 'admin-entry-p-bela')).not.toBeNull();
		expect(q(container, 'librarian-entry-p-cilla')).not.toBeNull();

		const admins = section(container, 'admin-roles-admins');
		const librarians = section(container, 'admin-roles-librarians');
		expect(q(admins, 'admin-add-admin-select')).toBeNull();
		expect(q(librarians, 'admin-add-librarian-select')).toBeNull();
		const removeButtons = Array.from(
			container.querySelectorAll<HTMLButtonElement>('button[data-testid*="-remove-"]')
		);
		expect(removeButtons.length).toBeGreaterThan(0);
		for (const b of removeButtons) expect(b.disabled).toBe(true);

		expect(q(container, 'admin-roles-admins-read-only')).not.toBeNull();
		expect(q(container, 'admin-roles-librarians-read-only')).not.toBeNull();
	});

	it('a non-owner viewer cannot reach the write functions even by activating a disabled Remove', async () => {
		selectSampledb();
		loadOk();
		h.listAdminsMock.mockReset().mockResolvedValue(listing([ANNA, BELA], false));
		h.listLibrariansMock.mockReset().mockResolvedValue(listing([CILLA], false));

		const { container } = await renderReady();
		await fireEvent.click(q<HTMLButtonElement>(container, 'admin-remove-p-bela')!);
		await fireEvent.click(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla')!);

		expect(h.removeAdminMock).not.toHaveBeenCalled();
		expect(h.removeLibrarianMock).not.toHaveBeenCalled();
	});

	it('canManage true keeps the write controls: both person selects render (the gate is not "always off")', async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();
		expect(q(section(container, 'admin-roles-admins'), 'admin-add-admin-select')).not.toBeNull();
		expect(
			q(section(container, 'admin-roles-librarians'), 'admin-add-librarian-select')
		).not.toBeNull();
		expect(q(container, 'admin-roles-admins-read-only')).toBeNull();
		expect(q(container, 'admin-roles-librarians-read-only')).toBeNull();
	});
});

describe('/admin — a library OWNER row', () => {
	it("renders NO Remove button at all — removeLibrarian is 'editor-only' scope and would reject before any write (a dead click); the role badge alone explains the row", async () => {
		selectSampledb();
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

		expect(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla')!.disabled).toBe(false);
	});
});

describe('/admin — a collective switch that lands mid-load', () => {
	it('a slow EARLIER load never clobbers the newer collective: rows, the org acted on, and canManage all come from the collective now selected', async () => {
		signIn({ token: 'jwt-admin', collectives: [{ db: 'alpha', name: 'Alpha', personId: 'p-alpha' }, { db: 'beta', name: 'Beta', personId: 'p-beta' }] });

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
		h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
		h.listSectionsMock.mockResolvedValue([]);
		h.listAdminsMock.mockImplementation((_cfg: unknown, dbEntityId: string) =>
			Promise.resolve(
				dbEntityId === 'org-alpha'
					? listing([ANNA, BELA], true)
					: listing([{ id: 'p-emil', name: 'Emil Erg', role: 'editor' as const, valueIds: ['pv-e'] }], false)
			)
		);
		h.listLibrariansMock.mockImplementation(() => Promise.resolve(listing([], false)));

		const { container } = render(Page);
		await waitFor(() => {
			expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'alpha' })
			);
		});

		selectedCollectiveDbStore.set('beta');
		await waitFor(() => {
			expect(q(container, 'admin-entry-p-emil')).not.toBeNull();
		});

		releaseAlpha();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await tick();

		expect(q(container, 'admin-entry-p-emil')).not.toBeNull();
		expect(q(container, 'admin-entry-p-anna')).toBeNull();
		expect(q(container, 'admin-entry-p-bela')).toBeNull();
		expect(q(container, 'admin-roles-admins-read-only')).not.toBeNull();
		expect(q(section(container, 'admin-roles-admins'), 'admin-add-admin-select')).toBeNull();
		expect(h.listAdminsMock.mock.calls.map((c: unknown[]) => c[1])).not.toContain('org-alpha');
	});
});

describe('/admin — navigation entry', () => {
	it('NAV_ENTRIES carries an admin-only /admin entry (visible ⇔ ctx.isAdmin, same gate as /admin/invite)', () => {
		const entry = NAV_ENTRIES.find((e) => e.route === '/admin');
		expect(entry, 'expected a NAV_ENTRIES entry routing to /admin').toBeDefined();
		expect(entry!.visible({ isAdmin: true, hasMultipleCollectives: false })).toBe(true);
		expect(entry!.visible({ isAdmin: false, hasMultipleCollectives: false })).toBe(false);
		expect(entry!.visible({ isAdmin: false, hasMultipleCollectives: true })).toBe(false);
	});
});

// (*MVOX:Tallis*)
