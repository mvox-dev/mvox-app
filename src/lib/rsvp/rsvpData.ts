import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

// The RSVP write path (#10) — a singer's own status on an event. Harvested from
// `mvox_v4e_web` `src/lib/rsvp/rsvpData.ts` (tally functions dropped — out of
// scope for slice-2, see epic #8 "Out of slice-2").
//
// `member` resolution is DE-FANNED to match `listSeasons`/`listRehearsals`: no
// orgId param. In polyphony (single-collective) a person has exactly one active
// `member` row, so `person.reference` + `status.string=active` alone disambiguates
// — same simplification already landed for seasons ("in polyphony all seasons are
// EFK's"). Not the end state; flagged to team-lead alongside the RED report.

export type RsvpStatus = 'going' | 'not_going' | 'maybe' | 'late';

export interface CreateRsvpInput {
	personId: string;
	eventId: string;
	memberId: string;
	status: RsvpStatus;
}

/**
 * Resolve the singer's own active `member` id in the current collective. Returns
 * null when no active membership exists (e.g. a signed-in person with no roster
 * row yet) — callers use this to gate the RSVP control (#12).
 */
export async function findMyMemberId(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	throw new Error('not implemented');
}

/**
 * Create a new rsvp under the singer's own person. Sends `_type` as a resolved
 * `reference` (never `string` — #10 pinned wire-shape), plus the ONE sentinel
 * matching `status`; the other three sentinels are simply absent (a fresh create
 * has no stale values to clear).
 *
 * MUST send an explicit `{ type: '_sharing', string: 'private' }`. Omitting it
 * makes Entu auto-inherit `_sharing: domain` from the (domain-shared) person
 * parent — leaking the singer's private answer to every member. An explicit
 * value on create suppresses the inherit (Pérotin's live-probe finding, #10).
 */
export async function createRsvp(
	cfg: EntuCfg,
	input: CreateRsvpInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	throw new Error('not implemented');
}

/**
 * Change an existing rsvp's status. Reads the current entity (status + event +
 * all four sentinel value-ids), deletes the old status value AND every existing
 * sentinel value found, then writes the new status + its matching sentinel. The
 * sentinel's event reference is sourced from the GET, not the caller — this
 * function only ever receives a status change, not an event.
 */
export async function updateRsvpStatus(
	cfg: EntuCfg,
	rsvpId: string,
	status: RsvpStatus,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	throw new Error('not implemented');
}

/**
 * Clear an rsvp (tap-active-to-toggle-off). The `status` enum has no "none"
 * value, so deletion IS the "no answer" representation — this is also what keeps
 * the four sentinels from surviving as orphan phantom counts.
 */
export async function deleteRsvp(
	cfg: EntuCfg,
	rsvpId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	throw new Error('not implemented');
}

// (*MVOX:Tallis*)
