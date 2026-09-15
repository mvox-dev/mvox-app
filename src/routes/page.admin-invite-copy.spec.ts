// @vitest-environment happy-dom
//
// #360 RED — the invite link is never shown on screen: copy only. Contract
// (issue #360, Mihkel verbatim: "lets not show them on screen at no time —
// copy to clipboard is enough"; Gama's ruling: NO reveal-on-failure):
//
// - The readonly invite-link INPUT is GONE. The `invite-copy` button is the
//   ONLY affordance. The label and the bearer warning stay.
// - NO element renders the composed invite URL or the raw token — as text,
//   as a value, or in any attribute — in ANY state: after mount, after a
//   copy SUCCESS, after a copy FAILURE. (The no-reveal ruling as a test: a
//   reveal-on-failure would put the secret on screen at the exact moment the
//   user is most likely to photograph it for help.)
// - The persistent `role="status"` region (`invite-copy-status`) keeps the
//   #345 three-part shape: mounted from the first render of the done panel,
//   empty at rest, set on settle, cleared at the START of the next attempt,
//   never unmounted, reserved min-height, NO timer.
// - Clipboard ABSENT (Gama's sharpening, verbatim law: the replacement tests
//   "must assert OBSERVABLE behaviour — failure state visible, failure names
//   the re-send recourse — not merely that some text renders"): the failure
//   alert is VISIBLE (role="alert") and renders the `admin_invite_copy_error`
//   key — whose wording (pinned per-locale in page.admin-invite-copy-i18n
//   .spec.ts) names re-sending the invite as the recourse. There is NO
//   selection fallback any more: nothing on screen to select is the point.
// - DELETED with #360 (deliberate, not drift): the input-shape assertions
//   (tagName/readonly/classes/value), the input-click copy path, and the
//   selectionStart/selectionEnd manual-fallback assertions — all described an
//   element this commission removes. Their replacement coverage is the
//   observable failure behaviour above plus the no-reveal sweep
//   (no-rendered-invite-link.sweep.spec.ts).
//
// CLIPBOARD MOCK — unchanged idiom: per-property `Object.defineProperty` on
// the happy-dom navigator INSTANCE, restored from the captured original
// descriptor; never vi.stubGlobal('navigator').
//
// Renders the REAL route page (./admin/invite/+page.svelte), not the surface
// component in isolation — plain-admin tier, same as page.admin-invite.spec.ts.
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
		admin_invite_link_label: () => '[admin_invite_link_label]',
		// Key-echo mocks for the copy contract — assertions below pin WHICH key
		// renders WHERE (static button label vs. status region vs. alert).
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

// Same module-boundary mocks as page.admin-invite.spec.ts — the error class
// lives inside the hoisted block so `instanceof` checks match.
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
import { goto } from '$app/navigation';
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

/** Render the real route page and drive it to the done panel (copy-only). */
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

/** #360 — the no-reveal ruling as an assertion: neither the composed URL nor
 *  the raw token reaches the DOM — not as text, not as a control's value
 *  (Svelte sets values as properties, so innerHTML alone can miss them), not
 *  in any attribute (innerHTML covers those). */
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

// ── clipboard control (see block comment above for the mechanism choice) ──────
const originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

/** Install a controlled clipboard. `value` may be undefined (absent API),
 *  an object WITHOUT writeText, or a real `{ writeText }`. */
function setClipboard(value: unknown): void {
	Object.defineProperty(navigator, 'clipboard', {
		value,
		configurable: true,
		writable: true
	});
}

/** A resolving writeText spy, installed as the clipboard. */
function installWriteText(): ReturnType<typeof vi.fn> {
	const writeText = vi.fn().mockResolvedValue(undefined);
	setClipboard({ writeText });
	return writeText;
}

/** Let a settled copyLink() promise flush its state into the DOM. */
function flush(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
	h.resolveParentMock.mockReset();
	h.resolveInviteParentMock.mockReset();
	h.createInviteMock.mockReset();
	vi.mocked(goto).mockReset();
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

// ── #360 — never rendered, in any state ───────────────────────────────────────

describe('#360 the invite URL/token never reaches the DOM — any state', () => {
	it('after mount (done panel): NO invite-link input, no URL/token anywhere; label + bearer warning stay', async () => {
		const { container } = await renderDone();

		// The old readonly input is GONE — the button is the only affordance.
		expect(q(container, 'invite-link')).toBeNull();
		expectNoInviteMaterial(container);

		// Kept per the issue: the label and the bearer warning.
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

// ── one copy path, one affordance ─────────────────────────────────────────────

describe('#360 the invite-copy button is the ONLY trigger — one implementation', () => {
	it('button click hands the ABSOLUTE invite URL to the clipboard exactly once', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		// The composed URL exists ONLY as the clipboard payload now — never a
		// bare token, never rendered.
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

// ── the persistent status region (the #325 three-part shape, kept) ────────────

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
		// On the SAME node — never unmount/remount (a remounted live region is a
		// fresh node the screen reader never registered).
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

		// Second attempt NEVER settles — the clear must come from the attempt's
		// START (the copier's entry-point resets), not from success.
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

// ── the button: static label, the keyboard path, a real classed control ───────

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

// ── clipboard absent: OBSERVABLE failure, naming the re-send recourse ─────────

describe('#360 clipboard ABSENT — the failure is visible and names the recourse (Gama sharpening)', () => {
	it('navigator.clipboard undefined: button click → a VISIBLE role="alert" rendering the admin_invite_copy_error key; status region stays empty; nothing revealed', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderDone();
		setClipboard(undefined);

		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		// Observable failure state: the alert is visible and carries the key
		// whose wording (pinned in page.admin-invite-copy-i18n.spec.ts) names
		// re-sending the invite as the recourse — the ONLY recovery path now
		// that there is deliberately nothing on screen to select.
		await waitFor(() => {
			const alert = container.querySelector('[role="alert"]');
			expect(alert, 'expected the copy-failed alert').not.toBeNull();
			expect(alert!.textContent).toContain('[admin_invite_copy_error]');
		});

		// A failure is the alert's story — the status region says nothing.
		const status = q(container, 'invite-copy-status');
		expect(status).not.toBeNull();
		expect(status!.textContent?.trim()).toBe('');

		// And no reveal: the failure state renders NO invite material.
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
//  button is the sole affordance, absence asserted in every state, failure
//  observable via the reworded admin_invite_copy_error key)
