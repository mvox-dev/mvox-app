// Section write failures told apart by their `code`; own module because specs mock sectionActions.
import { hasErrorCode } from '$lib/errorCode';

export const SECTION_PARENT_MISSING = 'section-parent-missing';

// The membership is already gone server-side, so the caller reconciles forward, not reverts.
export class SectionMembershipMissingError extends Error {
	readonly code = SECTION_PARENT_MISSING;

	constructor(memberId: string, sectionId: string) {
		super(
			`unassignMemberSection: member ${memberId} has no section _parent value matching ${sectionId}`
		);
		this.name = 'SectionMembershipMissingError';
	}
}

export function isSectionMembershipMissing(reason: unknown): boolean {
	return hasErrorCode(reason, SECTION_PARENT_MISSING);
}

const SECTION_NOT_EMPTY = 'section-not-empty';

// Entu's delete strips every reference to the section, so a non-empty section is refused
// server-side: the roster on screen is narrowed and as old as the tab.
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

export function isSectionNotEmpty(reason: unknown): boolean {
	return hasErrorCode(reason, SECTION_NOT_EMPTY);
}

export const SECTION_REPARENT_PARTIAL = 'section-reparent-partial';

// renumberedCount counts entities whose POST and cleanup both landed; body is '' when unreadable.
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
				? `renumberDisplayOrder: renumber failed after ${renumberedCount} of ${totalCount}: HTTP ${status}`
				: `reparentSection: reparent failed: HTTP ${status}`
		);
		this.name = 'SectionReparentPartialError';
	}
}

export function isSectionReparentPartial(
	reason: unknown
): reason is SectionReparentPartialError {
	return hasErrorCode(reason, SECTION_REPARENT_PARTIAL);
}

export const SECTION_PARENT_DAMAGED = 'section-parent-damaged';

// Thrown before any write: the overwrite-POST is only well-defined against exactly one value.
export class SectionParentDamagedError extends Error {
	readonly code = SECTION_PARENT_DAMAGED;

	constructor(
		readonly sectionId: string,
		readonly valueCount: number
	) {
		super(
			`reparentSection: section ${sectionId} holds ${valueCount} _parent value(s) — exactly one required (damaged data); nothing was written`
		);
		this.name = 'SectionParentDamagedError';
	}
}

export function isSectionParentDamaged(reason: unknown): reason is SectionParentDamagedError {
	return hasErrorCode(reason, SECTION_PARENT_DAMAGED);
}

// (*MVOX:Josquin*)
