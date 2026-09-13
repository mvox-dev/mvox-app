// @vitest-environment happy-dom
//
// #345 RED — clicking the invite link copies it, and the confirmation moves
// off the button into a persistent status region. Contract (issue #345, Gama):
//
// - Clicking the readonly invite-link INPUT calls the SAME `copyLink()` the
//   button uses — one copy path, one set of failure semantics, never a second
//   implementation (pinned by clipboard call count + payload).
// - The confirmation leaves the button's label. It renders in a NEW persistent
//   `role="status"` region (`invite-copy-status`) — the #267/#323/#325/#326
//   idiom: mounted from the FIRST render of the done panel with empty text (a
//   live region must exist BEFORE its first announcement), text set on settle,
//   cleared at the start of the next attempt and by "create another", NO
//   timer, and the node is NEVER unmounted between states (same-node identity,
//   the #325 three-part shape). Reserved min-height so the announcement never
//   shifts layout (RsvpControl's `rsvp-saved-status` reserved-height pattern).
// - The BUTTON's label becomes STATIC (`admin_invite_copy`) — it never swaps
//   to `admin_invite_copied` again. The button stays a real, focusable button
//   (the keyboard path; the input click is mouse-only convenience on top of a
//   complete control) and its click still drives the same flow.
// - Clipboard ABSENT (non-secure context / writeText missing): the existing
//   `copyFailed` alert renders (role="alert", conditional mount KEPT), AND the
//   input's text is left SELECTED after the click — the manual fallback
//   (roster rename's `.select()` precedent). The status region stays empty on
//   failure — a failure is the alert's job, not the status region's.
// - The input keeps its classes / readonly / value, and clicking it navigates
//   nowhere (it is an <input>, not an anchor — nothing to navigate to).
//
// CLIPBOARD MOCK (none existed in the tree before this suite — stated choice):
// `Object.defineProperty(navigator, 'clipboard', ...)` on the happy-dom
// navigator INSTANCE, restored per-test from the captured original descriptor.
// NOT `vi.stubGlobal('navigator', ...)`: that replaces the WHOLE navigator
// object, stripping every other navigator API the rendered tree may touch —
// property-define is scoped to the one property and exactly reversible.
//
// Renders the REAL route page (./admin/invite/+page.svelte), not the surface
// component in isolation — plain-admin tier, same as page.admin-invite.spec.ts
// (the person-select owner gate is orthogonal to copying and stays out).
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

/** Render the real route page and drive it to the done panel (show-once link). */
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

// ── one copy path ─────────────────────────────────────────────────────────────

describe('#345 clicking the invite link copies it — same copyLink path', () => {
	it('clicking the readonly invite-link input hands the ABSOLUTE invite URL to the clipboard exactly once', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		const input = q<HTMLInputElement>(container, 'invite-link') as HTMLInputElement;
		expect(input.value).toBe(EXPECTED_URL()); // absolute URL, never a bare token
		await fireEvent.click(input);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		// The payload is the SAME absolute URL the input shows — the existing
		// copyLink() reads `inviteLink`; a second implementation reading anything
		// else (input.value at click time, a re-built URL) has no seam here.
		expect(writeText).toHaveBeenCalledWith(EXPECTED_URL());
	});

	it('input click and button click drive ONE implementation: two triggers → two identical clipboard payloads, nothing else', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		await fireEvent.click(q(container, 'invite-link') as HTMLElement);
		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(2);
		});
		expect(writeText.mock.calls[0]).toEqual([EXPECTED_URL()]);
		expect(writeText.mock.calls[1]).toEqual([EXPECTED_URL()]);
	});
});

// ── the persistent status region (the #325 three-part shape) ──────────────────

