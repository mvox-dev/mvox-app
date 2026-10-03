// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const {
	loadRosterMock,
	deactivateMemberMock,
	reinstateMemberMock,
	loadInactiveRosterMock,
	listInactiveMembersMock,
	listDeactivateBlockersMock,
	createInviteMock,
	mintSelfLinkInviteMock,
	withdrawInviteMock,
	listJoinStatesMock,
	listJoinStateDetailsMock,
	resolveOwnerTierMock,
	loadMemberRecordMock,
	createCopierSpy
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	deactivateMemberMock: vi.fn(),
	reinstateMemberMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listInactiveMembersMock: vi.fn(),
	listDeactivateBlockersMock: vi.fn(),
	createInviteMock: vi.fn(),
	mintSelfLinkInviteMock: vi.fn(),
	withdrawInviteMock: vi.fn(),
	listJoinStatesMock: vi.fn(),
	listJoinStateDetailsMock: vi.fn(),
	resolveOwnerTierMock: vi.fn(),
	loadMemberRecordMock: vi.fn(),
	createCopierSpy: vi.fn()
}));

vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
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
vi.mock('$lib/invite/copy-invite-link', async (importActual) => {
	const actual = await importActual<typeof import('$lib/invite/copy-invite-link')>();
	createCopierSpy.mockImplementation(actual.createInviteLinkCopier);
	return { ...actual, createInviteLinkCopier: createCopierSpy };
});
vi.mock('$lib/profile/linkedIdentities', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/linkedIdentities')>()),
	listJoinStates: listJoinStatesMock,
	listJoinStateDetails: listJoinStateDetailsMock
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
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import type { SectionNode } from '$lib/sections/sectionData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock } from '$lib/testing/moduleHandles';

const ORG_A = 'org-a';

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
	signIn();
}

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
	listJoinStateDetailsMock.mockResolvedValue({
		'person-p': { state: 'joined', at: '2026-05-06T12:00:00.000Z' },
		'pp-3': { state: 'invited', at: '2026-09-10T12:00:00.000Z' },
		'pp-4': { state: 'absent' }
	});
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
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

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

describe('#360 the roster row gains a copy BUTTON — InviteSurface\'s affordance, and no rendered link', () => {
	it('Invite (D-path, m4): a native, classed, focusable button with a STATIC [admin_invite_copy] label; the old input is GONE and no URL/token renders', async () => {
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');

		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('type')).toBe('button');
		expect((button as HTMLButtonElement).disabled).toBe(false);
		expect(button.className.trim()).not.toBe('');
		expect(button.className).toContain('border');
		expect((button as HTMLButtonElement).tabIndex).toBeGreaterThanOrEqual(0);
		(button as HTMLButtonElement).focus();
		expect(document.activeElement).toBe(button);
		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');

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

		expect(createCopierSpy).toHaveBeenCalled();
		const getText = createCopierSpy.mock.calls[0][0] as () => string;
		expect(getText()).toBe(EXPECTED_URL());
	});
});

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

		writeText.mockReturnValue(new Promise(() => {}));
		await fireEvent.click(button);
		await waitFor(() => {
			expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe('');
		});
		expect(q(container, 'roster-invite-copy-status-m4')).toBe(statusAfterFirst);
	});
});

describe('#360 clipboard ABSENT — per-row alert visible, names re-sending, reveals nothing (Gama sharpening)', () => {
	it('navigator.clipboard undefined: [admin_invite_copy_error] alert on THIS row; status node empty; NO invite material anywhere', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderRoster();
		const button = await mintFor(container, 'm4', 'invite');
		setClipboard(undefined);

		await fireEvent.click(button);

		const alert = await waitFor(() => {
			const el = q(container, 'roster-invite-copy-error-m4');
			expect(el, 'expected the per-row copy-failure alert').not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('[admin_invite_copy_error]');

		expect(q(container, 'roster-invite-copy-status-m4')?.textContent?.trim()).toBe('');

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
		expect(
			button.compareDocumentPosition(warning!) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});
});

// (*MVOX:Tallis*)
