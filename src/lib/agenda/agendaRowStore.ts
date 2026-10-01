import { dropRows, patchRows, restoreRow, setOrdinals } from '$lib/repertoire/workRowOps';
import type { WorkRow } from '$lib/repertoire/types';
import type { RepertoireRowStore } from '$lib/repertoire/repertoireRowHandlers';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';

export function createAgendaRowStore(ag: AgendaLoadState): RepertoireRowStore {
	function mapRows(update: (rows: WorkRow[], eventId: string) => WorkRow[]) {
		const next: Record<string, WorkRow[]> = {};
		for (const [eventId, rows] of Object.entries(ag.worksByEventId)) {
			next[eventId] = update(rows, eventId);
		}
		ag.worksByEventId = next;
	}

	function findRow(itemId: string): WorkRow | undefined {
		for (const rows of Object.values(ag.worksByEventId)) {
			const hit = rows.find((row) => row.id === itemId);
			if (hit) return hit;
		}
		return undefined;
	}

	function snapshotRow(itemId: string, onlyEventId?: string): () => void {
		const snapshot: Array<{ eventId: string; index: number; row: WorkRow }> = [];
		for (const [eventId, rows] of Object.entries(ag.worksByEventId)) {
			if (onlyEventId !== undefined && eventId !== onlyEventId) continue;
			const index = rows.findIndex((row) => row.id === itemId);
			if (index >= 0) snapshot.push({ eventId, index, row: rows[index] });
		}
		return () => {
			const next = { ...ag.worksByEventId };
			for (const { eventId, index, row } of snapshot) {
				next[eventId] = restoreRow(next[eventId] ?? [], index, row);
			}
			ag.worksByEventId = next;
		};
	}

	return {
		list: (eventId) => ag.worksByEventId[eventId] ?? [],
		find: findRow,
		patch: (itemId, patch) => mapRows((rows) => patchRows(rows, itemId, patch)),
		drop: (itemId, onlyEventId) =>
			mapRows((rows, eventId) =>
				onlyEventId !== undefined && eventId !== onlyEventId ? rows : dropRows(rows, itemId)
			),
		snapshot: snapshotRow,
		setOrdinals: (eventId, ordinalById) =>
			mapRows((rows, id) => (id === eventId ? setOrdinals(rows, ordinalById) : rows))
	};
}
