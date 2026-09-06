// src/lib/entu/replaceProperty.ts
//
// #165 review F5 — the ONE implementation of Entu's "replace a single-valued
// property" choreography. Extracted from eventFieldEdit.ts (#104 TE.4), which
// collectiveName.ts (#165) had cloned verbatim; both are now thin callers so
// the house rule below only ever has to be corrected in one place.
//
// #264 (PO ruling, branch (i)) — the rule goes ATOMIC. Entu's native overwrite
// (entu-www docs, "Overwriting a Property Value"; entu-api entity.js — a POST
// entry carrying an existing value's `_id` alongside the new fields makes
// `setEntity` soft-delete that old value in the SAME call) replaces the old
// GET → POST-new → DELETE-old choreography, which left a half-landing window
// (POST lands, DELETE fails → phantom duplicate). The pinned choreography is
// now:
//
//   1. GET entity/{entityId}?props={prop} — the existing value id(s). Still
//      first: the overwrite entry cannot be built blind.
//   2. POST entity/{entityId}:
//      - ≥1 existing → body EXACTLY [{ _id: <FIRST existing id>, ...value }]
//        (the atomic overwrite: `_id` pairs the new fields with the value
//        being replaced, in the SAME call).
//      - none existing → body EXACTLY [value] (nothing to overwrite).
//   3. EXTRA stale ids (corrupted multi-value state ONLY — normal data never
//      holds more than one) → DELETE /property/{id} each, strictly AFTER the
//      POST landed. A failed extra-sweep leaves a recoverable duplicate,
//      never an empty property. The NORMAL path (zero or one existing value)
//      issues ZERO deletes.
//
// Non-2xx anywhere throws (fail loud, no silent success) — turning that into
// an optimistic revert + inline error is the calling surface's job.
//
// #264 review F2 — THE OVERWRITE IS NOT A COMPARE-AND-SWAP. `_id` names the
// value to soft-delete; it is not a precondition. entu-api's `insertProperties`
// (utils/entity.js) pops `_id` off the entry and inserts the new value
// unconditionally, then `markPropertiesDeleted` runs ONE `updateMany` filtered
// on `{ _id: { $in: oldPIds }, entity, deleted: { $exists: false } }` with NO
// matched-count check. So a POST carrying an `_id` that no longer names a live
// value returns 200 and simply APPENDS — a silent duplicate, not an error.
// Concurrency consequence: two overlapping replaces of the same property both
// GET the same value id; the first POST consumes it; the SECOND lands 200 and
// leaves the entity holding TWO values. Loudness is gone from this layer (the
// old GET→POST→DELETE wire at least 404'd the losing DELETE), so every caller
// whose control can be double-fired MUST keep its own single-flight guard —
// that guard is now the only thing standing between a double-tap and a
// duplicate value.
//
// This is a deliberate trade, not an oversight: the failure the PO ruling
// closes (a POST that lands with a DELETE that 403s, leaving an entity with a
// duplicate AND no way for a non-owner to clean it up) is unconditional on the
// old wire, while the duplicate above needs a genuine race that the UI guards
// already refuse.
import { entuFetch } from './request';

/** One Entu property value on the wire: `type` names the property, the other
 *  key is the typed slot it is written under (`string` / `number` /
 *  `datetime` / `reference` / …). */
export type EntuWireValue = { type: string } & Record<string, unknown>;

/**
 * Rewrite `value.type` on `entityId` to exactly `value` (see module header for
 * the pinned atomic-overwrite choreography). `label` prefixes the thrown
 * messages so a caller's failures stay identifiable in the console.
 */
export async function replaceEntityProperty(
	cfg: { db: string; token: string },
	entityId: string,
	value: EntuWireValue,
	fetchImpl: typeof fetch = fetch,
	label = 'replaceEntityProperty'
): Promise<void> {
	// The property to replace is the one being written — deriving it from the
	// value (rather than taking it as a second argument) makes a GET/POST
	// mismatch unrepresentable.
	const prop = value.type;

	const getRes = await entuFetch(cfg.db, `entity/${entityId}?props=${prop}`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`${label} lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: Record<string, Array<{ _id: string }>> };
	const existing = body.entity?.[prop] ?? [];
	const [oldValue, ...extras] = existing;

	// The atomic overwrite: pair the FIRST existing value's `_id` with the new
	// fields (or send `value` bare when there is nothing to overwrite).
	const entry = oldValue ? { _id: oldValue._id, ...value } : value;

	const postRes = await entuFetch(
		cfg.db,
		`entity/${entityId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([entry])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`${label} POST failed: ${postRes.status}`);

	// EXTRA-sweep — corrupted multi-value state only. STRICTLY AFTER the POST:
	// a failure here leaves a stale duplicate (recoverable), never an empty
	// property.
	for (const v of extras) {
		const delRes = await entuFetch(cfg.db, `property/${v._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`${label} delete failed: ${delRes.status}`);
	}
}

// (*MVOX:Palestrina* — #165 review F5)
// (*MVOX:Palestrina* — #264 GREEN: atomic overwrite-POST, extras-only sweep)
