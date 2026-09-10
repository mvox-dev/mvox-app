// @vitest-environment happy-dom
//
// #301 RED — the admin invite section gains an OPTIONAL person select: an
// owner-admin can point the existing invite button at an EXISTING uninvited
// person instead of minting a brand-new identity. Contract (issue #301 +
// Palestrina's probe comment, 2026-09-09):
//
// - "Inviting" is TWO different platform operations depending on whether the
//   person already exists, and the split must never blur:
//     - default option ("a new person") + submit → `createInvite`, exactly as
//       today. Works for EVERY admin (probe: blank createInvite succeeds for a
//       db-entity `_editor` — entity create auto-grants the creator).
//     - a person chosen + submit → `mintSelfLinkInvite(cfg, personId)` for that
//       person. `createInvite` is NOT called on that path — it would mint a
//       duplicate identity (#294's central avoidance).
// - The select renders ONLY for an owner-tier admin (mint onto another person
//   is owner-gated per #294's live 403) AND only when uninvited persons exist.
//   "(if any)" is a requirement: no uninvited persons → the select is NOT
//   rendered at all — not disabled, not empty (the lying-affordance class
//   #273/#286/#294 removed).
// - Owner tier comes from `resolveOwnerTier` (adminStore), fed the page's
//   already-resolved dbEntityId — NOT from `canManageAdmins`, which collapses
//   loading/error/not-owner into one false (rendering off a not-yet-resolved
//   false is the dishonest-affordance class this board keeps removing). An
//   'error' tier answer renders NO select either.
// - "Uninvited" = `listJoinStates` answers 'absent' — derived from `entu_user`
//   entry CONTENTS, never presence. Withdrawn people are 'absent' (Mihkel,
//   #294: "withdrawn and never invited are the same") and DO appear; invited
//   and joined people do not. `listJoinStates` fails loud; the section then
//   shows a visible note (never a silently-missing select) and the blank
//   invite path stays fully available.
// - The submit button's visible label — its accessible name; it is a plain
//   button with no aria-label — states WHICH behaviour fires, and flips when
//   the selection changes. One button silently doing one of two materially
//   different things is not acceptable on a control that creates identities.
// - Person-path errors: `mintSelfLinkInvite` throws `SelfLinkMintError`, a
//   DIFFERENT type from `InviteCreateError` — today's catch would swallow its
//   detail into the generic branch. A mint failure surfaces with its OWN
//   message (naming the person), and the 403/'missing-self-editor' case
//   surfaces the owner-rights meaning — never the raw platform text.
// - After a successful person-targeted mint that person is no longer
//   uninvited: the list is re-derived and the select returns to its default.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
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
		// ── #301 — the new keys this suite pins ─────────────────────────────────
		// The select's visible label.
		admin_invite_person_label: () => 'Who are you inviting?',
		// The default option — a REAL choice (today's behaviour), never a
		// `Vali…` prompt (issue #301, recorded per the #288 rule).
		admin_invite_person_new: () => 'A new person',
		// The submit label on the person path — names the person, so the button
		// says WHICH of the two behaviours will fire.
		admin_invite_submit_person: (p: { name: string }) => `Invite ${p.name}`,
		// FAIL LOUD: the uninvited-list read failed — say so, never a silently
		// missing select (blank invite does not depend on the list and stays).
		admin_invite_person_list_error: () => 'Could not load the list of uninvited people.',
		// Person-path (mint) failure — its OWN message, naming the person; never
		// swallowed into the generic createInvite branch.
		admin_invite_mint_error: (p: { name: string }) => `Could not invite ${p.name}.`,
		// The mint 403 case (`reason: 'missing-self-editor'`) — surfaced as the
		// owner-rights meaning, never the raw "lacks self-_editor" platform text.
		admin_invite_mint_owner_only: () => 'Inviting an existing person requires owner rights.',
		// #294's existing one-line explanation, reused for the non-owner admin.
		roster_member_invite_owner_only: () => 'Managing invites requires owner rights.'
	}
}));

