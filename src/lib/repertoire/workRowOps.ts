// Pure edits of one work-row list; the agenda maps them over every event's list.
import type { WorkRow } from '$lib/repertoire/types';

export const reorderKey = (eventId: string) => `move:${eventId}`;

export function patchRows(rows: WorkRow[], itemId: string, patch: Partial<WorkRow>): WorkRow[] {
	return rows.map((row) => (row.id === itemId ? { ...row, ...patch } : row));
}

export function dropRows(rows: WorkRow[], itemId: string): WorkRow[] {
	return rows.filter((row) => row.id !== itemId);
}

export function restoreRow(rows: WorkRow[], index: number, row: WorkRow): WorkRow[] {
	if (rows.some((r) => r.id === row.id)) return rows;
	const next = [...rows];
	next.splice(Math.min(index, next.length), 0, row);
	return next;
}

export function setOrdinals(rows: WorkRow[], ordinalById: Map<string, number>): WorkRow[] {
	return rows.map((row) =>
		ordinalById.has(row.id) ? { ...row, ordinal: ordinalById.get(row.id)! } : row
	);
}
