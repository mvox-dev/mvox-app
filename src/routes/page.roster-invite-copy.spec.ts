// @vitest-environment happy-dom
//
// #360 RED — the roster row's invite link is never shown on screen: the row
// GAINS a copy button and LOSES the readonly input. Contract (issue #360,
// Mihkel verbatim: "lets not show them on screen at no time — copy to
// clipboard is enough"; Gama: match InviteSurface's copy affordance, keep the
// per-row confirmation node exactly as it is, NO reveal-on-failure):
//
// - The per-row readonly input (`roster-invite-link-{memberId}`) is GONE. A
//   native, classed (#335 guard) copy BUTTON — `roster-invite-copy-{memberId}`,
//   the #345 a11y pattern: focusable, static label, confirmation in the
//   status node, never on the label — is the row's only affordance.
// - NO element renders the composed invite URL or the raw token — text,
//   value, or attribute — in ANY state: after mint, after copy success,
//   after copy FAILURE.
// - The copy still runs through the ONE shared implementation
//   (`createInviteLinkCopier`, $lib/invite/copy-invite-link — per-row
//   instances); the copier itself does not change (its own suite,
//   copy-invite-link.spec.ts, passes unmodified).
// - Clipboard ABSENT (Gama's sharpening, verbatim law: the replacement tests
//   "must assert OBSERVABLE behaviour — failure state visible, failure names
//   the re-send recourse — not merely that some text renders"): the per-row
//   `role="alert"` is VISIBLE and renders the `admin_invite_copy_error` key,
//   whose reworded text (pinned per-locale in page.admin-invite-copy-i18n
//   .spec.ts) names re-sending the invite. NO selection fallback — there is
//   deliberately nothing on screen to select.
// - DELETED with #360 (deliberate, not drift): the input-shape describe
//   (tagName/readOnly/classes/composed-value-rendered) and every
//   selectionStart/selectionEnd assertion — they described the element this
//   commission removes. The composed-URL claim moved to the clipboard
//   payload; the rendered-absence claim moved here and to the sweep
//   (no-rendered-invite-link.sweep.spec.ts).
// - FENCES: the per-row confirmation node (`roster-invite-copy-status-
//   {memberId}`) keeps its #346 shape unchanged; the bearer warning stays;
//   both producers (`kutsu` and `saada uuesti`) feed the same panel.
//
// CLIPBOARD MOCK — page.admin-invite-copy.spec.ts's pattern verbatim:
// per-property `Object.defineProperty` on the navigator INSTANCE, restored
// from the captured original descriptor; never vi.stubGlobal('navigator').
//
// Renders the REAL /roster route (fixtures/drive path from
// page.roster-join-state.spec.ts) — GREEN cannot satisfy this suite without
// wiring the button into the actual page.
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
// #346/#360 INTEGRATION SEAM — the shared copy module, spy-wrapped around the
// REAL implementation: the assertions below prove the roster route drives its
// copy through `createInviteLinkCopier` (one implementation, one set of
// failure semantics), not through an inline clone that would merely produce
// the same clipboard calls.
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
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
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

/** #360 — the no-reveal ruling as an assertion: neither the composed URL nor
 *  the raw token reaches the DOM — text, control value (Svelte sets values as
 *  properties, innerHTML alone can miss them), or attribute. */
function expectNoInviteMaterial(container: HTMLElement): void {
	expect(container.textContent).not.toContain(FRESH_TOKEN);
	expect(container.textContent).not.toContain('/invite/');
	expect(container.innerHTML).not.toContain(FRESH_TOKEN);
	for (const el of Array.from(
		container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
	)) {
		expect(el.value).not.toContain(FRESH_TOKEN);
		expect(el.value).not.toContain('/invite/');
	}
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

/** #360 — drive one row to its minted panel via the named producer button and
 *  return the row's COPY BUTTON (the panel's only affordance now). */
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
		const el = q(container, `roster-invite-copy-${memberId}`);
		expect(el, `roster-invite-copy-${memberId} must render after the mint`).not.toBeNull();
		return el!;
	});
}

// ── #360 — the row gains a copy button; the URL itself never renders ──────────

describe('#360 the roster row gains a copy BUTTON — InviteSurface\'s affordance, and no rendered link', () => {
	it('Invite (D-path, m4): a native, classed, focusable button with a STATIC [admin_invite_copy] label; the old input is GONE and no URL/token renders', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');

		// #345's a11y pattern: a real button IS the control — native, typed,
		// focusable; #335's guard: never an unclassed control.
		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('type')).toBe('button');
		expect((button as HTMLButtonElement).disabled).toBe(false);
		expect(button.className.trim()).not.toBe('');
		expect(button.className).toContain('border');
		expect((button as HTMLButtonElement).tabIndex).toBeGreaterThanOrEqual(0);
		(button as HTMLButtonElement).focus();
		expect(document.activeElement).toBe(button);
		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');

		// The display element this commission removes:
		expect(q(container, 'roster-invite-link-m4')).toBeNull();
		expectNoInviteMaterial(container);
	});

	it('Resend (E-path, m3): the SAME affordance — both producers share the one panel; still nothing rendered', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm3', 'reinvite');

		expect(button.tagName).toBe('BUTTON');
		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');
		expect(q(container, 'roster-invite-link-m3')).toBeNull();
		expectNoInviteMaterial(container);
		// The single producer is handleMintInvite — a createInvite call from the
		// roster would manufacture a duplicate person+member.
		expect(createInviteMock).not.toHaveBeenCalled();
	});

	it('the button label stays STATIC after a successful copy — the confirmation lives in the status node', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');
		installWriteText();

		await fireEvent.click(button);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');
	});
});