// Mock every data seam at its module boundary. Error classes are defined
// INSIDE the hoisted block so the page's `instanceof` checks match the
// instances these tests reject with — same pattern as page.admin.spec.ts.
const h = vi.hoisted(() => {
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
	// #301 — mintSelfLinkInvite's own error type (inviteData.ts): a DIFFERENT
	// class from InviteCreateError. Mirrored with the real shape (phase, reason).
	class SelfLinkMintError extends Error {
		readonly phase: 'identity-read' | 'stale-invite-cleanup' | 'mint';
		readonly reason: 'http' | 'contract' | 'missing-self-editor';
		constructor(
			message: string,
			opts: {
				phase: 'identity-read' | 'stale-invite-cleanup' | 'mint';
				reason: 'http' | 'contract' | 'missing-self-editor';
			}
		) {
			super(message);
			this.name = 'SelfLinkMintError';
			this.phase = opts.phase;
			this.reason = opts.reason;
		}
	}
	return {
		InviteCreateError,
		SelfLinkMintError,
		listAdminsMock: vi.fn(),
		addAdminMock: vi.fn(),
		removeAdminMock: vi.fn(),
		listLibrariansMock: vi.fn(),
		addLibrarianMock: vi.fn(),
		removeLibrarianMock: vi.fn(),
		resolveAdminMock: vi.fn(),
		resolveOwnerTierMock: vi.fn(),
		resolveLibrarianMock: vi.fn(),
		resolveDatabaseEntityIdMock: vi.fn(),
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		resolveParentMock: vi.fn(),
		resolveInviteParentMock: vi.fn(),
		createInviteMock: vi.fn(),
		mintSelfLinkInviteMock: vi.fn(),
		listJoinStatesMock: vi.fn(),
		listLinkedIdentitiesMock: vi.fn(),
		resolveCollectiveNameMarkerMock: vi.fn(),
		updateCollectiveNameMock: vi.fn()
	};
});
vi.mock('$lib/admin/roleManagement', () => ({
	fetchRights: vi.fn(),
	listAdmins: h.listAdminsMock,
	addAdmin: h.addAdminMock,
	removeAdmin: h.removeAdminMock,
	listLibrarians: h.listLibrariansMock,
	addLibrarian: h.addLibrarianMock,
	removeLibrarian: h.removeLibrarianMock
}));
// #301 — `resolveOwnerTier` is the owner-tier source for the select gate (the
// same module resolveAdmin lives in). Mocking it here PINS the seam: the gate
// must be this per-tier answer, never the page's canManageAdmins boolean
// (which cannot distinguish "not yet known" from "confirmed not owner").
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: h.resolveAdminMock,
	resolveOwnerTier: h.resolveOwnerTierMock
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
// #301 — the invite data seam grows the person-targeted producer: BOTH
// functions and BOTH error classes now cross this boundary.
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	SelfLinkMintError: h.SelfLinkMintError,
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock,
	mintSelfLinkInvite: h.mintSelfLinkInviteMock
}));
// #301 — the uninvited list derives from `listJoinStates` (contents-derived
// three-state read, #294), never a presence check and never a new query.
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: h.listLinkedIdentitiesMock,
	listJoinStates: h.listJoinStatesMock
}));
// Sever the $env chain the collectives store pulls in and the store's `goto`.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './admin/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}
const MINTED_TOKEN = jwt({ db: 'polyphony', entityId: 'p-cilla', iat: 1, exp: 4_102_444_800 });

// The roster the /admin page already loads — the select's name source.
const ROSTER = [
	{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' },
	{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' },
	{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '' }
];

// Contents-derived join states (#294): Anna has joined (entry carries uid),
// Bela is invited-awaiting-redemption (masked invite entry), Cilla and Dora
// are ABSENT — no entry at all. Cilla is a WITHDRAWN person (her invite was
// revoked, leaving no marker): 'absent' is exactly what the read answers for
// her, so her presence in the select below is the withdrawn-people pin.
const JOIN_STATES = {
	'p-anna': 'joined',
	'p-bela': 'invited',
	'p-cilla': 'absent',
	'p-dora': 'absent'
} as const;

const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] };

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
	h.resolveOwnerTierMock.mockResolvedValue('owner');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(ROSTER);
	h.listSectionsMock.mockResolvedValue([]);
	h.listJoinStatesMock.mockResolvedValue({ ...JOIN_STATES });
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

