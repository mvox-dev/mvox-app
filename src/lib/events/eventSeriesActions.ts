// #304 GREEN — the event ↔ series reassign/unassign write layer.
//
// THE WIRE HAZARD THIS FILE EXISTS FOR: an event's `_parent` holds BOTH its
// season and its series under ONE property name, told apart only by each
// value's `entity_type`. A helper that blanket-replaces `_parent`, or pairs
// "the first existing value" with a new reference (`replaceEntityProperty`'s
// idiom, entu/replaceProperty.ts — written for single-purpose props), can
// overwrite the SEASON instead of the series: wire ordering is not
// guaranteed. Both functions below GET first, filter to the value whose
// `entity_type === 'event_series'`, and act on THAT value's id alone — the
// season's value id never appears in any write either function makes.
//
// RIGHTS — settled live on polyphony (#304 SPIKE, seed-results ledger
// probe-304-parent-rights-gate-live-2026-09-10T05-11-52-413Z.json), shaped by
// Gama's ruling (comment 5613471404):
//   - REASSIGN (atomic-overwrite POST, the `reparentSection`/#264 idiom
//     FILTERED by entity_type first, never "first value" blind) is
//     EDITOR-reachable — an `_editor` on the event, with rights on the
//     REFERENCED series, gets HTTP 200 (probe step B2).
//   - UNASSIGN (`DELETE /property/{valueId}`, `unassignMemberSection`'s idiom
//     verbatim) is OWNER-gated — the SAME `_editor` gets HTTP 403 "User not
//     in _owner property" deleting the identical value id (probe step A), the
//     same editor deletes a PLAIN property value on the SAME entity fine
//     (step A2 — the gate is `_parent`-specific, not "editor can't delete
//     anything"), and an `_owner` deletes it fine (step A3). The UI half of
//     that asymmetry (the "no series" option withheld below owner tier, plus
//     a rights-note) is the event page's job, not this module's — see
//     page.series-picker.spec.ts. This module fails loud on a 403 it is
//     somehow reached with (a race between the page's rights snapshot and the
//     write) rather than silently no-op-ing; it never pre-empts the gate
//     itself, Entu is the one authority on it.
//
// NO SILENT COPYING (#304 "What not to do"): the ONLY prop either function
// ever writes is `_parent`. Neither touches name / duration_minutes /
// location / description — the read-side merge (eventDetail.ts) is what
// surfaces a new series' values; copying them onto the event would sever it
// from tracking the series at all.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

interface EventParentValue {
	_id: string;
	reference: string;
	entity_type?: string;
}

/** Thrown by `unassignEventSeries` when the event carries no `event_series`
 *  `_parent` value to remove — a stale picker armed a removal that is already
 *  gone. Nothing is written when this throws. */
export class EventSeriesMissingError extends Error {
	constructor(readonly eventId: string) {
		super(`unassignEventSeries: event ${eventId} has no event_series _parent value to remove`);
		this.name = 'EventSeriesMissingError';
	}
}

/** The event's `event_series`-typed `_parent` value, if it has one — the
 *  SAME `entity_type` discriminator `eventDetail.ts`/`entuSeasons.ts` use to
 *  tell a series parent apart from the season parent sharing the same prop. */
function seriesParentValueOf(values: EventParentValue[]): EventParentValue | undefined {
	return values.find((p) => p.entity_type === 'event_series');
}

async function readParents(
	cfg: EntuCfg,
	eventId: string,
	op: string,
	fetchImpl: typeof fetch
): Promise<EventParentValue[]> {
	const res = await entuFetch(cfg.db, `entity/${eventId}?props=_parent`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`${op} lookup failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _parent?: EventParentValue[] } };
	return body.entity?._parent ?? [];
}

/**
 * Point an event's series `_parent` at `newSeriesId` — reassigning it from
 * one series to another, or assigning one for the first time to a standalone
 * event. Composes two verified idioms (research-304 finding 3):
 *
 *   - an EXISTING series value → Entu's native atomic overwrite (entu-www
 *     docs, "Overwriting a Property Value"; `reparentSection`'s pairing
 *     idiom, sectionActions.ts) — ONE POST whose entry pairs that value's OWN
 *     `_id` with the new reference. No DELETE: the POST soft-deletes the old
 *     value in the same call.
 *   - NO existing series value (a standalone event) → a plain append POST,
 *     no `_id` — the verified "link event to series" shape
 *     (`eventConvert.ts`'s occurrence-linking step).
 *
 * Either way the entry's `_id` (when present) is the SERIES value's, filtered
 * by `entity_type` first — never "the first `_parent` value", which on a
 * two-typed array could just as easily be the season's.
 */
export async function reassignEventSeries(
	cfg: EntuCfg,
	eventId: string,
	newSeriesId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const parents = await readParents(cfg, eventId, 'reassignEventSeries', fetchImpl);
	const existingSeries = seriesParentValueOf(parents);
	const entry = existingSeries
		? { _id: existingSeries._id, type: '_parent', reference: newSeriesId }
		: { type: '_parent', reference: newSeriesId };

	const postRes = await entuFetch(
		cfg.db,
		`entity/${eventId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([entry])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`reassignEventSeries write failed: ${postRes.status}`);
}

/**
 * Detach an event from its series entirely ("Not in a series"/"Ei kuulu
 * sarja"). `unassignMemberSection`'s idiom verbatim (sectionActions.ts): GET
 * `_parent`, filter to the `event_series`-typed value, `DELETE
 * /property/{valueId}` — the property-VALUE endpoint, never `entity/` (the
 * endpoint-split discipline: this deletes a VALUE, not the series or the
 * event). The season's `_parent` value is a different array entry under the
 * same prop name and this function never reads or writes it.
 *
 * OWNER-gated on the wire (module doc above) — a 403 here surfaces as a
 * thrown Error like any other non-2xx; this function does not pre-empt it.
 *
 * Throws `EventSeriesMissingError`, ZERO writes, when the event already has
 * no series value — the goal state is reached, but this is a STALE caller
 * (a picker armed against data that has since changed), not a no-op success.
 */
export async function unassignEventSeries(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const parents = await readParents(cfg, eventId, 'unassignEventSeries', fetchImpl);
	const existingSeries = seriesParentValueOf(parents);
	if (!existingSeries) throw new EventSeriesMissingError(eventId);

	const delRes = await entuFetch(
		cfg.db,
		`property/${existingSeries._id}`,
		cfg.token,
		{ method: 'DELETE' },
		fetchImpl
	);
	if (!delRes.ok) throw new Error(`unassignEventSeries delete failed: ${delRes.status}`);
}

// (*MVOX:Palestrina* — #304 GREEN: event↔series write layer)
