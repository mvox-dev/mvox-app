// TS.2/#96 code-review fix (F1) — the ONE unassign failure that means the SERVER
// HAS ALREADY CONVERGED, told apart from every other failure.
//
// `unassignMemberSection` fails loud when the member holds no section `_parent`
// value for the section being removed (a stale row: a concurrent admin already
// removed it, or the tab has been open a while). That rejection is NOT a failed
// write — the server state is exactly what the optimistic UI just moved to. The
// roster page deliberately never refetches (`loadRoster` runs once, per the
// slice contract), so reverting on it would pin a membership the server does not
// have on screen until a manual reload. Every OTHER rejection (network, 4xx/5xx
// on the lookup GET or the property DELETE) does mean the write never landed and
// must revert.
//
// Lives in its OWN module, not in `sectionActions.ts`: the roster page's
// integration spec replaces `$lib/sections/sectionActions` wholesale with a
// `vi.mock` factory, so anything the page imported from there would be
// `undefined` under test. Importing the discriminator from here keeps ONE
// source of truth for the code string with no mock-shaped coupling.

/** Discriminator carried on the fail-loud "membership already gone" rejection. */
export const SECTION_PARENT_MISSING = 'section-parent-missing';

/**
 * Thrown by `unassignMemberSection` when the member has no matching section
 * `_parent` value. Message is unchanged from the plain-`Error` original (it
 * names both member and section, and the write-layer spec pins it); the `code`
 * is what lets a caller reconcile FORWARD instead of reverting.
 */
export class SectionMembershipMissingError extends Error {
	readonly code = SECTION_PARENT_MISSING;

	constructor(memberId: string, sectionId: string) {
		super(
			`unassignMemberSection: member ${memberId} has no section _parent value matching ${sectionId}`
		);
		this.name = 'SectionMembershipMissingError';
	}
}

/**
 * True when a rejection reason means the membership was already absent
 * server-side. Duck-typed on `code` rather than `instanceof`: rejection reasons
 * cross a `Promise.allSettled` boundary as `unknown`, and the roster spec's
 * mocked write layer rejects with a plain tagged object.
 */
export function isSectionMembershipMissing(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === SECTION_PARENT_MISSING;
}

// ── #110 review F3: the section-delete emptiness refusal ────────────────────────
//
// `deleteSection` verifies server-side that the section holds NOTHING before it
// deletes. The page's `canRemove` gate cannot carry that on its own, for two
// structural reasons:
//
//   - `group.memberCount` counts the ROSTER's rows, and the roster is a
//     deliberately NARROWED set — `loadRoster` queries `status.string=active`
//     only and `toRosterRow` drops every name-incomplete member (the #28
//     completeness gate). A section whose only occupants are inactive or
//     nameless therefore reads "(0)" on screen and offers the remove control.
//   - the page never refetches, so the tree it gates on is as old as the tab: a
//     member (or a sub-section) added by anyone else since load is invisible to
//     it.
//
// Entu's delete "soft-deletes all properties across all entities referencing the
// deleted entity" (entu/www docs, db-mutations "Deletion"), and section
// membership IS a member `_parent` reference — so a wrongly-permitted delete
// silently strips those members' section assignment with nothing on screen
// saying it happened. The refusal is a TAGGED rejection so the caller can say
// "that section is not empty" instead of the generic write-failed message.

/** Discriminator carried on the fail-loud "section still has children" rejection. */
export const SECTION_NOT_EMPTY = 'section-not-empty';

/**
 * Thrown by `deleteSection` when the server still reports members and/or
 * sub-sections parented to the section. NOTHING has been written when this
 * throws — the DELETE never fires.
 */
export class SectionNotEmptyError extends Error {
	readonly code = SECTION_NOT_EMPTY;

	constructor(
		readonly sectionId: string,
		readonly memberCount: number,
		readonly childSectionCount: number
	) {
		super(
			`deleteSection: section ${sectionId} is not empty — ${memberCount} member(s) and ${childSectionCount} sub-section(s) are still parented to it; nothing was deleted`
		);
		this.name = 'SectionNotEmptyError';
	}
}

/**
 * True when a rejection reason means the delete was REFUSED because the section
 * still holds members/sub-sections (nothing was written). Duck-typed on `code`
 * for the same reason `isSectionMembershipMissing` is — the roster spec's mocked
 * write layer rejects with a plain tagged object.
 */
export function isSectionNotEmpty(reason: unknown): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === SECTION_NOT_EMPTY;
}

// (*MVOX:Palestrina* — F1 code-review fix, TS.2/#96)
// (*MVOX:Palestrina* — #110 review F3: SectionNotEmptyError)
