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

// (*MVOX:Palestrina* — F1 code-review fix, TS.2/#96)
