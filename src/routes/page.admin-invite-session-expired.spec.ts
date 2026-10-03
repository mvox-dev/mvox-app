// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/invite/inviteData', async () =>
	(await import('$lib/testing/mocks/admin')).inviteDataModule({ errors: true })
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './admin/invite/+page.svelte';
import {
	InviteCreateError,
	createInviteMock,
	resolveInviteParentMock,
	resolveParentMock
} from '$lib/testing/mocks/admin';
import { authExpiredError, resetInviteMocks, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupReset } from '$lib/testing/pages/dom';

beforeEach(resetInviteMocks);

afterEach(cleanupReset);

describe('/admin/invite — session expired (#107 review F2)', () => {
	it('an auth-expired PREREQUISITE load shows the session-expired notice — not the generic load error, and never "not admin"', async () => {
		resolveParentMock.mockRejectedValue(authExpiredError());
		resolveInviteParentMock.mockRejectedValue(authExpiredError());
		selectSampledb();

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
		resolveParentMock.mockResolvedValue('parent-1');
		resolveInviteParentMock.mockResolvedValue('org-1');
		createInviteMock.mockRejectedValue(authExpiredError());
		selectSampledb();

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
		resolveParentMock.mockRejectedValue(new Error('network down'));
		resolveInviteParentMock.mockRejectedValue(new Error('network down'));
		selectSampledb();

		const generic = render(Page);
		await waitFor(() => {
			expect(
				generic.container.querySelector('[data-testid="invite-admin-load-error"]')
			).not.toBeNull();
		});
		expect(generic.container.querySelector('[data-testid="invite-admin-retry-load"]')).not.toBeNull();
		expect(generic.container.querySelector('[data-testid="session-expired"]')).toBeNull();
		cleanup();

		resolveParentMock.mockRejectedValue(
			new InviteCreateError('not visible', { phase: 'prerequisites', reason: 'not-visible' })
		);
		resolveInviteParentMock.mockRejectedValue(
			new InviteCreateError('not visible', { phase: 'prerequisites', reason: 'not-visible' })
		);
		selectSampledb();

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