/** The invite section, its submit settled ready + enabled. */
async function renderInviteReady(): Promise<{ container: HTMLElement; section: HTMLElement }> {
	const { container } = render(Page);
	await waitFor(() => {
		const submit = q<HTMLButtonElement>(container, 'invite-admin-submit');
		expect(submit).not.toBeNull();
		expect(submit!.disabled).toBe(false);
	});
	const section = q<HTMLElement>(container, 'admin-invite-section')!;
	expect(section).not.toBeNull();
	return { container, section };
}

function personSelect(section: HTMLElement): HTMLSelectElement {
	const select = q<HTMLSelectElement>(section, 'invite-person-select');
	expect(select, 'expected [data-testid="invite-person-select"]').not.toBeNull();
	expect(select!.tagName).toBe('SELECT'); // native control (house rule)
	return select!;
}

function options(select: HTMLSelectElement): HTMLOptionElement[] {
	return Array.from(select.querySelectorAll('option'));
}

async function pick(select: HTMLSelectElement, value: string): Promise<void> {
	await fireEvent.change(select, { target: { value } });
}

function submitButton(section: HTMLElement): HTMLButtonElement {
	return q<HTMLButtonElement>(section, 'invite-admin-submit')!;
}

beforeEach(() => {
	for (const mock of Object.values(h)) {
		if (typeof mock === 'function' && 'mockReset' in mock) {
			(mock as ReturnType<typeof vi.fn>).mockReset();
		}
	}
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

// ── rendering: owner + uninvited persons present ────────────────────────────

describe('#301 /admin invite — the person select (owner, uninvited persons present)', () => {
	it('renders a labelled native select defaulting to "a new person", listing ONLY absent-state persons (withdrawn in, invited/joined out), placed between the collective line and the submit button', async () => {
		selectPolyphony();
		loadOk();
		const { section } = await renderInviteReady();

		const select = await waitFor(() => personSelect(section));

		// Visible label, associated the way the section's other controls are.
		const label = select.closest('label');
		expect(label, 'the select must sit inside its <label>').not.toBeNull();
		expect(label!.textContent).toContain('Who are you inviting?');

		// Options, in order: the always-present default, then the uninvited
		// persons labelled with their roster display names. Anna (joined) and
		// Bela (invited-awaiting-redemption) are NOT offered; Cilla (withdrawn →
		// absent) and Dora (never invited → absent) are.
		const opts = options(select);
		expect(opts.map((o) => o.value)).toEqual(['', 'p-cilla', 'p-dora']);
		expect(opts[0].textContent?.trim()).toBe('A new person');
		expect(opts[1].textContent?.trim()).toBe('Cilla Cane');
		expect(opts[2].textContent?.trim()).toBe('Dora Duncan');

		// The default is a REAL choice (today's behaviour), pre-selected — never
		// a disabled/hidden `Vali…` prompt (issue #301, per the #288 rule).
		expect(select.value).toBe('');
		expect(opts[0].disabled).toBe(false);
		expect(opts[0].hidden).toBe(false);

		// Placement: between the fixed collective line and the submit button.
		const ordered = Array.from(section.querySelectorAll('[data-testid]')).map((el) =>
			el.getAttribute('data-testid')
		);
		expect(ordered.indexOf('invite-db-fixed')).toBeLessThan(ordered.indexOf('invite-person-select'));
		expect(ordered.indexOf('invite-person-select')).toBeLessThan(
			ordered.indexOf('invite-admin-submit')
		);

		// The uninvited list came from the contents-derived three-state read,
		// asked about every roster person, on the selected collective's cfg.
		const [jsCfg, jsIds] = h.listJoinStatesMock.mock.calls[0] as [
			{ db: string; token: string },
			string[]
		];
		expect(jsCfg).toMatchObject({ db: 'polyphony', token: 'jwt-admin' });
		expect([...jsIds].sort()).toEqual(['p-anna', 'p-bela', 'p-cilla', 'p-dora']);

		// The owner gate ran through resolveOwnerTier — viewer's personId, and
		// the page's ALREADY-resolved dbEntityId threaded as the 4th param (no
		// redundant re-resolve).
		expect(h.resolveOwnerTierMock).toHaveBeenCalled();
		const tierCall = h.resolveOwnerTierMock.mock.calls[0];
		expect(tierCall[0]).toMatchObject({ db: 'polyphony', token: 'jwt-admin' });
		expect(tierCall[1]).toBe('admin-p');
		expect(tierCall[3]).toBe('org-1');
	});
});

// ── the two submit paths — the split that must never blur ───────────────────

describe('#301 /admin invite — two behaviours, one button', () => {
	it('default ("a new person") + submit → createInvite exactly as today; mintSelfLinkInvite is NOT called', async () => {
		selectPolyphony();
		loadOk();
		h.createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();
		await waitFor(() => personSelect(section)); // the select exists…
		// …and the default stays selected: submit.
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(h.createInviteMock).toHaveBeenCalledTimes(1);
		const [cfgArg, inputArg] = h.createInviteMock.mock.calls[0] as [
			{ db: string; token: string },
			{ dbEntityId: string }
		];
		expect(cfgArg).toMatchObject({ db: 'polyphony', token: 'jwt-admin' });
		expect(inputArg).toEqual({ dbEntityId: 'org-1' });
		// The wrong function was NOT called: no person-targeted mint fired.
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it('a person chosen + submit → mintSelfLinkInvite(cfg, personId); createInvite is NOT called; the done panel (link, copy, bearer warning) is unchanged', async () => {
		selectPolyphony();
		loadOk();
		h.mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: MINTED_TOKEN });
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(h.mintSelfLinkInviteMock).toHaveBeenCalledTimes(1);
		const mintCall = h.mintSelfLinkInviteMock.mock.calls[0];
		expect(mintCall[0]).toMatchObject({ db: 'polyphony', token: 'jwt-admin' });
		expect(mintCall[1]).toBe('p-cilla');
		// The wrong function was NOT called: a createInvite here would mint a
		// DUPLICATE person + member for someone who already exists.
		expect(h.createInviteMock).not.toHaveBeenCalled();

		// The done surface is the SAME on both paths: show-once link, copy
		// control, always-visible bearer warning.
		const link = q<HTMLInputElement>(container, 'invite-link')!;
		expect(link.value).toBe(`${window.location.origin}/invite/${MINTED_TOKEN}`);
		expect(q(container, 'invite-copy')).not.toBeNull();
		expect(q(container, 'invite-bearer-warning')?.textContent).toContain('Bearer secret');
	});

	it("the submit button's visible label (= accessible name: plain button, no aria-label) states which behaviour fires, and flips with the selection", async () => {
		selectPolyphony();
		loadOk();
		const { section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));
		const submit = submitButton(section);

		// Plain button: the visible text IS the accessible name — no aria-label
		// may be layered on to make them diverge.
		expect(submit.getAttribute('aria-label')).toBeNull();
		expect(submit.textContent?.trim()).toBe('Create invite');

		await pick(select, 'p-cilla');
		await waitFor(() => {
			expect(submit.textContent?.trim()).toBe('Invite Cilla Cane');
		});

		// Back to the default → back to today's label.
		await pick(select, '');
		await waitFor(() => {
			expect(submit.textContent?.trim()).toBe('Create invite');
		});
	});
});

// ── when the select must NOT render ─────────────────────────────────────────

describe('#301 /admin invite — when the select is not rendered', () => {
	it('no uninvited persons → NO select at all (not disabled, not empty — absent), and the section works as today', async () => {
		selectPolyphony();
		loadOk();
		// Everyone is invited or joined — nobody is 'absent'.
		h.listJoinStatesMock.mockResolvedValue({
			'p-anna': 'joined',
			'p-bela': 'invited',
			'p-cilla': 'joined',
			'p-dora': 'invited'
		});
		h.createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();
		// Let the join-state read settle before asserting absence.
		await waitFor(() => {
			expect(h.listJoinStatesMock).toHaveBeenCalled();
		});
		expect(q(section, 'invite-person-select')).toBeNull();
		// Controlled mode renders no db picker either — so NO select of ANY kind
		// exists in the section: a control that can only be refused is the
		// lying-affordance class this app keeps removing.
		expect(section.querySelector('select')).toBeNull();

		// Blank invite unchanged.
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(h.createInviteMock).toHaveBeenCalledTimes(1);
	});

	it('non-owner admin (editor tier) → no select, the existing owner-rights explanation, and the blank invite still works unchanged', async () => {
		selectPolyphony();
		loadOk();
		h.resolveOwnerTierMock.mockResolvedValue('editor');
		h.createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();

		// #294's one-line explanation, rendered in THIS section.
		await waitFor(() => {
			expect(q(section, 'invite-owner-note')).not.toBeNull();
		});
		expect(q(section, 'invite-owner-note')!.textContent).toContain(
			'Managing invites requires owner rights.'
		);
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();

		// The blank path is NOT owner-gated (2026-09-09 probe: an _editor's
		// createInvite fully succeeds) — the button keeps working.
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(h.createInviteMock).toHaveBeenCalledTimes(1);
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it("owner tier 'error' → no select (an affordance is never rendered off an unresolved rights answer)", async () => {
		selectPolyphony();
		loadOk();
		h.resolveOwnerTierMock.mockResolvedValue('error');
		const { section } = await renderInviteReady();
		await waitFor(() => {
			expect(h.resolveOwnerTierMock).toHaveBeenCalled();
		});
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();
	});

	it('listJoinStates fails loud → a visible note (no silently-missing select), and the blank invite path stays fully available', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		loadOk();
		h.listJoinStatesMock.mockRejectedValue(
			new Error('listLinkedIdentities: identity read failed: HTTP 500')
		);
		h.createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-person-list-error')).not.toBeNull();
		});
		expect(q(section, 'invite-person-list-error')!.textContent).toContain(
			'Could not load the list of uninvited people.'
		);
		// Generic localized note — the raw error message stays out of the DOM.
		expect(container.textContent).not.toContain('HTTP 500');
		expect(q(section, 'invite-person-select')).toBeNull();

		// Blank invite does not depend on the list: still available, still works.
		const submit = submitButton(section);
		expect(submit.disabled).toBe(false);
		await fireEvent.click(submit);
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(h.createInviteMock).toHaveBeenCalledTimes(1);

		consoleSpy.mockRestore();
	});
});

