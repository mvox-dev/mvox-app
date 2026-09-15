// @vitest-environment happy-dom
//
// #346 RED — the EXTRACT seam on the admin surface. #346 moves #345's copy
// semantics into the shared module (`createInviteLinkCopier`,
// $lib/invite/copy-invite-link) so the roster row can ride the SAME
// implementation. page.admin-invite-copy.spec.ts stays black-box and
// UNMODIFIED — it is the refactor's behavioral fence. THIS suite pins the one
// thing that fence cannot: that InviteSurface's copy actually runs THROUGH
// the shared module after the extract, not through a retained inline clone
// (two implementations = two drifting failure semantics, the exact thing
// issue #346 forbids).
//
// Scaffolding is page.admin-invite-copy.spec.ts's renderDone, trimmed to the
// two seam assertions; the clipboard mock is the same per-property
// defineProperty idiom.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		admin_invite_title: () => 'Invite a new member',
		admin_invite_no_collective: () => 'Select a collective before creating invites.',
		admin_invite_no_access: () => 'Creating invites requires administrator rights.',
		admin_invite_load_error: () => 'Could not load invite prerequisites.',
		admin_invite_retry_load: () => 'Retry',
		admin_invite_db_label: () => 'Collective',
		admin_invite_submit: () => 'Create invite',
		admin_invite_creating: () => 'Creating…',
		admin_invite_link_label: () => 'Invite link',
		admin_invite_copy: () => '[admin_invite_copy]',
		admin_invite_copied: () => '[admin_invite_copied]',
		admin_invite_copy_error: () => '[admin_invite_copy_error]',
		admin_invite_create_another: () => '[admin_invite_create_another]',
		admin_invite_bearer_warning: () => 'Bearer secret — send only to the invited person.',
		admin_invite_show_once: (p: { date: string }) => `Shown only once. Expires on ${p.date}.`,
		admin_invite_error: () => 'Invite creation failed.',
		admin_invite_partial_failure: (p: { personId: string }) =>
			`A person entity (${p.personId}) was already created and carries a live invite token.`
	}
}));

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
	return {
		InviteCreateError,
		resolveParentMock: vi.fn(),
		resolveInviteParentMock: vi.fn(),
		createInviteMock: vi.fn(),
		createCopierSpy: vi.fn()
	};
});
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
}));
// #346 — the seam: spy-wrap the REAL shared module, so a call through it is
// distinguishable from an inline clone producing identical clipboard traffic.
vi.mock('$lib/invite/copy-invite-link', async (importActual) => {
	const actual = await importActual<typeof import('$lib/invite/copy-invite-link')>();
	h.createCopierSpy.mockImplementation(actual.createInviteLinkCopier);
	return { ...actual, createInviteLinkCopier: h.createCopierSpy };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './admin/invite/+page.svelte';
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
const MINTED_TOKEN = jwt({ db: 'polyphony', entityId: 'p1', iat: 1, exp: 4_102_444_800 });

function selectPolyphony(): void {
	setToken('jwt-admin');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'admin-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

function q<T extends HTMLElement = HTMLElement>(container: HTMLElement, testid: string): T | null {
	return container.querySelector<T>(`[data-testid="${testid}"]`);
}

async function renderDone(): Promise<{ container: HTMLElement }> {
	selectPolyphony();
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.createInviteMock.mockResolvedValue({
		personId: 'p1',
		memberId: 'm1',
		inviteToken: MINTED_TOKEN
	});
	const { container } = render(Page);
	await waitFor(() => {
		const submit = q<HTMLButtonElement>(container, 'invite-admin-submit');
		expect(submit && !submit.disabled).toBe(true);
	});
	await fireEvent.click(q(container, 'invite-admin-submit') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'invite-admin-result')).not.toBeNull();
	});
	return { container };
}

const EXPECTED_URL = () => `${window.location.origin}/invite/${MINTED_TOKEN}`;

const originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function installWriteText(): ReturnType<typeof vi.fn> {
	const writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, 'clipboard', {
		value: { writeText },
		configurable: true,
		writable: true
	});
	return writeText;
}

beforeEach(() => {
	h.resolveParentMock.mockReset();
	h.resolveInviteParentMock.mockReset();
	h.createInviteMock.mockReset();
	h.createCopierSpy.mockClear();
});

afterEach(() => {
	cleanup();
	if (originalClipboardDesc) {
		Object.defineProperty(navigator, 'clipboard', originalClipboardDesc);
	} else {
		Reflect.deleteProperty(navigator, 'clipboard');
	}
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('#346/#360 InviteSurface rides the shared copy module', () => {
	// #360 — the readonly input (and its click trigger) is GONE: the button is
	// the only affordance, so the seam pin re-targets to it. The former
	// input-click variant of this test is DELETED deliberately, not drifted.
	it('a BUTTON-click copy runs through createInviteLinkCopier, and its getText yields the surface\'s own inviteLink', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		expect(writeText).toHaveBeenCalledWith(EXPECTED_URL());

		expect(h.createCopierSpy).toHaveBeenCalled();
		const getText = h.createCopierSpy.mock.calls[0][0] as () => string;
		expect(getText()).toBe(EXPECTED_URL());
	});
});

// (*MVOX:Tallis* — #346 RED: the extract's wiring pin — InviteSurface's copy
//  must run through $lib/invite/copy-invite-link; #360 re-targets the pin to
//  the button, the sole remaining trigger)
