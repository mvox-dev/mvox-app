// @vitest-environment happy-dom
//
// #107 review F2 — auth token expiry recovery on /admin/invite, the second
// surface the first #107 pass missed. Both of its failure sinks were
// untreated: the prerequisite load fell into `load-error` (Retry against a
// token entuFetch had already deleted), and the create POST fell into
// `create-error` ("Invite creation failed" for what is really a dead session).
// Neither is "not admin" and neither is a data problem.
//
// Mock scaffolding inherited from page.admin-invite.spec.ts.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
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
		createInviteMock: vi.fn()
	};
});
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
}));
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

/** Duck-typed 401 rejection from the entuFetch layer (name-tag contract). */
function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

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

beforeEach(() => {
	h.resolveParentMock.mockReset();
	h.resolveInviteParentMock.mockReset();
	h.createInviteMock.mockReset();
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('/admin/invite — session expired (#107 review F2)', () => {
	it('an auth-expired PREREQUISITE load shows the session-expired notice — not the generic load error, and never "not admin"', async () => {
		h.resolveParentMock.mockRejectedValue(authExpiredError());
		h.resolveInviteParentMock.mockRejectedValue(authExpiredError());
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		const signin = container.querySelector('[data-testid="session-expired-signin"]');
		expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

		expect(container.querySelector('[data-testid="invite-admin-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="invite-admin-retry-load"]')).toBeNull();
		expect(container.querySelector('[data-testid="invite-admin-no-access"]')).toBeNull();
	});

	it('an auth-expired CREATE shows the session-expired notice — not "invite creation failed"', async () => {
		h.resolveParentMock.mockResolvedValue('parent-1');
		h.resolveInviteParentMock.mockResolvedValue('org-1');
		h.createInviteMock.mockRejectedValue(authExpiredError());
		selectPolyphony();

		const { container } = render(Page);
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="invite-admin-submit"]'
			) as HTMLButtonElement | null;
			expect(submit).not.toBeNull();
			expect(submit?.disabled).toBe(false);
		});

		await fireEvent.click(
			container.querySelector('[data-testid="invite-admin-submit"]') as HTMLButtonElement
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-admin-error"]')).toBeNull();
	});

	it('a GENERIC prerequisite failure still shows the loud load error + retry, and not-visible still shows no-access', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		h.resolveParentMock.mockRejectedValue(new Error('network down'));
		h.resolveInviteParentMock.mockRejectedValue(new Error('network down'));
		selectPolyphony();

		const generic = render(Page);
		await waitFor(() => {
			expect(
				generic.container.querySelector('[data-testid="invite-admin-load-error"]')
			).not.toBeNull();
		});
		expect(generic.container.querySelector('[data-testid="invite-admin-retry-load"]')).not.toBeNull();
		expect(generic.container.querySelector('[data-testid="session-expired"]')).toBeNull();
		cleanup();

		h.resolveParentMock.mockRejectedValue(
			new h.InviteCreateError('not visible', { phase: 'prerequisites', reason: 'not-visible' })
		);
		h.resolveInviteParentMock.mockRejectedValue(
			new h.InviteCreateError('not visible', { phase: 'prerequisites', reason: 'not-visible' })
		);
		selectPolyphony();

		const noAccess = render(Page);
		await waitFor(() => {
			expect(
				noAccess.container.querySelector('[data-testid="invite-admin-no-access"]')
			).not.toBeNull();
		});
		expect(noAccess.container.querySelector('[data-testid="session-expired"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Josquin*)
