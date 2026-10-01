// Pending bookkeeping for repertoire move/remove writes, shared by the agenda and the event page.
import type { WorkRow } from '$lib/repertoire/types';
import { reorderKey } from '$lib/repertoire/workRowOps';
import { createWriteTokens } from '$lib/net/writeTokens';

export interface PendingMarks {
	mark(key: string, rowIds: string[]): void;
	setPending(keys: ReadonlySet<string>, key: string, pending: boolean): Set<string>;
	isCurrent(key: string): boolean;
	settle(key: string): boolean;
}

/** `context` names what a write belongs to; a settle in another context applies nothing. */
export function createPendingMarks<T>(
	context: () => T | null,
	same: (a: T, b: T) => boolean = Object.is
): PendingMarks {
	const marks = new Map<string, string[]>();
	const tokens = createWriteTokens<string, T>(context, same);
	return {
		mark(key, rowIds) {
			marks.set(key, rowIds);
		},
		setPending(keys, key, pending) {
			if (pending) tokens.begin(key);
			const next = new Set(keys);
			for (const mark of [key, ...(marks.get(key) ?? [])]) {
				if (pending) next.add(mark);
				else next.delete(mark);
			}
			return next;
		},
		isCurrent: (key) => tokens.isCurrent(key),
		settle(key) {
			marks.delete(key);
			return tokens.end(key);
		}
	};
}

/** A row with a write in flight keeps its on-screen value; a row only the reorder covers and
 *  the screen lacks yet (a fresh add) is shown as read. */
export function mergePendingRows(
	fresh: readonly WorkRow[],
	live: readonly WorkRow[],
	isPending: (key: string) => boolean,
	eventId: string
): WorkRow[] {
	const reorderPending = isPending(reorderKey(eventId));
	const out: WorkRow[] = [];
	for (const row of fresh) {
		const rowPending = isPending(row.id);
		if (!rowPending && !(reorderPending && row.kind === 'program')) {
			out.push(row);
			continue;
		}
		const liveRow = live.find((r) => r.id === row.id);
		if (liveRow) out.push(liveRow);
		else if (!rowPending) out.push(row);
	}
	return out;
}
