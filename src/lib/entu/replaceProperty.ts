// src/lib/entu/replaceProperty.ts
//
// #165 review F5 — the ONE implementation of Entu's "replace a single-valued
// property" choreography. Extracted from eventFieldEdit.ts (#104 TE.4), which
// collectiveName.ts (#165) had cloned verbatim; both are now thin callers so
// the house rule below only ever has to be corrected in one place.
//
// Replace semantics per the pinned Entu wire contract (multi-value trap):
// POST APPENDS to an implicitly multi-valued prop, so a naive POST would leave
// the OLD value standing beside the new one. The choreography is therefore, in
// this order:
//   1. GET entity/{entityId}?props={prop} — the existing value id(s). This
//      MUST come first so the later deletes target only the PRE-EXISTING ids,
//      never the value we are about to write;
//   2. POST entity/{entityId} with exactly ONE new value;
//   3. DELETE /property/{id} for EVERY id from step 1 (not just the first — a
//      leftover value must not survive as a phantom on the entity).
//
// POST BEFORE DELETE (#91 review F5), the same house rule repertoireActions
// and sectionActions run: with DELETE first, a POST that fails leaves the
// property EMPTY server-side while the caller reverts its UI to the old value
// — the UI would then actively misrepresent server state. Posting first means
// a failed POST leaves the old value untouched, and a failed DELETE leaves a
// recoverable duplicate that the NEXT edit's GET-then-delete-all cleans up.
//
// Non-2xx anywhere throws (fail loud, no silent success) — turning that into
// an optimistic revert + inline error is the calling surface's job.
import { entuFetch } from './request';

/** One Entu property value on the wire: `type` names the property, the other
 *  key is the typed slot it is written under (`string` / `number` /
 *  `datetime` / `reference` / …). */
export type EntuWireValue = { type: string } & Record<string, unknown>;

/**
 * Rewrite `value.type` on `entityId` to exactly `value` (see module header for
 * the pinned choreography). `label` prefixes the thrown messages so a caller's
 * failures stay identifiable in the console.
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

	const postRes = await entuFetch(
		cfg.db,
		`entity/${entityId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([value])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`${label} POST failed: ${postRes.status}`);

	for (const v of existing) {
		const delRes = await entuFetch(cfg.db, `property/${v._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`${label} delete failed: ${delRes.status}`);
	}
}

// (*MVOX:Palestrina* — #165 review F5)
