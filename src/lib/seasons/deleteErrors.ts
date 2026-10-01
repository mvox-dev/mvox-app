// Delete failures that are not "the write blew up, try again", told apart by their `code`.

// Separate from seasonManage.ts: the agenda spec mocks that module wholesale.
const DELETE_FORBIDDEN = 'entity-delete-forbidden';

// Entu's DELETE needs `_owner` on the target; `_editor` is refused with 403. Nothing was written.
export class EntityDeleteForbiddenError extends Error {
	readonly code = DELETE_FORBIDDEN;

	constructor(readonly entityId: string) {
		super(
			`delete refused: HTTP 403 — the caller is not in entity ${entityId}'s _owner; nothing was deleted`
		);
		this.name = 'EntityDeleteForbiddenError';
	}
}

export type CascadeScope = 'event' | 'series' | 'season';

// The per-scope codes are what crosses the mock boundary in specs and callers.
const CASCADE_PARTIAL: Record<CascadeScope, string> = {
	event: 'event-cascade-partial',
	series: 'series-cascade-partial',
	season: 'season-cascade-partial'
};

const CASCADE_TEXT: Record<CascadeScope, { op: string; unit: string }> = {
	event: { op: 'deleteEvent', unit: 'child entit(ies)' },
	series: { op: 'deleteEventSeries', unit: 'occurrence(s)' },
	season: { op: 'deleteSeason', unit: 'entit(ies)' }
};

// Each cascade deletes children first and stops before the parent, so a retry resumes.
// `failure` is the child rejection; not `cause`, which the runtime may fill.
export class CascadePartialError extends Error {
	readonly code: string;

	constructor(
		readonly scope: CascadeScope,
		readonly id: string,
		readonly deletedCount: number,
		readonly totalCount: number,
		readonly failure: unknown
	) {
		const { op, unit } = CASCADE_TEXT[scope];
		super(
			`${op}: cascade stopped after ${deletedCount} of ${totalCount} ${unit} of ${scope} ${id}; the ${scope} was NOT deleted`
		);
		this.code = CASCADE_PARTIAL[scope];
		this.name = 'CascadePartialError';
	}
}

// series → occurrence → its children nest three deep; bounded so a self-referential chain ends.
const FAILURE_CHAIN_DEPTH = 5;

// Duck-typed on `code`: reasons cross mock boundaries as plain tagged objects.
export function isDeleteForbidden(reason: unknown): boolean {
	let node = reason as { code?: unknown; failure?: unknown } | null | undefined;
	for (let depth = 0; depth < FAILURE_CHAIN_DEPTH && node; depth += 1) {
		if (node.code === DELETE_FORBIDDEN) return true;
		node = node.failure as { code?: unknown; failure?: unknown } | null | undefined;
	}
	return false;
}

export function isCascadePartial(reason: unknown, scope: CascadeScope): boolean {
	return (reason as { code?: unknown } | null | undefined)?.code === CASCADE_PARTIAL[scope];
}

export interface DeleteFailure {
	reason: 'write' | 'forbidden' | 'partial' | 'partial-season';
	deleted?: number;
	total?: number;
}

// A season's own cascade gets 'partial-season'; a series cascade inside it stays 'partial'.
export function classifyDeleteFailure(
	target: 'event' | 'series' | 'season',
	reason: unknown
): DeleteFailure {
	if (isDeleteForbidden(reason)) return { reason: 'forbidden' };
	const counts = reason as { deletedCount?: number; totalCount?: number } | null | undefined;
	const deleted = counts?.deletedCount ?? 0;
	const total = counts?.totalCount ?? 0;
	if (target === 'season' && isCascadePartial(reason, 'season')) {
		return { reason: 'partial-season', deleted, total };
	}
	if (isCascadePartial(reason, target === 'event' ? 'event' : 'series')) {
		return { reason: 'partial', deleted, total };
	}
	return { reason: 'write' };
}

// (*MVOX:Palestrina*)
