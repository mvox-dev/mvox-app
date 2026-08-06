import { applyRsvpChange } from './rsvpOptimistic';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyRsvp, RsvpStatus } from './rsvpData';

// #15 fix — double-tapping an RSVP stuck it until reload. Root cause (confirmed
// by team-lead reading the old inline `handleRsvpChange` in +page.svelte):
//   1. First tap on an unanswered event optimistically stored a PLACEHOLDER id
//      ('__optimistic__') and fired createRsvp (~300ms).
//   2. A SECOND tap before that resolved read the placeholder as `existing` and
//      fired update/deleteRsvp AGAINST IT → 404.
//   3. The failure `.catch` reverted the WHOLE rsvpByEventId map to a stale
//      snapshot that still held the placeholder — clobbering the first write's
//      real-id reconciliation too. The event was stuck at '__optimistic__'
//      forever (every later change 404s); only a reload (which refetches the
//      real id) recovered.
//
// FIX SHAPE (Mihkel's ruling, 2026-08-06): "the button should not be clickable
// until resolved." NOT coalescing — the whole RsvpControl (all 4 status
// buttons) for an event disables while that event's write is in flight, and
// re-enables on resolve (success or failure). This makes a second tap on the
// SAME event structurally impossible at the UI layer — no second write can
// ever fire against the placeholder. `request()`'s own guard against a
// concurrent call for the same event is a defensive backstop (correct even if
// something bypasses the disabled control), not the primary mechanism — the
// primary mechanism is AgendaList wiring `pendingEventIds` into each row's
// `disabled` prop (see AgendaList.spec.ts).
//
// The other #15 defect — a whole-map revert clobbering a concurrent event's
// state — is fixed the same way regardless of shape: setOptimistic/setPending/
// reconcile/revert are all PER-EVENT callbacks. There is no whole-map
// operation in this module's API for a caller to misuse.
//
// One instance lives for the page's lifetime — Byrd creates it once in
// +page.svelte and calls .request() from the RsvpControl onchange handler.

/** The row-control's value for one event — same shape as RsvpByEventId's values. */
export interface RsvpEntry {
	rsvpId: string;
	status: RsvpStatus;
}

export interface RsvpChangeCallbacks {
	/** Apply the optimistic value for exactly this event, synchronously. */
	setOptimistic(eventId: string, entry: RsvpEntry | null): void;
	/** Mark/unmark this event as having a write in flight — the caller threads
	 *  this into that row's RsvpControl `disabled` prop (all 4 buttons). */
	setPending(eventId: string, pending: boolean): void;
	/** A write settled successfully — the final, reconciled value for this event. */
	reconcile(eventId: string, entry: RsvpEntry | null): void;
	/** A write failed — restore exactly this event's PRE-tap value. Nothing else. */
	revert(eventId: string, before: RsvpEntry | null): void;
}

export interface RequestRsvpChangeInput {
	cfg: EntuCfg;
	personId: string;
	memberId: string | null;
	eventId: string;
	/** The real (or already-reconciled) existing rsvp for this event, or null. */
	existing: MyRsvp | null;
	newStatus: RsvpStatus | null;
}

export interface RsvpChangeQueue {
	request(input: RequestRsvpChangeInput): void;
}

export function createRsvpChangeQueue(callbacks: RsvpChangeCallbacks): RsvpChangeQueue {
	return {
		request() {
			throw new Error('not implemented');
		}
	};
}

// (*MVOX:Tallis*)
