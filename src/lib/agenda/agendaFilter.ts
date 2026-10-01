// The agenda's type-filter buckets and location suggestions, read off the loaded rows.
import { CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
import type { AgendaItem } from '$lib/agenda/types';

export type AgendaFilterBucket = (typeof CANONICAL_EVENT_TYPES)[number];
export type AgendaTypeFilter = 'all' | AgendaFilterBucket;

const CANONICAL_EVENT_TYPE_SET = new Set<string>(CANONICAL_EVENT_TYPES);

export function agendaFilterBucketOf(eventType: string | undefined): AgendaFilterBucket {
	const type = eventType ?? '';
	if (type !== 'other' && CANONICAL_EVENT_TYPE_SET.has(type)) return type as AgendaFilterBucket;
	return 'other';
}

export function agendaFilterChipsOf(
	agendaItems: readonly AgendaItem[],
	recentItems: readonly AgendaItem[]
): AgendaFilterBucket[] {
	const present = new Set<AgendaFilterBucket>();
	for (const it of agendaItems) present.add(agendaFilterBucketOf(it.eventType));
	for (const it of recentItems) present.add(agendaFilterBucketOf(it.eventType));
	return CANONICAL_EVENT_TYPES.filter((type) => present.has(type));
}

export function filterAgendaItems(items: AgendaItem[], filter: AgendaTypeFilter): AgendaItem[] {
	return filter === 'all' ? items : items.filter((it) => agendaFilterBucketOf(it.eventType) === filter);
}

export function locationSuggestionsOf(
	recentItems: readonly AgendaItem[],
	agendaItems: readonly AgendaItem[]
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const it of [...recentItems, ...agendaItems]) {
		if (it.location && !seen.has(it.location)) {
			seen.add(it.location);
			out.push(it.location);
		}
	}
	return out;
}
