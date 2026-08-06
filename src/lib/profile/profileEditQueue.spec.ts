import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// T4.6/#26 — the honest-round-trip orchestrator (AC2). Mock applyProfileSave at its
// boundary; ProfileSaveError is defined INSIDE the mock so the queue's
// `instanceof ProfileSaveError` matches the instances these tests reject with (the
// same technique page.admin-invite.spec.ts uses for InviteCreateError). RED: the
// queue's `request` is a stub throwing 'not implemented'.

const h = vi.hoisted(() => {
	class ProfileSaveError extends Error {
		readonly createdProfileId?: string;
		constructor(message: string, createdProfileId?: string) {
			super(message);
			this.name = 'ProfileSaveError';
			this.createdProfileId = createdProfileId;
		}
	}
	return { ProfileSaveError, applyProfileSaveMock: vi.fn() };
});
vi.mock('./applyProfileSave', () => ({
	applyProfileSave: h.applyProfileSaveMock,
	ProfileSaveError: h.ProfileSaveError
}));

import { createProfileEditQueue } from './profileEditQueue';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };
const fields = { name: 'Ada', email: 'ada@example.com' };

/** A promise whose settlement the test controls — "the write is still in flight". */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function makeCallbacks() {
	return {
		setPending: vi.fn(),
		reconcile: vi.fn(),
		recordCreatedId: vi.fn(),
		markFailed: vi.fn()
	};
}

beforeEach(() => {
	h.applyProfileSaveMock.mockReset();
});

// ── AC2 — no "ready"/"saved" state without a SERVER CONFIRMATION ────────────────

describe('createProfileEditQueue — AC2: "saved" flips ONLY after the server confirms', () => {
	it('marks the level pending synchronously on dispatch and does NOT reconcile before the write resolves', () => {
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });

		// pending is on immediately (the control disables) …
		expect(cb.setPending).toHaveBeenCalledWith('public', true);
		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1);
		// … but NOTHING has reached "saved" — the write has not resolved yet.
		expect(cb.reconcile).not.toHaveBeenCalled();
		expect(cb.setPending).not.toHaveBeenCalledWith('public', false);
	});

	it('on success: clears pending and reconciles with the SERVER-returned id (a first save gets its real _id, never a placeholder)', async () => {
		h.applyProfileSaveMock.mockResolvedValueOnce({ profileId: 'server-real-1' });
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });

		await vi.waitFor(() => expect(cb.setPending).toHaveBeenLastCalledWith('public', false));
		expect(cb.reconcile).toHaveBeenCalledWith('public', 'server-real-1', fields);
		expect(cb.markFailed).not.toHaveBeenCalled();
	});

	it('dispatches applyProfileSave with the level + existingId + fields the caller passed', () => {
		h.applyProfileSaveMock.mockReturnValueOnce(deferred().promise);
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'domain', existingId: 'prof-dom', fields });

		expect(h.applyProfileSaveMock).toHaveBeenCalledWith(
			expect.objectContaining({ cfg, personId: 'person-p', level: 'domain', existingId: 'prof-dom', fields })
		);
	});
});

// ── Fail-loud — a rejected write surfaces + never leaves a stuck-pending ─────────

describe('createProfileEditQueue — a failed write fails loud, never stuck-pending', () => {
	it('on a plain failure: clears pending, marks the level failed, and does NOT reconcile', async () => {
		h.applyProfileSaveMock.mockRejectedValueOnce(new Error('save failed: 500'));
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });

		await vi.waitFor(() => expect(cb.markFailed).toHaveBeenCalledWith('public'));
		expect(cb.setPending).toHaveBeenLastCalledWith('public', false); // re-enabled, retryable — not stuck
		expect(cb.reconcile).not.toHaveBeenCalled();
		expect(cb.recordCreatedId).not.toHaveBeenCalled();
	});

	it('on a PARTIAL failure (shell created, fields not): records the created id AND marks failed, so a retry updates the shell', async () => {
		h.applyProfileSaveMock.mockRejectedValueOnce(new h.ProfileSaveError('field save failed after create', 'shell-77'));
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'private', existingId: null, fields });

		await vi.waitFor(() => expect(cb.markFailed).toHaveBeenCalledWith('private'));
		expect(cb.recordCreatedId).toHaveBeenCalledWith('private', 'shell-77');
		expect(cb.reconcile).not.toHaveBeenCalled();
		expect(cb.setPending).toHaveBeenLastCalledWith('private', false);
	});
});

// ── Concurrent-save backstop (the #15 double-tap lesson) ────────────────────────

