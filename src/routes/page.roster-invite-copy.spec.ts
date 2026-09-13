// @vitest-environment happy-dom
//
// #346 RED — the roster row's invite value is a real URL, and clicking it
// copies. Contract (issue #346, Gama; screenshots by Mihkel):
//
// - The row's value is the COMPOSED absolute URL — buildInviteUrl(
//   window.location.origin, token): scheme, host, /invite/<token> — identical
//   in shape to the admin surface's. Never a bare JWT (a bare JWT pasted into
//   a browser is a search query; two live crede tokens reached chat in one
//   day because this value invited transcription instead of a paste).
// - The value renders as a READONLY, CLASSED <input> (a <p> cannot
//   `.select()`); native control, unclassed-controls guard applies.
// - #345's landed idiom EXACTLY (f501a78), via the ONE shared implementation
//   (`createInviteLinkCopier`, $lib/invite/copy-invite-link — per-row
//   instances): click the value → text selected AND copied; confirmation in a
//   per-row persistent `role="status"` node (`roster-invite-copy-status-
//   {memberId}`) mounted WITH the link panel, empty at rest, set on settle,
//   cleared at the START of the next attempt, NO timer; clipboard-absent →
//   per-row `role="alert"` (`roster-invite-copy-error-{memberId}`) and the
//   click still leaves the text selected — never a silent no-op.
// - FENCES: the bearer warning stays, byte-identical, rendered AFTER the
//   input; both producers (`kutsu` and `saada uuesti`) feed this same render
//   through the single handleMintInvite producer.
//
// CLIPBOARD MOCK — page.admin-invite-copy.spec.ts's pattern verbatim:
// per-property `Object.defineProperty` on the navigator INSTANCE, restored
// from the captured original descriptor; never vi.stubGlobal('navigator').
//
// Renders the REAL /roster route (fixtures/drive path from
// page.roster-join-state.spec.ts) — GREEN cannot satisfy this suite without
// wiring the shared module into the actual page.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const {
	loadRosterMock,
	listSectionsMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock,
	withdrawInviteMock,
	listJoinStatesMock,
	resolveOwnerTierMock,
	loadMemberRecordMock,
	createCopierSpy
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn(),
	withdrawInviteMock: vi.fn(),
	listJoinStatesMock: vi.fn(),
	resolveOwnerTierMock: vi.fn(),
	loadMemberRecordMock: vi.fn(),
	createCopierSpy: vi.fn()
}));

vi.mock('$lib/roster/rosterData', () => ({ loadRosterWithRealNames: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: deactivateMemberMock,
	reinstateMember: reinstateMemberMock,
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: listInactiveMembersMock,
	listDeactivateBlockers: listDeactivateBlockersMock
}));
vi.mock('$lib/invite/inviteData', async (importActual) => ({
	...(await importActual<typeof import('$lib/invite/inviteData')>()),
	createInvite: createInviteMock,
	mintSelfLinkInvite: mintSelfLinkInviteMock,
	withdrawInvite: withdrawInviteMock
}));
// #346 INTEGRATION SEAM — the shared copy module, spy-wrapped around the REAL
// implementation: the assertions below prove the roster route drives its copy
// through `createInviteLinkCopier` (one implementation, one set of failure
// semantics — issue #346 "no second copy path"), not through an inline clone
// that would merely produce the same clipboard calls.
vi.mock('$lib/invite/copy-invite-link', async (importActual) => {
	const actual = await importActual<typeof import('$lib/invite/copy-invite-link')>();
	createCopierSpy.mockImplementation(actual.createInviteLinkCopier);
	return { ...actual, createInviteLinkCopier: createCopierSpy };
});
vi.mock('$lib/profile/linkedIdentities', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/linkedIdentities')>()),
	listJoinStates: listJoinStatesMock
}));
vi.mock('$lib/nav/adminStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/nav/adminStore')>()),
	resolveOwnerTier: resolveOwnerTierMock
}));
vi.mock('$lib/roster/memberRecord', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/memberRecord')>()),
	loadMemberRecord: loadMemberRecordMock
}));
vi.mock('$lib/library/librarianStore', async (importActual) => ({
	...(await importActual<typeof import('$lib/library/librarianStore')>()),
	resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
	resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import type { SectionNode } from '$lib/sections/sectionData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';

const ORG_A = 'org-a';

// m3 invited-unredeemed (the resend/E producer), m4 never invited (the
// invite/D producer) — page.roster-join-state.spec.ts's fixture, trimmed.
function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm1', personId: 'person-p', name: 'Alice Alto', email: 'alice@example.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm3', personId: 'pp-3', name: 'Carl Cantor', email: 'carl@example.com', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm4', personId: 'pp-4', name: 'Dora Descant', email: 'dora@example.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function treeA(): SectionNode[] {
	return [
		{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, dbEntityId: ORG_A, depth: 0, children: [] }
	];
}

const FRESH_TOKEN = 'tok-fresh-1';
const EXPECTED_URL = () => `${window.location.origin}/invite/${FRESH_TOKEN}`;

function setAuthed() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

// ── clipboard control (page.admin-invite-copy.spec.ts's idiom) ────────────────
const originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: unknown): void {
	Object.defineProperty(navigator, 'clipboard', {
		value,
		configurable: true,
		writable: true
	});
}

function installWriteText(): ReturnType<typeof vi.fn> {
	const writeText = vi.fn().mockResolvedValue(undefined);
	setClipboard({ writeText });
	return writeText;
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(rowsA()));
	listSectionsMock.mockResolvedValue(treeA());
	listJoinStatesMock.mockResolvedValue({ 'person-p': 'joined', 'pp-3': 'invited', 'pp-4': 'absent' });
	resolveOwnerTierMock.mockResolvedValue('owner');
	mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: FRESH_TOKEN });
	withdrawInviteMock.mockResolvedValue(undefined);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	if (originalClipboardDesc) {
		Object.defineProperty(navigator, 'clipboard', originalClipboardDesc);
	} else {
		Reflect.deleteProperty(navigator, 'clipboard');
	}
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderRoster() {
	const utils = render(Page);
	setAuthed();
	adminStore.set('admin');
	await waitFor(() =>
		expect(
			utils.container.querySelector('[data-testid="section-toggle-unassigned"]')
		).not.toBeNull()
	);
	await fireEvent.click(
		utils.container.querySelector('[data-testid="section-toggle-unassigned"]')!
	);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="roster-row-m4"]')).not.toBeNull()
	);
	return utils;
}

