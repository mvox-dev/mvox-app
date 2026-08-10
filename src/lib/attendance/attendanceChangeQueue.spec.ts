import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { EventAttendance } from './attendanceData';

// #84 TA.3 — the attendance optimistic queue. Mirrors rsvpChangeQueue
// EXACTLY, with the pending key changed from eventId to a composite
// eventId:memberId key: the conductor's panel shows one P/A/L toggle row per
// member for ONE event, so the unit of "a write in flight" is the member row
// WITHIN that event — the conductor can switch between events (unlike RSVP,
// which is per-person with one surface at a time), so the event must be part
// of the key. Per-tap immediate writes — every request() fires exactly one
// applyAttendanceChange round-trip; nothing batches.
//
// The #15 lesson carries over verbatim: the primary double-tap guard is the UI
// disabling the member's toggle row while pending (via setPending); the queue's
// own per-(event,member) guard is a defensive backstop. All callbacks are
// PER-MEMBER (scoped by eventId) — there is no whole-map operation in this API
// for a caller to misuse, so one member's failure structurally cannot clobber
// another member's in-flight state.
//
// #77 fix-forward (cross-event bleed, be08583/debe746 root-cause-persists) —
// callbacks now receive eventId as their first argument so the CALLER (the
// page) can validate a settling write against whichever event is CURRENTLY
// open, evaluated fresh at callback-fire time — not against a shared mutable
// "generation" variable that gets re-synced on every open (which made the
// comparison always pass). The pending Set is keyed by `${eventId}:${memberId}`
// composite, not memberId alone — this is what makes reopening the SAME event
// correctly preserve in-flight pending state (no reset() escape hatch needed)
// while a DIFFERENT event never blocks on a busy member from a prior event.

const { applyAttendanceChangeMock } = vi.hoisted(() => ({ applyAttendanceChangeMock: vi.fn() }));
vi.mock('./attendanceOptimistic', () => ({ applyAttendanceChange: applyAttendanceChangeMock }));

import { createAttendanceChangeQueue } from './attendanceChangeQueue';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

/** A promise the test controls the settlement of — simulates "the write is still in flight". */
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
		setOptimistic: vi.fn(),
		setPending: vi.fn(),
		reconcile: vi.fn(),
		revert: vi.fn()
	};
}

beforeEach(() => {
	applyAttendanceChangeMock.mockReset();
});

describe('createAttendanceChangeQueue — a single tap, start to finish', () => {
	it('marks the member pending and sets the optimistic value BEFORE the write resolves', () => {
		const d = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });

		expect(cb.setPending).toHaveBeenCalledWith('e1', 'm1', true);
		expect(cb.setOptimistic).toHaveBeenCalledWith(
			'e1',
			'm1',
			expect.objectContaining({ status: 'present' })
		);
		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1);
	});

	it('fires ONE write per tap, immediately — per-tap semantics, no batching/coalescing window', () => {
		applyAttendanceChangeMock.mockReturnValue(new Promise(() => {}));
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });

		// The write fired synchronously with the tap — nothing waits for a flush/save.
		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1);
		expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' })
		);
	});

	it('on success: unmarks pending (re-enables the row) and reconciles with the resolved attendanceId', async () => {
		applyAttendanceChangeMock.mockResolvedValueOnce({ attendanceId: 'real-1' });
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });

		await vi.waitFor(() => {
			expect(cb.setPending).toHaveBeenLastCalledWith('e1', 'm1', false);
		});
		expect(cb.reconcile).toHaveBeenCalledWith('e1', 'm1', { attendanceId: 'real-1', status: 'present' });
	});

	it('on failure: unmarks pending (re-enables the row) and reverts ONLY this member to its pre-tap value', async () => {
		applyAttendanceChangeMock.mockRejectedValueOnce(new Error('403'));
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);
		const before: EventAttendance = { attendanceId: 'att-1', memberId: 'm1', status: 'present' };

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: before, newStatus: 'absent' });

		await vi.waitFor(() => {
			expect(cb.setPending).toHaveBeenLastCalledWith('e1', 'm1', false);
		});
		expect(cb.revert).toHaveBeenCalledWith('e1', 'm1', { attendanceId: 'att-1', status: 'present' });
	});

	it('newStatus null (tap active to clear) → optimistic null and reconcile null — the delete path', async () => {
		applyAttendanceChangeMock.mockResolvedValueOnce({ attendanceId: null });
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);
		const existing: EventAttendance = { attendanceId: 'att-1', memberId: 'm1', status: 'present' };

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing, newStatus: null });

		expect(cb.setOptimistic).toHaveBeenCalledWith('e1', 'm1', null);
		await vi.waitFor(() => {
			expect(cb.setPending).toHaveBeenLastCalledWith('e1', 'm1', false);
		});
		expect(cb.reconcile).toHaveBeenCalledWith('e1', 'm1', null);
	});

	it('after a write settles, the SAME member can be tapped again — a fresh request fires a new write (re-enabled, not stuck)', async () => {
		applyAttendanceChangeMock.mockResolvedValueOnce({ attendanceId: 'real-1' });
		applyAttendanceChangeMock.mockResolvedValueOnce({ attendanceId: 'real-1' });
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });
		await vi.waitFor(() => expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(cb.setPending).toHaveBeenLastCalledWith('e1', 'm1', false));

		const existing: EventAttendance = { attendanceId: 'real-1', memberId: 'm1', status: 'present' };
		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing, newStatus: 'late' });

		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(2);
		expect(cb.setPending).toHaveBeenCalledWith('e1', 'm1', true); // pending again for the new write
	});
});