// ── person-path errors — SelfLinkMintError is NOT InviteCreateError ─────────

describe('#301 /admin invite — person-path (mint) failures surface their own detail', () => {
	it('a SelfLinkMintError surfaces its OWN message naming the person — never the generic createInvite branch, never the orphaned-person warning; the selection survives for retry', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		loadOk();
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint failed: HTTP 500', {
				phase: 'mint',
				reason: 'http'
			})
		);
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});
		const mintError = q<HTMLElement>(container, 'invite-mint-error')!;
		expect(mintError.textContent).toContain('Could not invite Cilla Cane.');
		// NOT the generic createInvite error branch: neither its message nor its
		// createInvite-specific partial-failure (orphaned person) warning — that
		// branch describes a person entity that got CREATED, which is exactly
		// what the person path never does.
		expect(container.textContent).not.toContain('Invite creation failed.');
		expect(q(container, 'invite-partial-failure')).toBeNull();
		// Raw detail stays out of the DOM, logged to console instead.
		expect(container.textContent).not.toContain('self-link mint failed: HTTP 500');
		const loggedDetail = consoleSpy.mock.calls
			.flat()
			.some((arg) => arg instanceof Error && arg.message === 'self-link mint failed: HTTP 500');
		expect(loggedDetail).toBe(true);

		// The form is preserved for retry: still the same person, button still
		// naming her.
		const selectAfter = personSelect(section);
		expect(selectAfter.value).toBe('p-cilla');
		expect(submitButton(section).textContent?.trim()).toBe('Invite Cilla Cane');

		consoleSpy.mockRestore();
	});

	it("the mint 403 ('missing-self-editor') surfaces the owner-rights meaning, not the raw platform text", async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		loadOk();
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint refused: HTTP 403 — the person lacks self-_editor', {
				phase: 'mint',
				reason: 'missing-self-editor'
			})
		);
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});
		expect(q(container, 'invite-mint-error')!.textContent).toContain(
			'Inviting an existing person requires owner rights.'
		);
		// The raw phase/reason text never reaches the admin.
		expect(container.textContent).not.toContain('self-_editor');
		expect(container.textContent).not.toContain('HTTP 403');

		consoleSpy.mockRestore();
	});
});

