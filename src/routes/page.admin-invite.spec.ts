// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from '$lib/testing/session';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/adminCopy')).adminMessages()
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
import { jwt, resetInviteMocks, selectSampledb } from '$lib/testing/pages/admin';
import { MINTED_TOKEN } from '$lib/testing/pages/adminInvite';
import { cleanupReset } from '$lib/testing/pages/dom';

function selectTwoCollectives() {
	signIn({
		token: 'jwt-admin',
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' },
			{ db: 'ramkoor', name: 'RAM Koor', personId: 'admin-p2' }
		]
	});
}

function loadOk() {
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
}

async function submitForm(container: HTMLElement) {
	const submit = container.querySelector(
		'[data-testid="invite-admin-submit"]'
	) as HTMLButtonElement;
	await fireEvent.click(submit);
}

beforeEach(resetInviteMocks);

afterEach(cleanupReset);

describe('/admin/invite — prerequisites', () => {
	it('without an available collective shows the no-collective state (no form, no data calls)', async () => {
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-no-collective"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-db"]')).toBeNull();
		expect(resolveParentMock).not.toHaveBeenCalled();
		expect(resolveInviteParentMock).not.toHaveBeenCalled();
	});

	it("a not-visible org resolution → the no-access state (#67 — resolveInviteParentId replaces listOrganizations as the org-parent source; #161 review fix round 2 — loadPrerequisites resolves ONLY via resolveInviteParentId now, resolvePersonParentId is no longer called from the page)", async () => {
		selectSampledb();
		resolveParentMock.mockResolvedValue('parent-1');
		resolveInviteParentMock.mockRejectedValue(
			new InviteCreateError('no organization entity is readable', {
				phase: 'org-resolve',
				reason: 'not-visible'
			})
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-no-access"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-db"]')).toBeNull();
	});

	it('an HTTP/network prerequisite failure → generic localized error (not raw message); logs detail to console.error; retry works', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		resolveInviteParentMock.mockRejectedValue(
			new InviteCreateError('resolve failed: 500', { phase: 'org-resolve', reason: 'http' })
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-admin-no-access"]')).toBeNull();

		expect(container.textContent).toContain('Could not load invite prerequisites.');
		expect(container.textContent).not.toContain('resolve failed: 500');

		expect(consoleSpy).toHaveBeenCalled();
		const loggedArgs = consoleSpy.mock.calls.flat();
		const loggedDetail = loggedArgs.some(
			(arg) => arg instanceof Error && arg.message === 'resolve failed: 500'
		);
		expect(loggedDetail).toBe(true);

		loadOk();
		const retry = container.querySelector(
			'[data-testid="invite-admin-retry-load"]'
		) as HTMLButtonElement;
		expect(retry).not.toBeNull();
		await fireEvent.click(retry);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-db"]')).not.toBeNull();
		});

		consoleSpy.mockRestore();
	});
});

describe('/admin/invite — ready form', () => {
	it('preselects a sole collective (database select still rendered) and submit is immediately enabled once prerequisites resolve — no organization-entity picker', async () => {
		selectSampledb();
		loadOk();

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="invite-db"]') as HTMLSelectElement;
		expect(select.value).toBe('sampledb'); // sole collective preselected (select still rendered)
		expect(select.options.length).toBe(2);

		const submit = container.querySelector(
			'[data-testid="invite-admin-submit"]'
		) as HTMLButtonElement;
		await waitFor(() => {
			expect(submit.disabled).toBe(false); // db chosen + org resolved internally
		});

		expect(resolveInviteParentMock).toHaveBeenCalledTimes(1);
		expect(resolveInviteParentMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'sampledb', token: 'jwt-admin' })
		);
	});

	it('with multiple collectives, nothing is preselected and submit stays disabled until one is picked — picking one resolves its org internally', async () => {
		selectTwoCollectives();
		loadOk();

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-db"]')).not.toBeNull();
		});

		const select = container.querySelector('[data-testid="invite-db"]') as HTMLSelectElement;
		expect(select.value).toBe('');
		expect(select.options.length).toBe(3);

		const submit = container.querySelector(
			'[data-testid="invite-admin-submit"]'
		) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		expect(resolveInviteParentMock).not.toHaveBeenCalled(); // no fetch until a db is chosen

		await fireEvent.change(select, { target: { value: 'ramkoor' } });
		await waitFor(() => {
			expect(submit.disabled).toBe(false);
		});
		expect(resolveInviteParentMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'ramkoor', token: 'jwt-admin' })
		);
	});
});

describe('/admin/invite — page heading', () => {
	it('renders the invite title as the single page-level h1', async () => {
		selectSampledb();
		loadOk();

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});

		const headings = Array.from(container.querySelectorAll('h1'));
		expect(headings).toHaveLength(1);
		expect(headings[0].textContent?.trim()).toBe('Invite a new member');
		expect(container.querySelector('h2')).toBeNull();
	});
});

