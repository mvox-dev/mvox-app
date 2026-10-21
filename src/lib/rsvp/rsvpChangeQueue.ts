import { applyRsvpChange } from './rsvpOptimistic';
import type { EntuCfg } from '$lib/entu/cfg';
import type { MyRsvp, RsvpEntry, RsvpStatus } from './rsvpData';

// One RSVP write per event (#15). The caller disables the event's control in flight: a second
// tap would write against the '__optimistic__' placeholder and 404 (AgendaList.spec.ts tests it).
// Every callback is per-event, so a failed write never reverts another event.

export interface RsvpChangeCallbacks {
	setOptimistic(eventId: string, entry: RsvpEntry | null): void;
	setPending(eventId: string, pending: boolean): void;
	reconcile(eventId: string, entry: RsvpEntry | null): void;
	revert(eventId: string, before: RsvpEntry | null): void;
}

export interface RequestRsvpChangeInput {
	cfg: EntuCfg;
	personId: string;
	memberId: string | null;
	eventId: string;
	// A last-resort member-id lookup for the create path when the load-time read failed (#372);
	// a reject propagates like any other failed write.
	resolveMemberId?: () => Promise<string | null>;
	existing: MyRsvp | null;
	newStatus: RsvpStatus | null;
}

export interface RsvpChangeQueue {
	request(input: RequestRsvpChangeInput): void;
}

export function createRsvpChangeQueue(callbacks: RsvpChangeCallbacks): RsvpChangeQueue {
	const pending = new Set<string>();

	return {
		request(input) {
			const { cfg, personId, memberId, eventId, existing, newStatus, resolveMemberId } = input;

			if (pending.has(eventId)) return; // a backstop: the caller disables the control too

			pending.add(eventId);
			callbacks.setPending(eventId, true);

			const optimisticEntry: RsvpEntry | null =
				newStatus !== null ? { rsvpId: existing?.rsvpId ?? '__optimistic__', status: newStatus } : null;
			callbacks.setOptimistic(eventId, optimisticEntry);

			// Only the create path needs a member id; nothing to resolve keeps the write synchronous.
			const needsLookup = !existing && newStatus !== null && memberId === null && !!resolveMemberId;
			const write = needsLookup
				? resolveMemberId!().then((resolved) =>
						applyRsvpChange({ cfg, personId, eventId, memberId: resolved, existing, newStatus })
					)
				: applyRsvpChange({ cfg, personId, eventId, memberId, existing, newStatus });

			write
				.then((result) => {
					pending.delete(eventId);
					callbacks.setPending(eventId, false);
					const reconciled: RsvpEntry | null =
						newStatus !== null ? { rsvpId: result.rsvpId ?? '', status: newStatus } : null;
					callbacks.reconcile(eventId, reconciled);
				})
				.catch(() => {
					pending.delete(eventId);
					callbacks.setPending(eventId, false);
					const before: RsvpEntry | null = existing ? { rsvpId: existing.rsvpId, status: existing.status } : null;
					callbacks.revert(eventId, before);
				});
		}
	};
}

// (*MVOX:Tallis*)
