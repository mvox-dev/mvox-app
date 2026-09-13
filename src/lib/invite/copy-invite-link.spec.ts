// @vitest-environment happy-dom
//
// #346 RED — the shared copy module. #345 landed ONE copy implementation
// inside InviteSurface (`copyLink()`, f501a78); #346 needs the SAME semantics
// on every roster row, so the behavior extracts to
// `createInviteLinkCopier(getText)` and BOTH surfaces ride it. This suite pins
// the module to exactly the semantics the #345 route suite pinned black-box —
// the parity claim is the point: nothing may drift in the extract.
//
// The contract (issue #346 "Done when", + #345's landed semantics):
// - copy() success → the clipboard receives getText()'s value, exactly once
//   per attempt; `copied` true, `copyFailed` false.
// - BOTH flags reset synchronously at copy() ENTRY — the caller's persistent
//   status region clears at the start of every attempt, with NO timer.
// - Absent `navigator.clipboard?.writeText` (non-secure context) fails
//   VISIBLY: `copyFailed` true — never a silent no-op — and no throw escapes.
// - A rejecting writeText is the same visible failure.
//
// CLIPBOARD MOCK — page.admin-invite-copy.spec.ts's pattern, verbatim:
// `Object.defineProperty` on the navigator INSTANCE per property, restored
// from the captured original descriptor. NOT vi.stubGlobal('navigator', ...).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInviteLinkCopier } from '$lib/invite/copy-invite-link';

// ── clipboard control ─────────────────────────────────────────────────────────
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

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	// The module may console.error on failure (InviteSurface's copyLink did);
	// keep the run quiet without pinning the log as contract.
	consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	consoleSpy.mockRestore();
	vi.useRealTimers();
	if (originalClipboardDesc) {
		Object.defineProperty(navigator, 'clipboard', originalClipboardDesc);
	} else {
		Reflect.deleteProperty(navigator, 'clipboard');
	}
});

// ── success path ──────────────────────────────────────────────────────────────

describe('#346 createInviteLinkCopier — success', () => {
	it("hands getText()'s value to the clipboard exactly once, then copied=true copyFailed=false", async () => {
		const writeText = installWriteText();
		const copier = createInviteLinkCopier(() => 'https://x.example/invite/tok-1');

		await copier.copy();

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText).toHaveBeenCalledWith('https://x.example/invite/tok-1');
		expect(copier.copied).toBe(true);
		expect(copier.copyFailed).toBe(false);
	});

	it('reads getText AT COPY TIME — a changed value copies the NEW text (never a creation-time snapshot)', async () => {
		const writeText = installWriteText();
		let text = 'https://x.example/invite/tok-old';
		const copier = createInviteLinkCopier(() => text);

		await copier.copy();
		text = 'https://x.example/invite/tok-new';
		await copier.copy();

		expect(writeText).toHaveBeenCalledTimes(2);
		expect(writeText.mock.calls[1]).toEqual(['https://x.example/invite/tok-new']);
		expect(copier.copied).toBe(true);
	});

	it('no timer: the copied flag PERSISTS — advancing every pending timer changes nothing', async () => {
		vi.useFakeTimers();
		installWriteText();
		const copier = createInviteLinkCopier(() => 'https://x.example/invite/tok-1');

		await copier.copy();
		expect(copier.copied).toBe(true);

		vi.runAllTimers();
		expect(copier.copied).toBe(true);
		expect(copier.copyFailed).toBe(false);
	});
});

// ── visible failure — never a silent no-op, never an escaping throw ───────────

describe('#346 createInviteLinkCopier — clipboard unavailable fails VISIBLY', () => {
	it('navigator.clipboard undefined: copy() resolves (no throw escapes), copyFailed=true copied=false', async () => {
		setClipboard(undefined);
		const copier = createInviteLinkCopier(() => 'https://x.example/invite/tok-1');

		await expect(copier.copy()).resolves.toBeUndefined();

		expect(copier.copyFailed).toBe(true);
		expect(copier.copied).toBe(false);
	});

	it('clipboard present but writeText missing: same visible failure, no throw escapes', async () => {
		setClipboard({}); // the API object exists; writeText does not
		const copier = createInviteLinkCopier(() => 'https://x.example/invite/tok-1');

		await expect(copier.copy()).resolves.toBeUndefined();

		expect(copier.copyFailed).toBe(true);
		expect(copier.copied).toBe(false);
	});

	it('a REJECTING writeText is the same visible failure — flag set, rejection swallowed', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError: denied'));
		setClipboard({ writeText });
		const copier = createInviteLinkCopier(() => 'https://x.example/invite/tok-1');

		await expect(copier.copy()).resolves.toBeUndefined();

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(copier.copyFailed).toBe(true);
		expect(copier.copied).toBe(false);
	});
});

// ── entry resets — the status region clears at the START of every attempt ─────

describe('#346 createInviteLinkCopier — both flags reset at copy() ENTRY', () => {
	it('after a FAILURE, the next attempt clears copyFailed synchronously at entry (held writeText — the clear cannot come from settle)', async () => {
		setClipboard(undefined);
		const copier = createInviteLinkCopier(() => 'https://x.example/invite/tok-1');
		await copier.copy();
		expect(copier.copyFailed).toBe(true);

		let release: () => void = () => {};
		const writeText = vi.fn().mockReturnValue(
			new Promise<void>((resolve) => {
				release = () => resolve();
			})
		);
		setClipboard({ writeText });

		const second = copier.copy();
		// Synchronous read, before the held writeText settles: entry reset.
		expect(copier.copyFailed).toBe(false);
		expect(copier.copied).toBe(false);

		release();
		await second;
		expect(copier.copied).toBe(true);
		expect(copier.copyFailed).toBe(false);
	});

	it('after a SUCCESS, a failing attempt clears copied at entry and settles copyFailed — prior success never lingers over a failure', async () => {
		installWriteText();
		const copier = createInviteLinkCopier(() => 'https://x.example/invite/tok-1');
		await copier.copy();
		expect(copier.copied).toBe(true);

		setClipboard(undefined);
		const second = copier.copy();
		expect(copier.copied).toBe(false); // entry reset, synchronous
		await second;

		expect(copier.copied).toBe(false);
		expect(copier.copyFailed).toBe(true);
	});
});

// (*MVOX:Tallis* — #346 RED: the shared copy module, pinned to #345's exact
//  landed semantics; clipboard-mock idiom from page.admin-invite-copy.spec.ts)