describe('createAttendanceChangeQueue — per-member defensive backstop: a request while already pending', () => {
	it('a second request for the SAME event+member while pending is a no-op — no second write fires (the disabled row is the primary guard; this is belt-and-braces)', () => {
		const d = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });
		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'absent' }); // ignored — e1:m1 is pending

		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1); // still just the first write
	});

	it('the no-op does not re-fire setOptimistic or setPending — a genuine no-op, not a silent second update', () => {
		const d = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });
		cb.setOptimistic.mockClear();
		cb.setPending.mockClear();

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'absent' });

		expect(cb.setOptimistic).not.toHaveBeenCalled();
		expect(cb.setPending).not.toHaveBeenCalled();
	});
});

describe('createAttendanceChangeQueue — two DIFFERENT members tapped concurrently', () => {
	it('each member fires its own write immediately — independent pending state, one busy member never blocks another (the roll-call flow: conductor taps down the list faster than writes settle)', () => {
		applyAttendanceChangeMock.mockReturnValue(new Promise(() => {})); // never resolves; only call count/args matter
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });
		queue.request({ cfg, eventId: 'e1', memberId: 'm2', existing: null, newStatus: 'absent' });

		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(2);
		expect(cb.setPending).toHaveBeenCalledWith('e1', 'm1', true);
		expect(cb.setPending).toHaveBeenCalledWith('e1', 'm2', true);
	});

	it('a failed write on one member reverts + re-enables ONLY that member — a concurrent, still-pending member is untouched (the #15 clobber, per-member edition)', async () => {
		const dOther = deferred<{ attendanceId: string | null }>(); // m2's write never resolves in this test
		applyAttendanceChangeMock.mockImplementationOnce(() => Promise.reject(new Error('403'))); // m1 fails
		applyAttendanceChangeMock.mockReturnValueOnce(dOther.promise); // m2 still pending

		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });
		queue.request({ cfg, eventId: 'e1', memberId: 'm2', existing: null, newStatus: 'absent' });

		await vi.waitFor(() => {
			expect(cb.revert).toHaveBeenCalledTimes(1);
		});
		expect(cb.revert).toHaveBeenCalledWith('e1', 'm1', null);
		expect(cb.revert).not.toHaveBeenCalledWith('e1', 'm2', expect.anything());
		// m2 must STILL be pending — a whole-map/whole-state operation triggered by
		// m1's failure would have no way to leave m2 alone; this API structurally can't.
		expect(cb.setPending).not.toHaveBeenCalledWith('e1', 'm2', false);
	});
});

describe('createAttendanceChangeQueue — composite eventId:memberId key (#77 fix-forward: cross-event bleed + duplicate writes)', () => {
	it('the SAME member id in a DIFFERENT event is never blocked by a write in flight for the prior event — no reset() escape hatch needed', () => {
		applyAttendanceChangeMock.mockReturnValue(new Promise(() => {})); // e1:m1's write never settles
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });
		queue.request({ cfg, eventId: 'e2', memberId: 'm1', existing: null, newStatus: 'absent' }); // different event — must fire

		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(2);
		expect(cb.setPending).toHaveBeenCalledWith('e1', 'm1', true);
		expect(cb.setPending).toHaveBeenCalledWith('e2', 'm1', true);
	});

	it('reopening the SAME event does not clear in-flight pending state — a duplicate tap on the same event+member while pending is still a no-op (#77 root cause: reset() used to wipe this)', () => {
		const d = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValueOnce(d.promise); // e1:m1 never settles in this test
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });
		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1);

		// Simulate the panel closing and reopening on the SAME event while the
		// write above is still in flight — there is no reset() to call anymore;
		// the queue has no whole-state operation for a caller to misuse.
		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'absent' });

		expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1); // still just the first write — no duplicate
	});

	it('each settling write reports its OWN eventId to the callbacks — the caller can validate against whichever event is currently open', async () => {
		applyAttendanceChangeMock.mockResolvedValueOnce({ attendanceId: 'real-1' });
		const cb = makeCallbacks();
		const queue = createAttendanceChangeQueue(cb);

		queue.request({ cfg, eventId: 'e1', memberId: 'm1', existing: null, newStatus: 'present' });

		await vi.waitFor(() => {
			expect(cb.reconcile).toHaveBeenCalled();
		});
		expect(cb.reconcile).toHaveBeenCalledWith('e1', 'm1', { attendanceId: 'real-1', status: 'present' });
	});
});

// (*MVOX:Tallis*)