// #302 drive-path step — the controls live inside the opened record editor.
async function openCard(container: HTMLElement, memberId: string) {
	const li = q(container, `roster-row-${memberId}`);
	expect(li, `roster-row-${memberId} must render`).not.toBeNull();
	if (li!.querySelector('[data-testid="roster-record-name"]')) return;
	const card = q(container, `roster-row-card-${memberId}`);
	expect(card, `collapsed-card activator roster-row-card-${memberId} must render`).not.toBeNull();
	await fireEvent.click(card!);
	await waitFor(() =>
		expect(
			q(container, `roster-row-${memberId}`)!.querySelector('[data-testid="roster-record-name"]')
		).not.toBeNull()
	);
}

/** Drive one row to its minted-link panel via the named producer button. */
async function mintFor(
	container: HTMLElement,
	memberId: string,
	producer: 'invite' | 'reinvite'
): Promise<HTMLElement> {
	await openCard(container, memberId);
	const buttonId = `roster-member-${producer}-${memberId}`;
	await waitFor(() => expect(q(container, buttonId)).not.toBeNull());
	await fireEvent.click(q(container, buttonId)!);
	return waitFor(() => {
		const el = q(container, `roster-invite-link-${memberId}`);
		expect(el, `roster-invite-link-${memberId} must render after the mint`).not.toBeNull();
		return el!;
	});
}

// ── the value: a readonly, classed input holding the composed URL ─────────────

describe('#346 the value is a readonly <input> holding the ABSOLUTE invite URL', () => {
	it('Invite (D-path, m4): a readonly, classed input whose value is origin + /invite/<token> — never a bare JWT', async () => {
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');

		// A <p> cannot .select() — the value must be a real input (native
		// control), readonly so a stray keystroke cannot corrupt the secret.
		expect(link.tagName).toBe('INPUT');
		const input = link as HTMLInputElement;
		expect(input.readOnly).toBe(true);
		expect(input.value).toBe(EXPECTED_URL());
		// Unclassed-controls guard: the control keeps real styling tokens.
		expect(input.className.trim()).not.toBe('');
		expect(input.className).toContain('border');
	});

	it('Resend (E-path, m3): the SAME input shape and the SAME composed URL — both producers share the one render', async () => {
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm3', 'reinvite');

		expect(link.tagName).toBe('INPUT');
		const input = link as HTMLInputElement;
		expect(input.readOnly).toBe(true);
		expect(input.value).toBe(EXPECTED_URL());
		// The single producer is handleMintInvite — a createInvite call from the
		// roster would manufacture a duplicate person+member.
		expect(createInviteMock).not.toHaveBeenCalled();
	});
});