describe('#345 invite-copy-status — persistent role="status" region', () => {
	it('is mounted from the FIRST render of the done panel: empty text, role="status", aria-live="polite", reserved min-height', async () => {
		const { container } = await renderDone();

		// Part 1 of the three-part shape: present at rest, BEFORE any copy — a
		// live region must exist before its first announcement to be picked up.
		const status = q(container, 'invite-copy-status');
		expect(status, 'expected the persistent invite-copy-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');
		// Reserved height (RsvpControl's rsvp-saved-status pattern) so the
		// announcement appearing/clearing never shifts the layout.
		expect(status!.className).toMatch(/min-h-/);
	});

	it('INPUT-click success → the region announces [admin_invite_copied] on the SAME node that rendered empty', async () => {
		const { container } = await renderDone();
		installWriteText();

		const statusAtRest = q(container, 'invite-copy-status');
		expect(statusAtRest).not.toBeNull();

		await fireEvent.click(q(container, 'invite-link') as HTMLElement);

		// Part 2: text set on settle …
		await waitFor(() => {
			expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		// … part 3: on the SAME node — never unmount/remount (a remounted live
		// region is a fresh node the screen reader never registered).
		expect(q(container, 'invite-copy-status')).toBe(statusAtRest);
	});

	it('BUTTON-click success → the region announces too (whichever trigger was used)', async () => {
		const { container } = await renderDone();
		installWriteText();

		const statusAtRest = q(container, 'invite-copy-status');
		await fireEvent.click(q(container, 'invite-copy') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		expect(q(container, 'invite-copy-status')).toBe(statusAtRest);
	});

	it('clears at the START of the next copy attempt (in-flight second copy → empty text, same node still mounted, no timer involved)', async () => {
		const { container } = await renderDone();
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboard({ writeText });

		await fireEvent.click(q(container, 'invite-link') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe(
				'[admin_invite_copied]'
			);
		});
		const statusAfterFirst = q(container, 'invite-copy-status');

		// Second attempt NEVER settles — the clear must come from the attempt's
		// START (copyLink's existing entry-point resets), not from success.
		writeText.mockReturnValue(new Promise(() => {}));
		await fireEvent.click(q(container, 'invite-link') as HTMLElement);

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

		// Back on the form → mint again → the fresh done panel's region is EMPTY
		// (createAnother + the mint-site resets both clear the copied state).
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

// ── the button: static label, still the keyboard path ─────────────────────────

describe('#345 the copy button label is STATIC — the confirmation no longer lives on it', () => {
	it('after a successful copy the button still reads [admin_invite_copy] — it never swaps to [admin_invite_copied]', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		const button = q<HTMLButtonElement>(container, 'invite-copy') as HTMLButtonElement;
		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');

		await fireEvent.click(button);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		await flush(); // let the settled copy state reach the DOM before asserting

		// The core of #345: the user may have acted on the INPUT — a label swap
		// on an element they did not touch is not an announcement. The cue moved
		// to the status region; the label holds still.
		expect(button.textContent?.trim()).toBe('[admin_invite_copy]');
		expect(button.textContent).not.toContain('[admin_invite_copied]');
	});

	it('the button remains a real, focusable button and its click still copies (the keyboard path is intact)', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		const button = q<HTMLButtonElement>(container, 'invite-copy') as HTMLButtonElement;
		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('type')).toBe('button');
		expect(button.disabled).toBe(false);
		// Focusable — a keyboard user reaches it without touching the input.
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

// ── clipboard absent: fail visibly + leave the text selected ──────────────────

describe('#345 clipboard ABSENT — the alert stays, the click selects the text', () => {
	it('navigator.clipboard undefined: input click → [admin_invite_copy_error] alert + the full link text SELECTED; status region stays empty', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderDone();
		setClipboard(undefined);

		const input = q<HTMLInputElement>(container, 'invite-link') as HTMLInputElement;
		expect(input.value.length).toBeGreaterThan(0);
		await fireEvent.click(input);

		// The existing failure surface, KEPT as a conditional-mount alert (an
		// alert announces on insertion — right for a failure).
		await waitFor(() => {
			const alert = container.querySelector('[role="alert"]');
			expect(alert, 'expected the copy-failed alert').not.toBeNull();
			expect(alert!.textContent).toContain('[admin_invite_copy_error]');
		});

		// The manual fallback (roster rename's .select() precedent): the click
		// leaves the whole link selected, so Ctrl/Cmd-C is one keystroke away
		// exactly where the automatic path fails by design.
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);

		// A failure is the alert's story — the status region says nothing.
		const status = q(container, 'invite-copy-status');
		expect(status).not.toBeNull();
		expect(status!.textContent?.trim()).toBe('');

		consoleSpy.mockRestore();
	});

	it('clipboard present but writeText missing: same visible failure + selection on input click', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { container } = await renderDone();
		setClipboard({}); // the API object exists; writeText does not

		const input = q<HTMLInputElement>(container, 'invite-link') as HTMLInputElement;
		await fireEvent.click(input);

		await waitFor(() => {
			const alert = container.querySelector('[role="alert"]');
			expect(alert).not.toBeNull();
			expect(alert!.textContent).toContain('[admin_invite_copy_error]');
		});
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
		expect(q(container, 'invite-copy-status')?.textContent?.trim()).toBe('');

		consoleSpy.mockRestore();
	});
});

// ── input hygiene: still the same readonly input, nowhere to navigate ─────────

describe('#345 the input stays what it was — plus hygiene', () => {
	it('after a copy-click the input keeps its classes, readonly and value; no navigation happened', async () => {
		const { container } = await renderDone();
		const writeText = installWriteText();

		const input = q<HTMLInputElement>(container, 'invite-link') as HTMLInputElement;
		const valueBefore = input.value;

		await fireEvent.click(input);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledTimes(1);
		});
		await flush();

		// Unclassed-controls guard: the input keeps today's styling tokens (a
		// token-presence pin, not byte-equality — GREEN may ADD e.g. a cursor
		// affordance, but stripping the control bare is a regression).
		for (const token of ['rounded-md', 'border', 'border-ink', 'px-3', 'py-2', 'font-mono']) {
			expect(input.className).toContain(token);
		}
		expect(input.readOnly).toBe(true);
		expect(input.value).toBe(valueBefore);

		// Nothing to navigate to: it is an input, not an anchor — the click must
		// not have grown a link wrapper or fired a route change.
		expect(input.closest('a')).toBeNull();
		expect(input.hasAttribute('href')).toBe(false);
		expect(goto).not.toHaveBeenCalled();
	});
});