// ── button click → copy, through the ONE shared implementation ────────────────

describe('#360 the button click copies the composed URL — via the shared module', () => {
	it('click → the clipboard receives the ABSOLUTE invite URL exactly once; the URL exists ONLY as the payload, never in the DOM', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');
		const writeText = installWriteText();

		await fireEvent.click(button);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		expect(writeText).toHaveBeenCalledWith(EXPECTED_URL());
		// Success state reveals nothing either.
		expectNoInviteMaterial(container);
	});

	it('INTEGRATION: the copy runs through createInviteLinkCopier ($lib/invite/copy-invite-link) — the roster grew NO second copy implementation', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');
		const writeText = installWriteText();

		await fireEvent.click(button);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});

		// The seam assertion: the shared module produced that clipboard call.
		expect(createCopierSpy).toHaveBeenCalled();
		const getText = createCopierSpy.mock.calls[0][0] as () => string;
		expect(getText()).toBe(EXPECTED_URL());
	});
});

// ── the per-row persistent status node — #346 shape, UNCHANGED ────────────────

describe('#360 roster-invite-copy-status-{memberId} — the per-row confirmation node stays exactly as it is', () => {
	it('mounts WITH the panel: present before any copy, role="status", aria-live="polite", empty text, reserved min-height', async () => {
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
		const button = await mintFor(container, 'm4', 'invite');
		installWriteText();

		const statusAtRest = q(container, 'roster-invite-copy-status-m4');
		expect(statusAtRest).not.toBeNull();

		await fireEvent.click(button);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		expect(q(container, 'roster-invite-copy-status-m4')).toBe(statusAtRest);
	});

	it('clears at the START of the next attempt (held second copy → empty text, same node, no timer involved)', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });

		await fireEvent.click(button);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		const statusAfterFirst = q(container, 'roster-invite-copy-status-m4');

		// The second attempt NEVER settles — a clear can only come from entry.
		writeText.mockReturnValue(new Promise(() => {}));
		await fireEvent.click(button);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe('');
		});
		expect(q(container, 'roster-invite-copy-status-m4')).toBe(statusAfterFirst);
	});
});

// ── clipboard absent: OBSERVABLE failure naming the recourse, NO reveal ───────

describe('#360 clipboard ABSENT — per-row alert visible, names re-sending, reveals nothing (Gama sharpening)', () => {
	it('navigator.clipboard undefined: [admin_invite_copy_error] alert on THIS row; status node empty; NO invite material anywhere', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');
		setClipboard(undefined);

		await fireEvent.click(button);

		// Observable failure state: the alert is visible and carries the key
		// whose reworded text (pinned in page.admin-invite-copy-i18n.spec.ts)
		// names re-sending the invite — the only recourse now that there is
		// deliberately nothing on screen to select or photograph.
		const alert = await waitFor(() => {
			const el = q(container, 'roster-invite-copy-error-m4');
			expect(el, 'expected the per-row copy-failure alert').not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[admin_invite_copy_error]');

		// Failure is the alert's story — the status node says nothing.
		expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe('');

		// The no-reveal ruling AT the failure moment: nothing to photograph.
		expect(q(container, 'roster-invite-link-m4')).toBeNull();
		expectNoInviteMaterial(container);
		consoleSpy.mockRestore();
	});

	it('clipboard present but writeText missing: same visible failure, same silence', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');
		setClipboard({}); // the API object exists; writeText does not

		await fireEvent.click(button);

		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-error-m4')).not.toBeNull();
		});
		expect(q(container, 'roster-invite-copy-error-m4')!.textContent).toContain(
			'[admin_invite_copy_error]'
		);
		expectNoInviteMaterial(container);
		consoleSpy.mockRestore();
	});
});

// ── fences ────────────────────────────────────────────────────────────────────

describe('#360 fences — the bearer warning survives the input removal', () => {
	it('the warning renders byte-identical ([admin_invite_bearer_warning]) and FOLLOWS the copy button in document order', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');

		const warning = Array.from(container.querySelectorAll('p')).find(
			(p) => p.textContent?.trim() === '[admin_invite_bearer_warning]'
		);
		expect(
			warning,
			'the bearer warning is the only thing on the row saying what an admin is holding'
		).not.toBeUndefined();
		// After the affordance, as today: the warning explains the thing above it.
		expect(
			button.compareDocumentPosition(warning!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});
});

// (*MVOX:Tallis* — #360 RED: the roster row's input dies, a copy button lands
//  (InviteSurface's affordance, #335 classed, #345 a11y), absence asserted in
//  every state, failure observable via the reworded admin_invite_copy_error;
//  fixtures/drive path from page.roster-join-state.spec.ts)
