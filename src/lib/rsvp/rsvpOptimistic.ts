import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { createRsvp, updateRsvpStatus, deleteRsvp } from './rsvpData';
import type { MyRsvp, RsvpStatus } from './rsvpData';

// #12 — the write-dispatch half of "tap updates immediately and reverts on
// failure". Kept framework-agnostic (no Svelte state touched here) on purpose:
// it's the part team-lead's brief wants unit-testable without a live component
// tree ("keep write calls behind injected props/handlers so the component test
// stays unit-level"). The Svelte-side optimistic SET (before calling this) and
// REVERT (in the caller's catch) is Byrd's GREEN, inline in the agenda page —
// same shape as the harvested `mvox_v4e_web` `handleRsvpChange`, minus the
// tally delta (out of scope, see epic #8).

interface ApplyRsvpChangeInput {
	cfg: EntuCfg;
	personId: string;
	eventId: string;
	memberId: string | null;
	existing: MyRsvp | null;
	newStatus: RsvpStatus | null;
}

/** `rsvpId: null` means the rsvp was cleared (deleted). */
interface ApplyRsvpChangeResult {
	rsvpId: string | null;
}

/**
 * Dispatch one RSVP write to the right #10 primitive:
 *   - no existing rsvp, a status is set   → createRsvp (requires memberId —
 *     throws if absent; the UI disables the control for non-members, this is
 *     the data-layer backstop, not the primary guard)
 *   - an existing rsvp, a (different) status is set → updateRsvpStatus
 *   - an existing rsvp, status cleared (tap-active)  → deleteRsvp
 *   - no existing rsvp, no status (nothing to do)    → no write issued
 *
 * REJECTS on any underlying write failure — propagates, does not swallow, so
 * the caller's optimistic-UI revert always fires on a real failure.
 */
export async function applyRsvpChange(input: ApplyRsvpChangeInput): Promise<ApplyRsvpChangeResult> {
	const { cfg, personId, eventId, memberId, existing, newStatus } = input;

	if (!existing && newStatus) {
		// Create — requires memberId. The UI disables the control for non-members;
		// this is the data-layer backstop, not the primary guard.
		if (!memberId) throw new Error('applyRsvpChange: cannot create without a memberId');
		const rsvpId = await createRsvp(cfg, { personId, eventId, memberId, status: newStatus });
		return { rsvpId };
	}

	if (existing && newStatus) {
		await updateRsvpStatus(cfg, existing.rsvpId, newStatus);
		return { rsvpId: existing.rsvpId };
	}

	if (existing && !newStatus) {
		await deleteRsvp(cfg, existing.rsvpId);
		return { rsvpId: null };
	}

	// No existing rsvp, no status — nothing to do.
	return { rsvpId: null };
}

// (*MVOX:Tallis*)
