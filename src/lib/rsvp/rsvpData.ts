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

/** A singer's own rsvp as read back for the agenda (#11). */
export interface MyRsvp {
	rsvpId: string;
	eventId: string;
	status: RsvpStatus;
}

/** The row-control's initial state, keyed by event id. */
export type RsvpByEventId = Record<string, { rsvpId: string; status: RsvpStatus }>;

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
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=member&person.reference=${encodeURIComponent(personId)}&status.string=active&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`findMyMemberId failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	return body.entities?.[0]?._id ?? null;
}

/**
 * List the singer's own rsvps (#11). `rsvp` is a child of `person` — scoping by
 * `_parent.reference=personId` is the whole query, native under the singer's own
 * person, no cross-person read (issue AC). Used to seed each agenda row's answer.
 */
export async function listMyRsvps(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MyRsvp[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=rsvp&_parent.reference=${encodeURIComponent(personId)}&props=event,status&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listMyRsvps failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			event?: Array<{ reference: string }>;
			status?: Array<{ string: string }>;
		}>;
	};
	return (body.entities ?? []).map((raw) => ({
		rsvpId: raw._id,
		eventId: raw.event?.[0]?.reference ?? '',
		status: (raw.status?.[0]?.string ?? 'going') as RsvpStatus
	}));
}

/**
 * Index rsvps by event id for the agenda row controls' initial state. Pure — no
 * fetch. An event with no rsvp is simply ABSENT from the map — renders unanswered,
 * never defaulted to any status (issue AC).
 */
export function rsvpsByEventId(rsvps: MyRsvp[]): RsvpByEventId {
	const map: RsvpByEventId = {};
	for (const r of rsvps) {
		map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
	}
	return map;
}

/**
 * Create a new rsvp under the singer's own person. Sends `_type` as a resolved
 * `reference` (never `string` — #10 pinned wire-shape), plus the ONE sentinel
 * matching `status`; the other three sentinels are simply absent (a fresh create
 * has no stale values to clear).
 *
 * MUST send an explicit `{ type: '_sharing', string: 'domain' }` at create time
 * per v4E — never rely on inherit. Deliberate privacy widen (#82, Mihkel
 * 2026-08-10): `domain` so collective members see each other's answers and the
 * conductor can read individual RSVPs for the RSVP→attendance comparison (AC-3/AC-11).
 */
export async function createRsvp(
	cfg: EntuCfg,
	input: CreateRsvpInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const rsvpTypeId = await resolveTypeId(cfg, 'rsvp', fetchImpl);
	// One sentinel (`<status>_ref`) matching the chosen status; the other three are
	// simply absent on a fresh create. Explicit `_sharing: domain` — never rely on
	// inherit (#82: deliberate widen for conductor RSVP→attendance read, AC-3/AC-11).
	const props = [
		{ type: '_type', reference: rsvpTypeId },
		{ type: '_parent', reference: input.personId },
		{ type: 'event', reference: input.eventId },
		{ type: 'member', reference: input.memberId },
		{ type: 'status', string: input.status },
		{ type: `${input.status}_ref`, reference: input.eventId },
		{ type: '_sharing', string: 'domain' }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createRsvp failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
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
	const getRes = await entuFetch(
		cfg.db,
		`entity/${rsvpId}?props=status,event,going_ref,not_going_ref,maybe_ref,late_ref`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!getRes.ok) throw new Error(`updateRsvpStatus lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as {
		entity?: {
			status?: Array<{ _id: string }>;
			event?: Array<{ reference: string }>;
			going_ref?: Array<{ _id: string }>;
			not_going_ref?: Array<{ _id: string }>;
			maybe_ref?: Array<{ _id: string }>;
			late_ref?: Array<{ _id: string }>;
		};
	};
	const entity = body.entity ?? {};
	// Sentinel event reference comes from the stored rsvp, never the caller — this
	// function only ever takes a status change.
	const eventId = entity.event?.[0]?.reference ?? '';

	// GENERIC delete: the old status value AND every sentinel value-id that exists,
	// not just the one we expect. If corrupted state left two sentinels set, both go
	// — otherwise an orphan would survive as a phantom count.
	const toDelete = [
		...(entity.status ?? []),
		...(entity.going_ref ?? []),
		...(entity.not_going_ref ?? []),
		...(entity.maybe_ref ?? []),
		...(entity.late_ref ?? [])
	];
	for (const value of toDelete) {
		const delRes = await entuFetch(
			cfg.db,
			`property/${value._id}`,
			cfg.token,
			{ method: 'DELETE' },
			fetchImpl
		);
		if (!delRes.ok) throw new Error(`updateRsvpStatus delete failed: ${delRes.status}`);
	}

	const postRes = await entuFetch(
		cfg.db,
		`entity/${rsvpId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: 'status', string: status },
				{ type: `${status}_ref`, reference: eventId }
			])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`updateRsvpStatus POST failed: ${postRes.status}`);
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
	const res = await entuFetch(cfg.db, `entity/${rsvpId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteRsvp failed: ${res.status}`);
}

// (*MVOX:Tallis*)
