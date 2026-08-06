import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyRsvp } from './rsvpData';

const { applyRsvpChangeMock } = vi.hoisted(() => ({ applyRsvpChangeMock: vi.fn() }));
vi.mock('./rsvpOptimistic', () => ({ applyRsvpChange: applyRsvpChangeMock }));

import { createRsvpChangeQueue } from './rsvpChangeQueue';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

/** A promise the test controls the settlement of — simulates "tap again before the write resolves". */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	applyRsvpChangeMock.mockReset();
});

describe('createRsvpChangeQueue — a single tap (no concurrency)', () => {
	it('calls setOptimistic synchronously, then applyRsvpChange exactly once', () => {
		const d = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d.promise);
		const setOptimistic = vi.fn();
		const queue = createRsvpChangeQueue({ setOptimistic, reconcile: vi.fn(), revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });

		expect(setOptimistic).toHaveBeenCalledWith('e1', expect.objectContaining({ status: 'going' }));
		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1);
	});

	it('on success, calls reconcile with the resolved rsvpId', async () => {
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: 'real-1' });
		const reconcile = vi.fn();
		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile, revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });

		await vi.waitFor(() => {
			expect(reconcile).toHaveBeenCalledWith('e1', { rsvpId: 'real-1', status: 'going' });
		});
	});

	it('on failure, calls revert(eventId, before) — per-event, not a whole-map operation', async () => {
		applyRsvpChangeMock.mockRejectedValueOnce(new Error('403'));
		const revert = vi.fn();
		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile: vi.fn(), revert });
		const before: MyRsvp = { rsvpId: 'rsvp-1', eventId: 'e1', status: 'going' };

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: before, newStatus: 'maybe' });

		await vi.waitFor(() => {
			expect(revert).toHaveBeenCalledWith('e1', { rsvpId: 'rsvp-1', status: 'going' });
		});
	});
});

describe('createRsvpChangeQueue — #15 double-tap on the SAME event (the bug)', () => {
	it('a second tap while the first is still in flight does NOT fire a second write — coalesced, not sent', () => {
		const d = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d.promise);
		const setOptimistic = vi.fn();
		const queue = createRsvpChangeQueue({ setOptimistic, reconcile: vi.fn(), revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'maybe' });

		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1); // still just the first write
		// but the visible state DOES update immediately for the second tap too
		expect(setOptimistic).toHaveBeenLastCalledWith('e1', expect.objectContaining({ status: 'maybe' }));
	});

	it('once the first write resolves, the coalesced tap fires automatically against the REAL id — never the __optimistic__ placeholder (the exact #15 regression)', async () => {
		const d1 = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d1.promise); // call #1: create, pending
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: 'r2' }); // call #2: coalesced update

		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile: vi.fn(), revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'maybe' });
		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1); // 2nd write not fired yet — still in flight

		d1.resolve({ rsvpId: 'created-1' }); // the create resolves — this is the real id
		await vi.waitFor(() => {
			expect(applyRsvpChangeMock).toHaveBeenCalledTimes(2);
		});

		const secondCallInput = applyRsvpChangeMock.mock.calls[1][0];
		expect(secondCallInput.existing).toEqual({ rsvpId: 'created-1', eventId: 'e1', status: 'going' });
		expect(secondCallInput.newStatus).toBe('maybe');
	});

	it('rapid triple-tap coalesces to the LAST status only — the middle tap is never separately written', async () => {
		const d1 = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d1.promise);
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: 'r2' });

		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile: vi.fn(), revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' }); // A
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'maybe' }); // B — superseded below
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'late' }); // C — the last tap

		d1.resolve({ rsvpId: 'created-1' });
		await vi.waitFor(() => {
			expect(applyRsvpChangeMock).toHaveBeenCalledTimes(2);
		});

		const secondCallInput = applyRsvpChangeMock.mock.calls[1][0];
		expect(secondCallInput.newStatus).toBe('late'); // NOT 'maybe' — B never survives to be written
	});

	it('once the coalesced write also resolves, reconcile reflects the truly final state', async () => {
		const d1 = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d1.promise);
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: 'created-1' }); // update keeps the same rsvpId

		const reconcile = vi.fn();
		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile, revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'maybe' });
		d1.resolve({ rsvpId: 'created-1' });

		await vi.waitFor(() => {
			expect(reconcile).toHaveBeenCalledWith('e1', { rsvpId: 'created-1', status: 'maybe' });
		});
	});

	it('a queued tap-active-to-clear (newStatus=null) coalesces the same as any other status', async () => {
		const d1 = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d1.promise);
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: null }); // delete → no id

		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile: vi.fn(), revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: null }); // tap-active immediately after

		d1.resolve({ rsvpId: 'created-1' });
		await vi.waitFor(() => {
			expect(applyRsvpChangeMock).toHaveBeenCalledTimes(2);
		});
		const secondCallInput = applyRsvpChangeMock.mock.calls[1][0];
		expect(secondCallInput.newStatus).toBeNull();
	});
});

describe('createRsvpChangeQueue — two DIFFERENT events tapped concurrently', () => {
	it('each event fires its own write immediately — independent in-flight state, not coalesced against each other', () => {
		applyRsvpChangeMock.mockReturnValue(new Promise(() => {})); // never resolves; only call count/args matter
		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile: vi.fn(), revert: vi.fn() });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e2', existing: null, newStatus: 'maybe' });

		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(2);
	});

	it('a failed write on one event reverts ONLY that event — a concurrent, still-pending event is untouched (the exact #15 clobber)', async () => {
		const dOther = deferred<{ rsvpId: string | null }>(); // e2's write never resolves in this test
		applyRsvpChangeMock.mockImplementationOnce(() => Promise.reject(new Error('403'))); // e1 fails
		applyRsvpChangeMock.mockReturnValueOnce(dOther.promise); // e2 still pending

		const revert = vi.fn();
		const queue = createRsvpChangeQueue({ setOptimistic: vi.fn(), reconcile: vi.fn(), revert });

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e2', existing: null, newStatus: 'maybe' });

		await vi.waitFor(() => {
			expect(revert).toHaveBeenCalledTimes(1);
		});
		expect(revert).toHaveBeenCalledWith('e1', null);
		// e2's write is still genuinely in flight — nothing has resolved it, and revert
		// was never called for it. A whole-map revert (the #15 bug) would have no way
		// to express "only e1", by construction this API can't either.
		expect(revert).not.toHaveBeenCalledWith('e2', expect.anything());
	});
});

// (*MVOX:Tallis*)
