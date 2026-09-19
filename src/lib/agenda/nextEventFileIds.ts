// #409 — THE one definition of "the next event's parts", as file-property
// ids. Exported as its own helper because two issues consume the SAME set —
// #409 (prefetch these on app open) and #410 (exempt these from
// storage-pressure eviction) — and the set must never be defined twice.
//
// Contract (pinned in nextEventFileIds.spec.ts): the next event is
// agendaItems[0] and nothing else (agendaItems is chronological-ascending,
// soonest upcoming first); its parts are worksByEventId[agendaItems[0].id]'s
// rows' non-empty fileIds IN ROW ORDER; empty agenda or unresolved rows → [].
import type { AgendaItem } from './types';
import type { WorkRow } from '$lib/repertoire/types';

export function nextEventFileIds(
	agendaItems: AgendaItem[],
	worksByEventId: Record<string, WorkRow[]>
): string[] {
	const nextEvent = agendaItems[0];
	if (!nextEvent) return [];
	const rows = worksByEventId[nextEvent.id];
	if (!rows) return [];
	return rows.map((row) => row.fileId).filter((fileId) => fileId !== '');
}

// (*MVOX:Tallis*)