// ── after a successful person-targeted mint ─────────────────────────────────

describe('#301 /admin invite — after a successful person mint', () => {
	it('the uninvited list is RE-DERIVED: the person is gone from the options and the select is back to its default', async () => {
		selectPolyphony();
		loadOk();
		// First derivation: Cilla + Dora uninvited. Every derivation after the
		// mint sees Cilla as invited — the re-derived truth, not a local splice.
		h.listJoinStatesMock
			.mockResolvedValueOnce({ ...JOIN_STATES })
			.mockResolvedValue({ ...JOIN_STATES, 'p-cilla': 'invited' });
		h.mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: MINTED_TOKEN });

		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));
		expect(options(select).map((o) => o.value)).toEqual(['', 'p-cilla', 'p-dora']);

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});

		// Back to the form.
		const createAnother = Array.from(container.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Create another invite'
		);
		expect(createAnother).not.toBeUndefined();
		await fireEvent.click(createAnother!);

		// The list was re-derived (a fresh listJoinStates read), Cilla is no
		// longer offered, and the selection is back to "a new person".
		await waitFor(() => {
			const fresh = personSelect(section);
			expect(options(fresh).map((o) => o.value)).toEqual(['', 'p-dora']);
		});
		expect(h.listJoinStatesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		const fresh = personSelect(section);
		expect(fresh.value).toBe('');
		expect(submitButton(section).textContent?.trim()).toBe('Create invite');
	});
});

