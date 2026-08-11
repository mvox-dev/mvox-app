// src/lib/events/eventFieldEdit.ts
//
// #104 TE.4 (GREEN) — the write half of inline event editing on the detail
// page. One function, one field, one immediate round-trip: per-tap writes,
// same posture as attendanceData/repertoireActions — there is no "save all"
// payload anywhere in this module's API.
//
// Replace semantics per the pinned Entu wire contract (multi-value trap):
// POST APPENDS to an implicitly multi-valued prop, so a naive POST would
// leave the OLD value standing beside the new one. The choreography is
// therefore, in this order:
//   1. GET entity/{eventId}?props={field} — the existing value id(s). This
//      MUST come first so the later deletes target only the PRE-EXISTING
//      ids, never the value we are about to write;
//   2. POST entity/{eventId} with exactly ONE new value;
//   3. DELETE /property/{id} for EVERY id from step 1 (not just the first —
//      a leftover value must not survive as a phantom on the entity).
//
// POST BEFORE DELETE (#91 review F5), the same house rule repertoireActions
// and sectionActions run: with DELETE first, a POST that fails leaves the
// property EMPTY server-side while the caller reverts the header to the old
// value — the UI would then actively misrepresent server state, and
// eventDetail.ts would silently fall the field back to the parent series
// default (or '') on the next load. Posting first means a failed POST leaves
// the old value untouched, and a failed DELETE leaves a recoverable duplicate
// that the NEXT edit's GET-then-delete-all cleans up.
//
// Non-2xx anywhere throws (fail loud, no silent success) — the caller
// (+page.svelte) is what turns that into an optimistic-revert + inline error.
import { entuFetch } from '$lib/entu/request';

export type EditableEventField =
	| 'name'
	| 'start_datetime'
	| 'duration_minutes'
	| 'location'
	| 'description';

/** Which wire value key each editable field is written under. */
function wireProp(field: EditableEventField, value: string | number): Record<string, unknown> {
	switch (field) {
		case 'start_datetime':
			return { type: field, datetime: value };
		case 'duration_minutes':
			return { type: field, number: value };
		default:
			return { type: field, string: value };
	}
}

export async function updateEventField(
	cfg: { db: string; token: string },
	eventId: string,
	field: EditableEventField,
	value: string | number,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${eventId}?props=${field}`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`updateEventField lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: Record<string, Array<{ _id: string }>> };
	const existing = body.entity?.[field] ?? [];

	const postRes = await entuFetch(
		cfg.db,
		`entity/${eventId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([wireProp(field, value)])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`updateEventField POST failed: ${postRes.status}`);

	for (const v of existing) {
		const delRes = await entuFetch(cfg.db, `property/${v._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`updateEventField delete failed: ${delRes.status}`);
	}
}

// (*MVOX:Josquin*)
