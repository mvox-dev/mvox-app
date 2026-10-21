import type { EntuCfg } from '$lib/entu/cfg';
import { createRsvp, updateRsvpStatus, deleteRsvp } from './rsvpData';
import type { MyRsvp, RsvpStatus } from './rsvpData';

interface ApplyRsvpChangeInput {
	cfg: EntuCfg;
	personId: string;
	eventId: string;
	memberId: string | null;
	existing: MyRsvp | null;
	newStatus: RsvpStatus | null;
}

interface ApplyRsvpChangeResult {
	rsvpId: string | null;
}

// Rejects on any write failure so the caller's optimistic revert fires; the memberId check
// backs up the UI, which already disables the control for non-members.
export async function applyRsvpChange(input: ApplyRsvpChangeInput): Promise<ApplyRsvpChangeResult> {
	const { cfg, personId, eventId, memberId, existing, newStatus } = input;

	if (!existing && newStatus) {
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

	return { rsvpId: null };
}

// (*MVOX:Tallis*)