// ── review F1: an error note never outlives the action it describes ─────────
//
// The two paths own two DIFFERENT error surfaces (invite-admin-error for
// createInvite, invite-mint-error for the mint). Each branch used to clear only
// its own, so a message about one action could sit under a button now offering
// the other — the same message/action mismatch the label flip exists to
// prevent, just displaced from the button to the error area.

describe('#301 /admin invite — the two error surfaces never cross paths', () => {
	it('a failed person mint clears when the selection returns to "a new person" — no per-person note under a "Create invite" button', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		loadOk();
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint failed: HTTP 500', { phase: 'mint', reason: 'http' })
		);
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});

		// Back to the blank path: the button now offers a DIFFERENT action, so
		// the note describing the person path goes with the selection.
		await pick(personSelect(section), '');
		await waitFor(() => {
			expect(submitButton(section).textContent?.trim()).toBe('Create invite');
		});
		expect(q(container, 'invite-mint-error')).toBeNull();
		expect(container.textContent).not.toContain('Could not invite Cilla Cane.');

		consoleSpy.mockRestore();
	});

	it('a failed blank invite never stacks with a later mint failure — one surface at a time', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		loadOk();
		h.createInviteMock.mockRejectedValue(
			new h.InviteCreateError('invite create failed: HTTP 500', {
				phase: 'person',
				reason: 'http'
			})
		);
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint failed: HTTP 500', { phase: 'mint', reason: 'http' })
		);
		const { container, section } = await renderInviteReady();
		await waitFor(() => personSelect(section));

		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-error')).not.toBeNull();
		});

		// Switching to the person path drops the blank-path note…
		await pick(personSelect(section), 'p-cilla');
		await waitFor(() => {
			expect(q(container, 'invite-admin-error')).toBeNull();
		});

		// …and the mint failure then renders ONLY its own surface.
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});
		expect(q(container, 'invite-admin-error')).toBeNull();
		expect(container.textContent).not.toContain('Invite creation failed.');

		consoleSpy.mockRestore();
	});
});

// ── review F2: the uninvited-list fan-out is owner-only ─────────────────────

describe('#301 /admin invite — the uninvited-list read is owner-gated', () => {
	it('an editor-tier admin triggers NO listJoinStates fan-out, and still gets the owner-rights explanation', async () => {
		selectPolyphony();
		loadOk();
		h.resolveOwnerTierMock.mockResolvedValue('editor');
		const { section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-owner-note')).not.toBeNull();
		});
		expect(h.resolveOwnerTierMock).toHaveBeenCalled();
		// One `entity/{personId}?props=entu_user` GET per roster person, for a
		// list this admin can never be shown — never issued at all.
		expect(h.listJoinStatesMock).not.toHaveBeenCalled();
		expect(q(section, 'invite-person-list-error')).toBeNull();
		expect(q(section, 'invite-person-select')).toBeNull();
	});
});

// (*MVOX:Tallis* — #301 RED: owner-only person select routing the existing
//  button to mintSelfLinkInvite; the createInvite/mint split pinned both ways)
// (*MVOX:Palestrina* — #301 review F1/F2: cross-path error clearing + the
//  owner-gated uninvited-list read)
