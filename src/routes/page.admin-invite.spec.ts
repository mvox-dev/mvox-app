// @vitest-environment happy-dom
//
// T4.5/#31 — the admin invite surface at /admin/invite. Contract:
// - no selected collective → no-collective message
// - prerequisite load: not-visible → no-access (labeled heuristic); ANY other
//   failure → load-error + retry. Network errors are NEVER presented as
//   "not admin".
// - ready → org select only (#36 — no name/email fields); a sole org
//   preselects and submit is immediately enabled; multiple orgs require a
//   manual pick before submit enables
// - done → show-ONCE invite link + always-visible bearer warning; the token
//   never touches localStorage/sessionStorage
// - create-error → verbatim phased error; a personId-carrying error additionally
//   surfaces the orphaned-person warning
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		admin_invite_title: () => 'Invite a new member',
		admin_invite_no_collective: () => 'Select a collective before creating invites.',
		admin_invite_no_access: () => 'Creating invites requires administrator rights.',
		admin_invite_load_error: () => 'Could not load invite prerequisites.',
		admin_invite_retry_load: () => 'Retry',
		admin_invite_org_label: () => 'Organization',
		admin_invite_submit: () => 'Create invite',
		admin_invite_creating: () => 'Creating…',
		admin_invite_link_label: () => 'Invite link',
		admin_invite_copy: () => 'Copy link',
		admin_invite_copied: () => 'Copied',
		admin_invite_bearer_warning: () => 'Bearer secret — send only to the invited person.',
		admin_invite_show_once: (p: { date: string }) => `Shown only once. Expires on ${p.date}.`,
		admin_invite_error: (p: { phase: string; message: string }) =>
			`Invite creation failed at step ${p.phase}: ${p.message}`,
		admin_invite_partial_failure: (p: { personId: string }) =>
			`A person entity (${p.personId}) was already created and carries a live invite token.`,
		admin_invite_create_another: () => 'Create another invite'
	}
}));

// Mock the invite data layer at its module boundary. The error class is defined
// INSIDE the mock so the page's `instanceof InviteCreateError` checks match the
// instances these tests reject with.
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
		listOrgsMock: vi.fn(),
		createInviteMock: vi.fn()
	};
});
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: h.resolveParentMock,
	listOrganizations: h.listOrgsMock,
	createInvite: h.createInviteMock
}));
// Sever the $env chain the collectives store pulls in (discover → marker →
// entu-config) and the store's `goto` import.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

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

// The minted token is a REAL decodable invite JWT — the done-panel derives the
// shown expiry from the token's own exp, not an assumed +7d.
const MINTED_TOKEN = jwt({ db: 'polyphony', entityId: 'p1', iat: 1, exp: 4_102_444_800 });

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
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.listOrgsMock.mockResolvedValue([{ _id: 'org-1', name: 'EFK' }]);
}

async function submitForm(container: HTMLElement) {
	const submit = container.querySelector(
		'[data-testid="invite-admin-submit"]'
	) as HTMLButtonElement;
	await fireEvent.click(submit);
}

beforeEach(() => {
	h.resolveParentMock.mockReset();
	h.listOrgsMock.mockReset();
	h.createInviteMock.mockReset();
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('/admin/invite — prerequisites', () => {
	it('without a selected collective shows the no-collective state (no form, no data calls)', async () => {
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-no-collective"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-org"]')).toBeNull();
	});

	it("a not-visible prerequisite → the no-access state (a labeled heuristic — the authoritative gate is Entu's create POST)", async () => {
		selectPolyphony();
		h.resolveParentMock.mockRejectedValue(
			new h.InviteCreateError('database entity not visible', {
				phase: 'person-parent-resolve',
				reason: 'not-visible'
			})
		);
		h.listOrgsMock.mockResolvedValue([{ _id: 'org-1', name: 'EFK' }]);

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-no-access"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-org"]')).toBeNull();
		expect(container.querySelector('[data-testid="invite-admin-load-error"]')).toBeNull();
	});

	it('an HTTP/network prerequisite failure → generic localized error (not raw message); logs detail to console.error; retry works', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		h.resolveParentMock.mockRejectedValue(
			new h.InviteCreateError('resolve failed: 500', { phase: 'person-parent-resolve', reason: 'http' })
		);
		h.listOrgsMock.mockResolvedValue([{ _id: 'org-1', name: 'EFK' }]);

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-admin-no-access"]')).toBeNull();

		// Generic message shown, raw error NOT shown
		expect(container.textContent).toContain('Could not load invite prerequisites.');
		expect(container.textContent).not.toContain('resolve failed: 500');

		// Detail logged to console
		expect(consoleSpy).toHaveBeenCalled();
		const loggedArgs = consoleSpy.mock.calls.flat();
		const loggedDetail = loggedArgs.some(
			(arg) => arg instanceof Error && arg.message === 'resolve failed: 500'
		);
		expect(loggedDetail).toBe(true);

		// Retry is real: once the backend recovers, the same button reaches ready.
		loadOk();
		const retry = container.querySelector(
			'[data-testid="invite-admin-retry-load"]'
		) as HTMLButtonElement;
		expect(retry).not.toBeNull();
		await fireEvent.click(retry);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-org"]')).not.toBeNull();
		});

		consoleSpy.mockRestore();
	});
});

