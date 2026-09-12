// #329 (review) — the ONE decision of whether a repertoire row's edition state
// is a stated FACT or merely NOT KNOWN, plus the work ids a page must read
// scoped to turn "not known" into a fact.
//
// Shared on purpose. The renderer (RepertoireElement) prints "unknown" exactly
// where the pages (routes/+page.svelte, routes/event/[id]/+page.svelte) must
// dispatch the scoped per-work read; two copies of this predicate drift into
// either a row that says "unknown" forever because nobody read for it, or a
// read whose answer nothing displays.
//
// The rule it encodes (#321's, ruled again on #329): a negative derived from a
// truncated read is not a fact. The collective-wide `listAllEditions` read
// (limit=500) is the only source of both `editionOptionsByRowId` and — via
// workRows.ts's label lookup — `row.editionName`, so under truncation BOTH can
// come back empty for a work that has editions, and for a row that holds a
// real pin. Neither emptiness proves anything; `listEditions(workId)` (one
// request, scoped to the one work, its own reachable cap) does — but only when
// that read comes back COMPLETE. The pages check its `truncated` and leave the
// work unresolved when it is set, so a partial one-work read cannot settle a
// row either.
//
// #331 item 4 narrows that rule for one shape, on ONE of the two feeds below:
// a PIN we cannot name is unknown even under a COMPLETE read — a dangling or
// unreadable edition reference is still a pin, and "no pinned edition" stays
// false regardless of `partial`. `partial` remains genuinely required for the
// other shape (zero matched options, nothing pinned).
//
// That narrowing ships on the READER feed only — `readerEditionUnknown`. It is
// a WORDING change there and nothing else: a reader has no picker. On the
// editor feed (`rowEditionUnknown`) the same relaxation would also flip
// `pickerPinIsUnknown`, which replaces the picker's '' (= unpin) entry with a
// disabled one. #329's reason for that disable was that a scoped read would
// shortly name the pin — but `unresolvedEditionWorkIds` issues no scoped read
// under a COMPLETE read, so an editor would be left permanently unable to
// clear a pin she cannot read. #331's "editor-facing behaviour byte-identical
// to 25d72cd" bullet and its item 4 collide there; the editor half is split
// out (item 4 is marked "splittable if it widens the slice") and needs a PO
// ruling on the unpin affordance before it can land.
//
// KNOWN GAP, both feeds (#337, raised in #331's review): `editionUnknown` opens
// with `if (row.kind !== 'repertoire') return false`, so PROGRAM rows are
// excluded outright. That came from #329, where the surface under discussion was
// the season-repertoire pin control a program row has no equivalent of. It is
// NOT a considered ruling about the WORDING: a program_item's `edition` is a
// required reference, and its `editionName` degrades to '' through the same
// truncated collective-wide label lookup — so a program row whose edition the
// read could not name falls to RepertoireElement's terminal `{:else}` and
// prints "No pinned edition" about an item that is pinned by construction. On
// /event/[id] that is the primary row shape. #337 carries the reader-feed fix
// (wording only there too — a program row has no pin control); until it lands,
// read the `kind` gate as a gap, not as a decision.

import type { PickerOption, WorkRow } from './types';

/**
 * What to PRINT as this row's edition: the row's own resolved name, or — when
 * the collective-wide read could not name the pin but a scoped per-work read
 * since has — the matched option's label. '' = we cannot name it (either
 * nothing is pinned, or the pin is a reference no read has resolved yet).
 */
export function pinnedEditionLabel(row: WorkRow, options: readonly PickerOption[]): string {
	if (row.editionName !== '') return row.editionName;
	if (row.editionId === '') return '';
	return options.find((opt) => opt.id === row.editionId)?.label ?? '';
}

/**
 * The ONE implementation both feeds below run. `unnameablePinNeedsNoTruncation`
 * is the single axis they differ on (#331 item 4) — everything else is shared
 * so the two can never drift.
 */
function editionUnknown(
	row: WorkRow,
	options: readonly PickerOption[],
	partial: boolean,
	resolvedWorkIds: ReadonlySet<string>,
	unnameablePinNeedsNoTruncation: boolean
): boolean {
	if (row.kind !== 'repertoire') return false;
	if (resolvedWorkIds.has(row.workId)) return false;
	if (pinnedEditionLabel(row, options) !== '') return false;
	// The PIN-we-cannot-name shape: `editionId` is set and nothing resolves its
	// label. The OTHER shape — zero matched options, nothing pinned — needs
	// `partial` on both feeds: "this work has no edition" would be a claim a
	// truncated read cannot back, but under a COMPLETE read it is a known
	// absence (`editionId === ''` is read off the repertoire_item itself, not
	// off the truncated join, so a complete join adds nothing to the claim).
	if (row.editionId !== '') return unnameablePinNeedsNoTruncation || partial;
	return partial && options.length === 0;
}

/**
 * Is this row's edition state UNKNOWN (as opposed to a stated fact), on the
 * EDITOR feed — `partial` is the manage picker read's `pickableEditionsPartial`.
 *
 * Both unknown shapes need `partial` here, and deliberately so: this predicate
 * also gates `pickerPinIsUnknown`, which takes the unpin choice out of the
 * picker. Relaxing the pin shape (#331 item 4) would make that removal
 * permanent for an editor whose pin is simply unreadable, with no scoped read
 * left to settle it — see the module header. Byte-identical to `25d72cd`.
 *
 * A row whose pin we CAN name is a fact either way (truncation poisons
 * negatives, never positives).
 */
export function rowEditionUnknown(
	row: WorkRow,
	options: readonly PickerOption[],
	partial: boolean,
	resolvedWorkIds: ReadonlySet<string>
): boolean {
	return editionUnknown(row, options, partial, resolvedWorkIds, false);
}

/**
 * The same question on the READER feed — `truncated` is the row's OWN
 * `WorkRow.truncated` (#331), because `pickableEditionsPartial` reports on a
 * manage read a rights-less reader never triggers.
 *
 * Here the PIN-we-cannot-name shape is unknown UNCONDITIONALLY (#331 item 4):
 * a dangling or unreadable edition reference is still a pin, so "No pinned
 * edition" is false whether or not the read that failed to name it truncated.
 * A reader carries no picker, so this changes wording and nothing else.
 */
export function readerEditionUnknown(
	row: WorkRow,
	options: readonly PickerOption[],
	truncated: boolean,
	resolvedWorkIds: ReadonlySet<string>
): boolean {
	return editionUnknown(row, options, truncated, resolvedWorkIds, true);
}

/**
 * The distinct work ids whose editions a page must fetch scoped, because some
 * row of theirs is in the unknown state and the read that would settle it has
 * not happened. Empty whenever the edition read was complete — a complete read
 * IS the fact, and no extra request is owed.
 *
 * A row with no resolvable work (`workId === ''`) is left out: there is no
 * scoped read to make for it. It keeps the unknown wording, which is the
 * honest thing to say about it.
 */
export function unresolvedEditionWorkIds(
	rows: readonly WorkRow[],
	optionsByRowId: Record<string, PickerOption[]>,
	partial: boolean,
	resolvedWorkIds: ReadonlySet<string>
): string[] {
	if (!partial) return [];
	const out = new Set<string>();
	for (const row of rows) {
		if (row.workId === '') continue;
		if (!rowEditionUnknown(row, optionsByRowId[row.id] ?? [], partial, resolvedWorkIds)) continue;
		out.add(row.workId);
	}
	return [...out];
}

// (*MVOX:Josquin* — #329 review)
// (*MVOX:Josquin* — #331 review, finding 1)
