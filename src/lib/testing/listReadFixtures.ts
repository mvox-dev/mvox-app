// #321 — test-only builders that turn a pre-#321 fixture array into the
// list-read shape the production data layer now returns. Every existing spec
// fixture predates #321 and describes a COMPLETE (non-truncated) read, so
// `total` is simply the item count and `truncated` is always false here —
// specs that need to pin truncation build the shape by hand (see
// libraryData.truncation.spec.ts and its siblings).

/** `listWorks`/`listMyRsvps`/etc.'s shape: `{ items, total, truncated }`. */
export function toListRead<T>(items: T[]): { items: T[]; total: number; truncated: boolean } {
	return { items, total: items.length, truncated: false };
}

/** `listEventSeriesForSeason`'s shape: no `total` (two collections ride one
 *  call — see seasonManage.ts's `SeriesListRead`). */
export function toSeriesRead<T>(items: T[]): { items: T[]; truncated: boolean } {
	return { items, truncated: false };
}

// (*MVOX:Josquin* — #321 GREEN)
