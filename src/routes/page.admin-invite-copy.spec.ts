// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		admin_invite_title: () => 'Invite a new member',
		admin_invite_no_collective: () => 'Select a collective before creating invites.',
		admin_invite_no_access: () => 'Creating invites requires administrator rights.',
		admin_invite_load_error: () => 'Could not load invite prerequisites.',
		admin_invite_retry_load: () => 'Retry',
		admin_invite_db_label: () => 'Collective',
		admin_invite_submit: () => 'Create invite',
		admin_invite_creating: () => 'Creating…',
		admin_invite_link_label: () => '[admin_invite_link_label]',
		admin_invite_copy: () => '[admin_invite_copy]',
		admin_invite_copied: () => '[admin_invite_copied]',
		admin_invite_copy_error: () => '[admin_invite_copy_error]',
		admin_invite_create_another: () => '[admin_invite_create_another]',
		admin_invite_bearer_warning: () => 'Bearer secret — send only to the invited person.',
		admin_invite_show_once: (p: { date: string }) => `Shown only once. Expires on ${p.date}.`,
		admin_invite_error: () => 'Invite creation failed.',
		admin_invite_partial_failure: (p: { personId: string }) =>
			`A person entity (${p.personId}) was already created and carries a live invite token.`
	})
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
import { goto } from '$app/navigation';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	createInviteMock,
	resolveInviteParentMock,
	resolveParentMock
} from '$lib/testing/mocks/admin';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}
const MINTED_TOKEN = jwt({ db: 'sampledb', entityId: 'p1', iat: 1, exp: 4_102_444_800 });

function selectSampledb(): void {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

function q<T extends HTMLElement = HTMLElement>(container: HTMLElement, testid: string): T | null {
	return container.querySelector<T>(`[data-testid="${testid}"]`);
}

async function renderDone(): Promise<{ container: HTMLElement }> {
	selectSampledb();
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
	createInviteMock.mockResolvedValue({
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

function expectNoInviteMaterial(container: HTMLElement): void {
	expect(container.textContent).not.toContain(MINTED_TOKEN);
	expect(container.textContent).not.toContain('/invite/');
	expect(container.innerHTML).not.toContain(MINTED_TOKEN);
	for (const el of Array.from(
		container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
	)) {
		expect(el.value).not.toContain(MINTED_TOKEN);
		expect(el.value).not.toContain('/invite/');
	}
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

function flush(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
	resolveParentMock.mockReset();
	resolveInviteParentMock.mockReset();
	createInviteMock.mockReset();
	vi.mocked(goto).mockReset();
});

afterEach(() => {
	cleanup();
	if (originalClipboardDesc) {
		Object.defineProperty(navigator, 'clipboard', originalClipboardDesc);
	} else {
		Reflect.deleteProperty(navigator, 'clipboard');
	}
	resetAppState();
});

describe('#360 the invite URL/token never reaches the DOM — any state', () => {
	it('after mount (done panel): NO invite-link input, no URL/token anywhere; label + bearer warning stay', async () => {
		const { container } = await renderDone();

		expect(q(container, 'invite-link')).toBeNull();
		expectNoInviteMaterial(container);

		expect(container.textContent).toContain('[admin_invite_link_label]');
		const warning = q(container, 'invite-bearer-warning');
		expect(warning).not.toBeNull();
		expect(warning!.textContent).toContain('Bearer secret');
	});

	it('after a copy SUCCESS: still nothing rendered — the clipboard is the only egress', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		await flush();

		expect(q(container, 'invite-link')).toBeNull();
		expectNoInviteMaterial(container);
	});

	it('after a copy FAILURE: no reveal-on-failure — the secret stays off screen at the exact moment it must', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderDone();
		setClipboard(undefined);

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);
		await waitFor(() => {
			expect(container.querySelector('[role="alert"]')).not.toBeNull();
		});

		expect(q(container, 'invite-link')).toBeNull();
		expectNoInviteMaterial(container);
		consoleSpy.mockRestore();
	});
});

describe('#360 the invite-copy button is the ONLY trigger — one implementation', () => {
	it('button click hands the ABSOLUTE invite URL to the clipboard exactly once', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		expect(writeText).toHaveBeenCalledWith(EXPECTED_URL());
	});

	it('two clicks → two identical clipboard payloads, nothing else', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);
		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(2);
		});
		expect(writeText.mock.calls[0]).toEqual([EXPECTED_URL()]);
		expect(writeText.mock.calls[1]).toEqual([EXPECTED_URL()]);
	});
});

