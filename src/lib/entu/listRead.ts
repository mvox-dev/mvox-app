// #321 — the shared DETECTION layer for "lists say when they are partial".
//
// CONTRACT (issue #321 + the 00:46Z Gama amendment, points 2/3): every
// display-list reader parses the server's `count` off the SAME list response
// it already makes — never a second request — and reports
//
//     { items: <mapped rows>, total: number, truncated: boolean }
//
// where:
//   - `total`     = the server's `count` when present, else the RAW
//                   `entities.length` (a body with no `count` at all — a
//                   legacy mock, or a genuinely count-less response — reads as
//                   COMPLETE, never as truncated: absent evidence is not
//                   evidence of truncation, so this helper fails toward
//                   SILENCE rather than a false partial notice);
//   - `truncated` = `count > rawLength`, where `rawLength` is the length of
//                   the WIRE array BEFORE any client-side dropping/mapping —
//                   never `items.length` after a caller drops malformed rows
//                   (#258 in libraryData.ts, the #84-review rule in
//                   attendanceData.ts) or dedups (eventDetail.ts's location
//                   corpus), so a row this app chooses not to show never
//                   fabricates a truncation the server never reported;
//   - `entities.length === limit` is NEVER the signal on its own — an at-cap
//     collection with nothing beyond it is indistinguishable from a truly
//     truncated one by length alone. Probe-proven false positive: see
//     probe-321-list-count-semantics-live-2026-09-11T00-39-06-327Z.json,
//     step `q1-site-3-exactly-at-cap-edge-case` (`atCap`/`aboveCap` both
//     report the SAME `count`, only `entitiesLength` differs by the query's
//     own `limit`).
//
// COUNT-RELIANCE (Gama amendment point 3): the property this whole detection
// scheme rests on — that Entu's list-response `count` is the CALLER-VISIBLE
// true total, not a raw/unfiltered one a lower rights tier could leak off —
// is UNDOCUMENTED upstream (entu/www's query reference names `limit`/`skip`
// for paging but never `count`). It is established only by two ledgered
// probes, both read-only against polyphony (synthetic):
//   - probe-321-list-count-semantics-live-2026-09-11T00-39-06-327Z.json —
//     `count` tracks the TRUE total under truncation regardless of `limit`/
//     `props`, and an at-cap collection is told apart from a truncated one
//     (q1, CONFIRMED).
//   - probe-321-authed-lesser-tier-subset-live-2026-09-11T00-42-57-032Z.json —
//     an authenticated caller whose rights admit only a SUBSET of a real
//     collection sees `count` equal to THEIR visible subset (2), not the raw
//     total (3) — the server never leaks a rights-restricted count
//     (CONFIRMED-NO-LEAK-count-matches-caller-visible-subset), which is what
//     makes a "showing N of M" notice safe to render with real numbers.
//
// This is the same move `sectionActions.ts`'s `countOf` already made for its
// own count-only gate reads ("preferring the server's own count over the
// (limit-capped) entities array length") and `seasonManage.ts`'s
// `listChildIds`/`listSeasonEvents` cascade guards already made for their
// refuse-if-partial checks — this helper generalizes that same shape for the
// DISPLAY-list case (report, don't refuse) rather than inventing a new one.

/** The pinned result shape every display-list reader returns. */
export interface ListRead<T> {
	items: T[];
	total: number;
	truncated: boolean;
}

/**
 * Build a `ListRead` from the wire body's `count` (if present), the RAW
 * entities array length (before any client-side drop/dedup), and the already
 * -mapped `items`. See module header for the full contract.
 */
export function deriveListRead<T>(items: T[], rawLength: number, count: number | undefined): ListRead<T> {
	return {
		items,
		total: count ?? rawLength,
		truncated: count !== undefined && count > rawLength
	};
}

/**
 * The bare boolean, for callers that don't need the full `ListRead` shape —
 * `resolveMembership` (membershipStore.ts) consumes only this, on its own
 * tri-state logic, and `listEventSeriesForSeason` (seasonManage.ts) ORs it
 * across two independent reads rather than exposing a made-up combined total.
 */
export function isTruncated(rawLength: number, count: number | undefined): boolean {
	return count !== undefined && count > rawLength;
}

// (*MVOX:Josquin* — #321 GREEN)