// ── click → select + copy, through the ONE shared implementation ──────────────

describe('#346 clicking the value selects it and copies it — via the shared module', () => {
	it('click → the full URL is SELECTED and the clipboard receives it exactly once', async () => {
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');
		const writeText = installWriteText();

		await fireEvent.click(link);

		const input = link as HTMLInputElement;
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		expect(writeText).toHaveBeenCalledWith(EXPECTED_URL());
	});

	it('INTEGRATION: the copy runs through createInviteLinkCopier ($lib/invite/copy-invite-link) — the roster grew NO second copy implementation', async () => {
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');
		const writeText = installWriteText();

		await fireEvent.click(link);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});

		// The seam assertion: the shared module produced that clipboard call.
		expect(createCopierSpy).toHaveBeenCalled();
		const getText = createCopierSpy.mock.calls[0][0] as () => string;
		expect(getText()).toBe(EXPECTED_URL());
	});
});

// ── the per-row persistent status node (the #345 three-part shape) ────────────

describe('#346 roster-invite-copy-status-{memberId} — per-row persistent role="status" node', () => {
	it('mounts WITH the link panel: present before any copy, role="status", aria-live="polite", empty text, reserved min-height', async () => {
		const { container } = await renderRoster();
		await mintFor(container, 'm4', 'invite');

		const status = q(container, 'roster-invite-copy-status-m4');
		expect(status, 'expected the per-row persistent copy-status node').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		expect(status!.className).toMatch(/min-h-/);
	});

	it('success → announces [admin_invite_copied] on the SAME node that rendered empty (never unmount/remount)', async () => {
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');
		installWriteText();

		const statusAtRest = q(container, 'roster-invite-copy-status-m4');
		expect(statusAtRest).not.toBeNull();

		await fireEvent.click(link);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		expect(q(container, 'roster-invite-copy-status-m4')).toBe(statusAtRest);
	});

	it('clears at the START of the next attempt (held second copy → empty text, same node, no timer involved)', async () => {
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });

		await fireEvent.click(link);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		const statusAfterFirst = q(container, 'roster-invite-copy-status-m4');

		// The second attempt NEVER settles — a clear can only come from entry.
		writeText.mockReturnValue(new Promise(() => {}));
		await fireEvent.click(link);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe('');
		});
		expect(q(container, 'roster-invite-copy-status-m4')).toBe(statusAfterFirst);
	});
});

// ── clipboard absent: per-row alert + the text still selected ─────────────────

describe('#346 clipboard ABSENT — per-row role="alert", the click still selects', () => {
	it('navigator.clipboard undefined: [admin_invite_copy_error] alert on THIS row + full text selected; status node stays empty', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');
		setClipboard(undefined);

		await fireEvent.click(link);

		const alert = await waitFor(() => {
			const el = q(container, 'roster-invite-copy-error-m4');
			expect(el, 'expected the per-row copy-failure alert').not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[admin_invite_copy_error]');

		// The manual fallback: the click leaves the whole URL selected, so
		// Ctrl/Cmd-C is one keystroke away exactly where the API is missing.
		const input = link as HTMLInputElement;
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);

		// Failure is the alert's story — the status node says nothing.
		expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe('');
		consoleSpy.mockRestore();
	});

	it('clipboard present but writeText missing: same visible failure + selection', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');
		setClipboard({}); // the API object exists; writeText does not

		await fireEvent.click(link);

		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-error-m4')).not.toBeNull();
		});
		const input = link as HTMLInputElement;
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
		consoleSpy.mockRestore();
	});
});

// ── fences ────────────────────────────────────────────────────────────────────

describe('#346 fences — the bearer warning survives, after the input', () => {
	it('the warning renders byte-identical ([admin_invite_bearer_warning]) and FOLLOWS the input in document order', async () => {
		const { container } = await renderRoster();
		const link = await mintFor(container, 'm4', 'invite');

		const warning = Array.from(container.querySelectorAll('p')).find(
			(p) => p.textContent?.trim() === '[admin_invite_bearer_warning]'
		);
		expect(
			warning,
			'the bearer warning is the only thing on the row saying what an admin is holding'
		).not.toBeUndefined();
		// After the value, as today: the warning explains the thing above it.
		expect(
			link.compareDocumentPosition(warning!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});
});

// (*MVOX:Tallis* — #346 RED: composed-URL input + click-to-copy on the roster
//  row through the shared copy module; fixtures/drive path from
//  page.roster-join-state.spec.ts, clipboard idiom from
//  page.admin-invite-copy.spec.ts)
