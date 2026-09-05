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
const SECTION_NOT_EMPTY = 'section-not-empty';

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

// ── #253 — the reparent/renumber partial-write evidence ─────────────────────
//
// A section indent/unindent is TWO writes (`performReparent`, roster/+page.svelte):
// `reparentSection` moves the `_parent` reference, then `reorderSections`
// renumbers the destination sibling group. Either can fail non-2xx, and until
// now both discarded the response BODY — only the numeric HTTP status
// survived (sectionActions.ts, every throw at the GET/POST/DELETE steps).
// Every real occurrence was therefore unverifiable after the fact: no rate-
// limit text, no rights-refusal reason, no validation message, just a status
// number in a caught `Error` the page's catch block re-threw as one flat
// "reorder failed" log line.
//
// House precedent for a typed partial-progress error: `SeriesCascadePartialError`
// (seasons/deleteErrors.ts, deletedCount/totalCount) and `ProfileSaveError`
// (profile/applyProfileSave.ts, createdProfileId) — both carry HOW FAR a
// multi-step write got before it stopped. This is that shape for the
// reparent/renumber pair, plus the status+body evidence #253 asked for.
//
// Duck-typed the same way as the other errors here: the roster page's
// integration spec mocks `$lib/sections/sectionActions` wholesale, so a mocked
// rejection crosses as a plain tagged object, never `instanceof`-checkable.

/** Discriminator carried on a reparent/renumber write that stopped part-way. */
export const SECTION_REPARENT_PARTIAL = 'section-reparent-partial';

/**
 * Thrown by `reparentSection` (step `'reparent'`) and `reorderSections`
 * (step `'renumber'`) on any non-2xx. `renumberedCount`/`totalCount` are the
 * renumber loop's progress — sections FULLY renumbered (POST landed AND its
 * old value deleted) versus the sibling-group size; both are `0` for step
 * `'reparent'` (the renumber never began). `status` is the non-2xx HTTP
 * status; `body` is the response text, read defensively (`''` when the body
 * itself cannot be read — a broken stream must not mask the status).
 */
export class SectionReparentPartialError extends Error {
	readonly code = SECTION_REPARENT_PARTIAL;

	constructor(
		readonly step: 'reparent' | 'renumber',
		readonly renumberedCount: number,
		readonly totalCount: number,
		readonly status: number,
		readonly body: string
	) {
		super(
			step === 'renumber'
				? `reorderSections: renumber failed after ${renumberedCount} of ${totalCount} section(s): HTTP ${status}`
				: `reparentSection: reparent failed: HTTP ${status}`
		);
		this.name = 'SectionReparentPartialError';
	}
}

/**
 * True when a rejection reason is a `SectionReparentPartialError` (or the
 * plain tagged object a mocked write layer rejects with in its place). Duck-
 * typed on `code`, same reason as `isSectionMembershipMissing`/`isSectionNotEmpty`.
 */
export function isSectionReparentPartial(
	reason: unknown
): reason is SectionReparentPartialError {
	return (reason as { code?: unknown } | null | undefined)?.code === SECTION_REPARENT_PARTIAL;
}

// (*MVOX:Palestrina* — F1 code-review fix, TS.2/#96)
// (*MVOX:Palestrina* — #110 review F3: SectionNotEmptyError)
// (*MVOX:Palestrina* — GREEN implementation, #253: SectionReparentPartialError)