describe('/admin/invite — ready form', () => {
	it('preselects a sole organization (select still rendered) and submit is immediately enabled — no other fields', async () => {
		selectPolyphony();
		loadOk();

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="invite-org"]') as HTMLSelectElement;
		expect(select.value).toBe('org-1'); // sole org preselected (select still rendered)

		const submit = container.querySelector(
			'[data-testid="invite-admin-submit"]'
		) as HTMLButtonElement;
		expect(submit.disabled).toBe(false); // orgId is the only requirement, already set
	});

	it('with multiple organizations, nothing is preselected and submit stays disabled until one is picked', async () => {
		selectPolyphony();
		h.resolveParentMock.mockResolvedValue('parent-1');
		h.listOrgsMock.mockResolvedValue([
			{ _id: 'org-1', name: 'EFK' },
			{ _id: 'org-2', name: 'RAM' }
		]);

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="invite-org"]') as HTMLSelectElement;
		expect(select.value).toBe('');

		const submit = container.querySelector(
			'[data-testid="invite-admin-submit"]'
		) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		await fireEvent.change(select, { target: { value: 'org-2' } });
		await waitFor(() => {
			expect(submit.disabled).toBe(false);
		});
	});
});

describe('/admin/invite — done (show-once link)', () => {
	it('calls createInvite with the selected cfg + form input, shows the link + always-visible bearer warning, and the token NEVER touches storage', async () => {
		selectPolyphony();
		loadOk();
		h.createInviteMock.mockResolvedValue({
			personId: 'p1',
			memberId: 'm1',
			inviteToken: MINTED_TOKEN
		});

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});
		await submitForm(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-result"]')).not.toBeNull();
		});

		// The data layer was driven with the selected collective + the sole
		// preselected org. #34/#36 — neither the invitee's email nor a member
		// name is ever collected or forwarded: the member carries no name and
		// the invitee's real email never reaches Entu.
		const [cfgArg, inputArg] = h.createInviteMock.mock.calls[0] as [
			{ db: string; token: string },
			{ orgId: string; email?: string; memberName?: string }
		];
		expect(cfgArg).toMatchObject({ db: 'polyphony', token: 'jwt-admin' });
		expect(inputArg).toEqual({ orgId: 'org-1' });
		expect(inputArg).not.toHaveProperty('email');
		expect(inputArg).not.toHaveProperty('memberName');

		// The full invite URL, shown once.
		const link = container.querySelector('[data-testid="invite-link"]') as HTMLInputElement;
		expect(link).not.toBeNull();
		expect(link.value).toBe(`${window.location.origin}/invite/${MINTED_TOKEN}`);

		// Bearer warning is always visible. #36 — it can no longer name the
		// invitee (no email is collected at all), so it stays generic.
		const warning = container.querySelector('[data-testid="invite-bearer-warning"]');
		expect(warning).not.toBeNull();
		expect(warning!.textContent).toContain('Bearer secret');

		// Bearer-secret hygiene: the token surfaces EXACTLY ONCE in the rendered
		// output — a second interpolation (warning text, href, data- attribute)
		// would widen the secret's DOM surface. Svelte sets the input value as a
		// property, so innerHTML alone may count zero: include input values.
		const surface =
			container.innerHTML +
			Array.from(container.querySelectorAll('input'))
				.map((i) => i.value)
				.join('\n');
		expect(surface.split(MINTED_TOKEN).length - 1).toBe(1);

		// Bearer-secret hygiene: the token lives ONLY in component state.
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)!;
			expect(localStorage.getItem(key)).not.toContain(MINTED_TOKEN);
		}
		for (let i = 0; i < sessionStorage.length; i++) {
			const key = sessionStorage.key(i)!;
			expect(sessionStorage.getItem(key)).not.toContain(MINTED_TOKEN);
		}
	});
});

describe('/admin/invite — create-error', () => {
	it('renders the phased error verbatim and, with a personId attached, the orphaned-person warning — form values preserved for retry', async () => {
		selectPolyphony();
		loadOk();
		h.createInviteMock.mockRejectedValue(
			new h.InviteCreateError('member create failed: 500', {
				phase: 'member-create',
				reason: 'http',
				personId: 'p1'
			})
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});
		await submitForm(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-error"]')).not.toBeNull();
		});
		const errorBlock = container.querySelector('[data-testid="invite-admin-error"]')!;
		expect(errorBlock.textContent).toContain('member-create');
		expect(errorBlock.textContent).toContain('member create failed: 500');

		const partial = container.querySelector('[data-testid="invite-partial-failure"]');
		expect(partial).not.toBeNull();
		expect(partial!.textContent).toContain('p1');

		// Form value preserved for retry: the sole-org selection survives the error.
		const select = container.querySelector('[data-testid="invite-org"]') as HTMLSelectElement;
		expect(select.value).toBe('org-1');
	});

	it('an error WITHOUT a personId (nothing created yet) shows the phased error but NO orphan warning', async () => {
		selectPolyphony();
		loadOk();
		h.createInviteMock.mockRejectedValue(
			new h.InviteCreateError('person create failed: 403', { phase: 'person-create', reason: 'http' })
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});
		await submitForm(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-partial-failure"]')).toBeNull();
	});
});