describe('#360 invite-copy-status — persistent role="status" region survives the input removal', () => {
	it('is mounted from the FIRST render of the done panel: empty text, role="status", aria-live="polite", reserved min-height', async () => {
		const { container } = await renderDone();

		const status = q(container, 'invite-copy-status');
		expect(status, 'expected the persistent invite-copy-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		expect(status!.className).toMatch(/min-h-/);
	});

	it('BUTTON-click success → the region announces [admin_invite_copied] on the SAME node that rendered empty', async () => {
		const { container } = await renderDone();
		installWriteText();

		const statusAtRest = q(container, 'invite-copy-status');
		expect(statusAtRest).not.toBeNull();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		expect(q(container, 'invite-copy-status')).toBe(statusAtRest);
	});

	it('clears at the START of the next copy attempt (in-flight second copy → empty text, same node, no timer involved)', async () => {
		const { container } = await renderDone();
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		const statusAfterFirst = q(container, 'invite-copy-status');

		writeText.mockReturnValue(new Promise(() => {}));
		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe('');
		});
		expect(q(container, 'invite-copy-status')).toBe(statusAfterFirst);
	});

	it('"create another" resets: the NEXT done panel starts with an empty status region (mint-site resets hold)', async () => {
		const { container } = await renderDone();
		installWriteText();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});

		const createAnother = Array.from(container.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('[admin_invite_create_another]')
		);
		expect(createAnother, 'expected the create-another button').not.toBeUndefined();
		await fireEvent.click(createAnother as HTMLButtonElement);

		await waitFor(() => {
			const submit = q<HTMLButtonElement>(container, 'invite-admin-submit');
			expect(submit && !submit.disabled).toBe(true);
		});
		await fireEvent.click(q(container, 'invite-admin-submit') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		const status = q(container, 'invite-copy-status');
		expect(status).not.toBeNull();
		expect(status!.textContent?.trim()).toBe('');
	});
});

describe('#360 the copy button stays a real, static-labelled control', () => {
	it('after a successful copy the button still reads [admin_invite_copy] — the confirmation lives in the status region', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		const button = q<HTMLButtonElement>(container, 'invite-copy') as HTMLButtonElement;
		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');

		await fireEvent.click(button);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		await flush();

		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');
		expect(button.textContent).not.toContain('[admin_invite_copied]');
	});

	it('the button is a native, focusable, CLASSED button (the #335 guard) and its click copies', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		const button = q<HTMLButtonElement>(container, 'invite-copy') as HTMLButtonElement;
		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('type')).toBe('button');
		expect(button.disabled).toBe(false);
		expect(button.className.trim()).not.toBe('');
		expect(button.className).toContain('border');
		expect(button.tabIndex).toBeGreaterThanOrEqual(0);
		button.focus();
		expect(document.activeElement).toBe(button);

		await fireEvent.click(button);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		expect(writeText).toHaveBeenCalledWith(EXPECTED_URL());
	});
});

describe('#360 clipboard ABSENT — the failure is visible and names the recourse (Gama sharpening)', () => {
	it('navigator.clipboard undefined: button click → a VISIBLE role="alert" rendering the admin_invite_copy_error key; status region stays empty; nothing revealed', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderDone();
		setClipboard(undefined);

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			const alert = container.querySelector('[role="alert"]');
			expect(alert, 'expected the copy-failed alert').not.toBeNull();
			expect(alert!.textContent).toContain('[admin_invite_copy_error]');
		});

		const status = q(container, 'invite-copy-status');
		expect(status).not.toBeNull();
		expect(status!.textContent?.trim()).toBe('');

		expectNoInviteMaterial(container);

		consoleSpy.mockRestore();
	});

	it('clipboard present but writeText missing: same visible failure, same silence everywhere else', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderDone();
		setClipboard({}); // the API object exists; writeText does not

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			const alert = container.querySelector('[role="alert"]');
			expect(alert).not.toBeNull();
			expect(alert!.textContent).toContain('[admin_invite_copy_error]');
		});
		expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe('');
		expectNoInviteMaterial(container);
		expect(goto).not.toHaveBeenCalled();

		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis* — #360 RED: copy-only admin surface — the input dies, the
