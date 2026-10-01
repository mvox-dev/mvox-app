// The RSVP write-status reducer shared by the agenda and the event page.
import type { RsvpChangeCallbacks, RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
import type { WriteTokens } from '$lib/net/writeTokens';

export interface RsvpWriteAccessors {
	setEntry(eventId: string, entry: RsvpEntry | null): void;
	setPending(eventId: string, pending: boolean): void;
	setFailed(eventId: string, failed: boolean): void;
	setSaved(eventId: string, saved: boolean): void;
}

export interface RsvpWriteStatusDeps {
	accessors: RsvpWriteAccessors;
	tokens: WriteTokens<string>;
	onReconcile?(eventId: string, entry: RsvpEntry | null): void;
}

export function createRsvpWriteStatus(deps: RsvpWriteStatusDeps): RsvpChangeCallbacks {
	const { accessors: a, tokens } = deps;
	return {
		setOptimistic(eventId, entry) {
			if (tokens.isCurrent(eventId)) a.setEntry(eventId, entry);
		},
		setPending(eventId, pending) {
			if (pending) tokens.begin(eventId);
			a.setPending(eventId, pending);
			if (pending && tokens.isCurrent(eventId)) {
				a.setFailed(eventId, false);
				a.setSaved(eventId, false);
			}
		},
		reconcile(eventId, entry) {
			if (!tokens.end(eventId)) return;
			a.setEntry(eventId, entry);
			a.setSaved(eventId, true);
			deps.onReconcile?.(eventId, entry);
		},
		revert(eventId, before) {
			if (!tokens.end(eventId)) return;
			a.setEntry(eventId, before);
			a.setFailed(eventId, true);
			a.setSaved(eventId, false);
		}
	};
}
