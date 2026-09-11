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
 * Is this row's edition state UNKNOWN (as opposed to a stated fact)?
 *
 * Two shapes qualify, and only while the edition read behind the options was
 * truncated AND no scoped read has settled for the row's work:
 *   • a PIN we cannot name — `editionId` is set and nothing resolves its label;
 *   • a work with ZERO matched options and nothing pinned — "this work has no
 *     edition" would be a claim the truncated read cannot back.
 *
 * A row whose pin we CAN name is a fact (truncation poisons negatives, never
 * positives). A row with nothing pinned but a non-empty option list is a fact
 * too: `editionId === ''` is read off the repertoire_item itself, not off the
 * truncated join.
 */
export function rowEditionUnknown(
	row: WorkRow,
	options: readonly PickerOption[],
	partial: boolean,
	resolvedWorkIds: ReadonlySet<string>
): boolean {
	if (row.kind !== 'repertoire') return false;
	if (!partial) return false;
	if (resolvedWorkIds.has(row.workId)) return false;
	if (pinnedEditionLabel(row, options) !== '') return false;
	return row.editionId !== '' || options.length === 0;
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