describe('createProfileEditQueue — concurrent-save backstop', () => {
	it('a second request for the SAME level while its write is in flight is a no-op — only one applyProfileSave fires', () => {
		h.applyProfileSaveMock.mockReturnValueOnce(deferred().promise);
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields }); // ignored — public pending

		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1);
	});

	it('reset() releases an in-flight level so a fresh same-level save fires while the stale write is STILL pending (the collective-switch race)', () => {
		// A slow first save is STILL in flight (never resolves) …
		h.applyProfileSaveMock.mockReturnValueOnce(new Promise(() => {}));
		h.applyProfileSaveMock.mockReturnValueOnce(new Promise(() => {}));
		const cb = makeCallbacks();
		let generation = 0;
		const queue = createProfileEditQueue(cb, () => generation);

		queue.request({ cfg, personId: 'person-a', level: 'public', existingId: null, fields });
		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1);

		// The member switches collective: the page bumps generation and resets the queue.
		generation = 1;
		queue.reset();

		// A fresh same-level save in the new collective MUST fire — without reset() the
		// backstop would swallow it silently (no pending, no error, no Saved) until the
		// stale request happened to settle.
		queue.request({ cfg, personId: 'person-b', level: 'public', existingId: null, fields });
		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(2);
		expect(cb.setPending).toHaveBeenLastCalledWith('public', true);
	});

	it('after a write settles, the SAME level can be saved again — a fresh write fires (re-enabled, not stuck)', async () => {
		h.applyProfileSaveMock.mockResolvedValueOnce({ profileId: 'server-real-1' });
		h.applyProfileSaveMock.mockResolvedValueOnce({ profileId: 'server-real-1' });
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		await vi.waitFor(() => expect(cb.setPending).toHaveBeenLastCalledWith('public', false));

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: 'server-real-1', fields });
		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(2);
	});
});

// ── Per-level isolation (a failure on one level never touches another) ──────────

describe('createProfileEditQueue — per-level isolation', () => {
	it('each level fires its own write; one busy level never blocks another', () => {
		h.applyProfileSaveMock.mockReturnValue(new Promise(() => {})); // never resolves
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		queue.request({ cfg, personId: 'person-p', level: 'domain', existingId: null, fields });

		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(2);
		expect(cb.setPending).toHaveBeenCalledWith('public', true);
		expect(cb.setPending).toHaveBeenCalledWith('domain', true);
	});

	it('a failing public write marks/clears ONLY public — a concurrent, still-pending domain write is untouched', async () => {
		h.applyProfileSaveMock.mockImplementationOnce(() => Promise.reject(new Error('500'))); // public fails
		h.applyProfileSaveMock.mockReturnValueOnce(new Promise(() => {})); // domain still pending
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => 0);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		queue.request({ cfg, personId: 'person-p', level: 'domain', existingId: null, fields });

		await vi.waitFor(() => expect(cb.markFailed).toHaveBeenCalledWith('public'));
		expect(cb.markFailed).not.toHaveBeenCalledWith('domain');
		expect(cb.setPending).not.toHaveBeenCalledWith('domain', false); // domain stays pending
	});
});

// ── Generation guard (the YELLOW-RSVP.1 residual — RSVP guarded only reads) ─────
// If the collective/context changes between dispatch and settle, the stale settle
// must NOT touch the UI (no cross-collective display bleed) — but MUST still free
// the pending slot so a fresh same-level save can proceed.

describe('createProfileEditQueue — generation guard on the write settle', () => {
	it('a SUCCESS that settles after the generation changed does NOT reconcile/setPending(false)/markFailed', async () => {
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		let generation = 0;
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => generation);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		generation = 1; // collective switched while the write was in flight
		d.resolve({ profileId: 'server-real-1' });

		// Give the .then a tick to run.
		await Promise.resolve();
		await Promise.resolve();

		expect(cb.reconcile).not.toHaveBeenCalled();
		expect(cb.setPending).not.toHaveBeenCalledWith('public', false);
		expect(cb.markFailed).not.toHaveBeenCalled();
	});

	it('a FAILURE that settles after the generation changed does NOT markFailed/setPending(false)', async () => {
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		let generation = 0;
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => generation);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		generation = 1;
		d.reject(new Error('500'));

		await Promise.resolve();
		await Promise.resolve();

		expect(cb.markFailed).not.toHaveBeenCalled();
		expect(cb.setPending).not.toHaveBeenCalledWith('public', false);
	});

	it('the stale settle STILL frees the pending slot — a fresh same-level save proceeds (never permanently stuck)', async () => {
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		h.applyProfileSaveMock.mockReturnValueOnce(new Promise(() => {}));
		let generation = 0;
		const cb = makeCallbacks();
		const queue = createProfileEditQueue(cb, () => generation);

		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		generation = 1;
		d.resolve({ profileId: 'server-real-1' });
		await Promise.resolve();
		await Promise.resolve();

		// A fresh save into the same level under the new generation must fire — proof
		// the pending slot was released despite the guarded (no-op) settle.
		queue.request({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });
		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(2);
	});
});
