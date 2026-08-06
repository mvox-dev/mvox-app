import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyRsvp } from './rsvpData';

const { applyRsvpChangeMock } = vi.hoisted(() => ({ applyRsvpChangeMock: vi.fn() }));
vi.mock('./rsvpOptimistic', () => ({ applyRsvpChange: applyRsvpChangeMock }));

import { createRsvpChangeQueue } from './rsvpChangeQueue';

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
	applyRsvpChangeMock.mockReset();
});

describe('createRsvpChangeQueue — a single tap, start to finish', () => {
	it('marks the event pending and sets the optimistic value BEFORE the write resolves', () => {
		const d = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });

		expect(cb.setPending).toHaveBeenCalledWith('e1', true);
		expect(cb.setOptimistic).toHaveBeenCalledWith('e1', expect.objectContaining({ status: 'going' }));
		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1);
	});

	it('on success: unmarks pending (re-enables the control) and reconciles with the resolved rsvpId', async () => {
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: 'real-1' });
		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });

		await vi.waitFor(() => {
			expect(cb.setPending).toHaveBeenLastCalledWith('e1', false);
		});
		expect(cb.reconcile).toHaveBeenCalledWith('e1', { rsvpId: 'real-1', status: 'going' });
	});

	it('on failure: unmarks pending (re-enables the control) and reverts ONLY this event to its pre-tap value', async () => {
		applyRsvpChangeMock.mockRejectedValueOnce(new Error('403'));
		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);
		const before: MyRsvp = { rsvpId: 'rsvp-1', eventId: 'e1', status: 'going' };

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: before, newStatus: 'maybe' });

		await vi.waitFor(() => {
			expect(cb.setPending).toHaveBeenLastCalledWith('e1', false);
		});
		expect(cb.revert).toHaveBeenCalledWith('e1', { rsvpId: 'rsvp-1', status: 'going' });
	});

	it('after a write settles, the SAME event can be tapped again — a fresh request fires a new write (re-enabled, not stuck)', async () => {
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: 'real-1' });
		applyRsvpChangeMock.mockResolvedValueOnce({ rsvpId: 'real-1' });
		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		await vi.waitFor(() => expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(cb.setPending).toHaveBeenLastCalledWith('e1', false));

		const existing: MyRsvp = { rsvpId: 'real-1', eventId: 'e1', status: 'going' };
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing, newStatus: 'maybe' });

		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(2);
		expect(cb.setPending).toHaveBeenCalledWith('e1', true); // pending again for the new write
	});
});

describe('createRsvpChangeQueue — #15 defensive backstop: a request while already pending', () => {
	it('a second request for the SAME event while pending is a no-op — no second write fires (the disabled control is the primary guard; this is belt-and-braces)', () => {
		const d = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'maybe' }); // ignored — e1 is pending

		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(1); // still just the first write
	});

	it('the no-op does not re-fire setOptimistic or setPending — a genuine no-op, not a silent second update', () => {
		const d = deferred<{ rsvpId: string | null }>();
		applyRsvpChangeMock.mockReturnValueOnce(d.promise);
		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		cb.setOptimistic.mockClear();
		cb.setPending.mockClear();

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'maybe' });

		expect(cb.setOptimistic).not.toHaveBeenCalled();
		expect(cb.setPending).not.toHaveBeenCalled();
	});
});

describe('createRsvpChangeQueue — two DIFFERENT events tapped concurrently', () => {
	it('each event fires its own write immediately — independent pending state, one busy event never blocks another', () => {
		applyRsvpChangeMock.mockReturnValue(new Promise(() => {})); // never resolves; only call count/args matter
		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e2', existing: null, newStatus: 'maybe' });

		expect(applyRsvpChangeMock).toHaveBeenCalledTimes(2);
		expect(cb.setPending).toHaveBeenCalledWith('e1', true);
		expect(cb.setPending).toHaveBeenCalledWith('e2', true);
	});

	it('a failed write on one event reverts + re-enables ONLY that event — a concurrent, still-pending event is untouched (the exact #15 clobber)', async () => {
		const dOther = deferred<{ rsvpId: string | null }>(); // e2's write never resolves in this test
		applyRsvpChangeMock.mockImplementationOnce(() => Promise.reject(new Error('403'))); // e1 fails
		applyRsvpChangeMock.mockReturnValueOnce(dOther.promise); // e2 still pending

		const cb = makeCallbacks();
		const queue = createRsvpChangeQueue(cb);

		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e1', existing: null, newStatus: 'going' });
		queue.request({ cfg, personId: 'person-p', memberId: 'member-m', eventId: 'e2', existing: null, newStatus: 'maybe' });

		await vi.waitFor(() => {
			expect(cb.revert).toHaveBeenCalledTimes(1);
		});
		expect(cb.revert).toHaveBeenCalledWith('e1', null);
		expect(cb.revert).not.toHaveBeenCalledWith('e2', expect.anything());
		// e2 must STILL be pending — a whole-map/whole-state operation triggered by
		// e1's failure would have no way to leave e2 alone; this API structurally can't.
		expect(cb.setPending).not.toHaveBeenCalledWith('e2', false);
	});
});

// (*MVOX:Tallis*)