describe('/admin/invite — done (show-once link)', () => {
	it('calls createInvite with the selected db + the internally-resolved org, shows the link + always-visible bearer warning, and the token NEVER touches storage', async () => {
		selectSampledb();
		loadOk();
		createInviteMock.mockResolvedValue({
			personId: 'p1',
			memberId: 'm1',
			inviteToken: MINTED_TOKEN
		});

		const { container } = render(Page);
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="invite-admin-submit"]'
			) as HTMLButtonElement | null;
			expect(submit && !submit.disabled).toBe(true);
		});
		await submitForm(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-result"]')).not.toBeNull();
		});

		const [cfgArg, inputArg] = createInviteMock.mock.calls[0] as [
			{ db: string; token: string },
			{ dbEntityId: string; email?: string; memberName?: string }
		];
		expect(cfgArg).toMatchObject({ db: 'sampledb', token: 'jwt-admin' });
		expect(inputArg).toEqual({ dbEntityId: 'org-1' });
		expect(inputArg).not.toHaveProperty('email');
		expect(inputArg).not.toHaveProperty('memberName');

		expect(container.querySelector('[data-testid="invite-link"]')).toBeNull();

		const warning = container.querySelector('[data-testid="invite-bearer-warning"]');
		expect(warning).not.toBeNull();
		expect(warning!.textContent).toContain('Bearer secret');

		const surface =
			container.innerHTML +
			Array.from(container.querySelectorAll('input'))
				.map((i) => i.value)
				.join('\n');
		expect(surface.split(MINTED_TOKEN).length - 1).toBe(0);

		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)!;
			expect(localStorage.getItem(key)).not.toContain(MINTED_TOKEN);
		}
		for (let i = 0; i < sessionStorage.length; i++) {
			const key = sessionStorage.key(i)!;
			expect(sessionStorage.getItem(key)).not.toContain(MINTED_TOKEN);
		}
	});

	it('#207 rule 7: the show-once expiry date renders as ISO YYYY-MM-DD', async () => {
		selectSampledb();
		loadOk();
		createInviteMock.mockResolvedValue({
			personId: 'p1',
			memberId: 'm1',
			inviteToken: MINTED_TOKEN
		});

		const { container } = render(Page);
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="invite-admin-submit"]'
			) as HTMLButtonElement | null;
			expect(submit && !submit.disabled).toBe(true);
		});
		await submitForm(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-result"]')).not.toBeNull();
		});

		const isoExpiry = new Intl.DateTimeFormat('en-CA', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date(4_102_444_800_000));
		expect(isoExpiry).toMatch(/^\d{4}-\d{2}-\d{2}$/); // oracle self-check
		const warning = container.querySelector('[data-testid="invite-bearer-warning"]');
		expect(warning?.textContent).toContain(`Shown only once. Expires on ${isoExpiry}.`);
	});
});

describe('/admin/invite — create-error', () => {
	it('renders a generic localized error (not the raw thrown message); logs detail to console.error; with a personId attached, the orphaned-person warning — form values preserved for retry', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		createInviteMock.mockRejectedValue(
			new InviteCreateError('member create failed: 500', {
				phase: 'member-create',
				reason: 'http',
				personId: 'p1'
			})
		);

		const { container } = render(Page);
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="invite-admin-submit"]'
			) as HTMLButtonElement | null;
			expect(submit && !submit.disabled).toBe(true);
		});
		await submitForm(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-error"]')).not.toBeNull();
		});
		const errorBlock = container.querySelector('[data-testid="invite-admin-error"]')!;
		expect(errorBlock.textContent).toContain('Invite creation failed.');
		expect(errorBlock.textContent).not.toContain('member-create');
		expect(errorBlock.textContent).not.toContain('member create failed: 500');

		expect(consoleSpy).toHaveBeenCalled();
		const loggedArgs = consoleSpy.mock.calls.flat();
		const loggedDetail = loggedArgs.some(
			(arg) => arg instanceof Error && arg.message === 'member create failed: 500'
		);
		expect(loggedDetail).toBe(true);

		const partial = container.querySelector('[data-testid="invite-partial-failure"]');
		expect(partial).not.toBeNull();
		expect(partial!.textContent).toContain('p1');

		const select = container.querySelector('[data-testid="invite-db"]') as HTMLSelectElement;
		expect(select.value).toBe('sampledb');

		consoleSpy.mockRestore();
	});

	it('an error WITHOUT a personId (nothing created yet) shows the phased error but NO orphan warning', async () => {
		selectSampledb();
		loadOk();
		createInviteMock.mockRejectedValue(
			new InviteCreateError('person create failed: 403', { phase: 'person-create', reason: 'http' })
		);

		const { container } = render(Page);
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="invite-admin-submit"]'
			) as HTMLButtonElement | null;
			expect(submit && !submit.disabled).toBe(true);
		});
		await submitForm(container);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="invite-partial-failure"]')).toBeNull();
	});
});
