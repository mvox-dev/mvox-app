import { writable, type Writable } from 'svelte/store';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { isTruncated } from '$lib/entu/listRead';

// #255 done-when 6 — app-level membership resolution, lifted into a store on
// the `completionGate` precedent (completionGate.ts:3-6: "the ONE app-wide
// answer... no surface can re-derive the gate and open a hole").
//
// WHY a status-UNSCOPED lookup exists at all: `findMyMemberId` (rsvpData.ts:45)
// is status-scoped, so it returns null for "deactivated" and "never a member"
// alike — the app literally cannot tell them apart today, and the existing
// non-member copy is a statement about a stranger shown to someone who was here
// last week (Gama, accepting Bentham's rec 4). This module's read drops the
// status filter ONLY for this one distinction; every other read stays scoped.
//
// TRI-STATE FAIL-SAFE, VERBATIM (Gama binding): a FAILED lookup must NEVER
// produce 'inactive' — resolve 'loading' instead, exactly the agenda's own
// "NEVER a false claim" rule (+page.svelte:159-166). A failed lookup telling an
// active member she has been removed is the worst available outcome.
//
// The notice this drives is one app-level banner: NO redirect (nothing she can
// do at any destination — a redirect is a dead end), NO nav lock (she keeps the
// domain-readable calendar and her own history) — both refusals PO-accepted.

export type MembershipState = 'loading' | 'active' | 'inactive' | 'non-member';

/** THE app-wide answer. 'loading' until a genuine read flips it. */
export const membershipStore: Writable<MembershipState> = writable('loading');

/** Return the store to its unresolved state — on every (re)selection. */
export function resetMembership(): void {
	membershipStore.set('loading');
}

/**
 * Status-UNSCOPED self-lookup: `_type.string=member&person.reference={me}` —
 * NO `status.string` filter. Classify:
 *   - any row with status 'active'   → 'active' (positive evidence stands,
 *     whether or not the page is truncated — see #321 note below)
 *   - the page is TRUNCATED (server `count` > entities.length) and no active
 *     row is in it → 'loading', never 'inactive'/'non-member' (#321: the
 *     missing rows could be the active one — a partial page proves nothing
 *     about what it didn't carry)
 *   - no row, COMPLETE page          → 'non-member'
 *   - row(s), COMPLETE page, none active → 'inactive'
 *   - row visible but status unreadable → 'loading' (never a claim off a
 *     half-visible row)
 *   - read throws / non-2xx          → 'loading' (fail-safe, NEVER rejects)
 *
 * #321 — this is a (2)-treatment decision, not a (1): the bound (a person's
 * whole rejoin history) is genuinely reachable churn, not a schema-provable
 * ceiling, and the table-gap review flagged this site by name. Rather than a
 * DOM notice (this read backs a banner classification, not a rendered list),
 * the treatment is the tri-state fail-safe itself, extended one step: a
 * TRUNCATED page is treated exactly like a half-visible row already is —
 * evidence too thin to ground a negative claim. `isTruncated` reads the same
 * server `count` every other #321 detector reads, on this SAME request.
 */
export async function resolveMembership(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MembershipState> {
	try {
		const res = await entuFetch(
			cfg.db,
			`entity?_type.string=member&person.reference=${encodeURIComponent(personId)}&props=status&limit=50`,
			cfg.token,
			{},
			fetchImpl
		);
		// FAIL-SAFE VERBATIM: a non-2xx read is 'loading', never 'inactive' — this
		// function must NEVER reject either (see the module doc's tri-state note).
		if (!res.ok) return 'loading';
		const body = (await res.json()) as {
			count?: number;
			entities?: Array<{ status?: Array<{ string?: string }> }>;
		};
		const entities = body.entities ?? [];
		const statuses = entities.map((e) => e.status?.[0]?.string);
		// An active membership is never overridden by a stale archived row, nor
		// by truncation elsewhere in the same page.
		if (statuses.some((s) => s === 'active')) return 'active';
		// #321 — a partial page with no active row visible proves nothing about
		// the rows beyond the cap: 'loading', never 'inactive'/'non-member'.
		if (isTruncated(entities.length, body.count)) return 'loading';
		if (entities.length === 0) return 'non-member';
		// A row this reader can see but whose status came back unreadable (a
		// sharing-tier gap, not a fact) must never be read as a claim — 'loading',
		// never 'inactive'.
		if (statuses.some((s) => s === undefined)) return 'loading';
		return 'inactive';
	} catch {
		return 'loading';
	}
}

// (*MVOX:Josquin*)
