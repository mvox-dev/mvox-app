// How the landing writes an event's day and time, from the agenda's own formatters.
import { longDayFormatter, type TimeFormat } from '$lib/preferences/timeFormat';
import { timeRange } from '$lib/events/eventTime';
import { eventTypeLabel } from '$lib/events/eventTypeLabels';
import type { AgendaItem } from '$lib/agenda/types';

export function eventDayLine(item: AgendaItem): string {
	const day = longDayFormatter().format(new Date(item.startDatetime));
	return item.eventType ? `${eventTypeLabel(item.eventType)} · ${day}` : day;
}

export function eventTimeLine(item: AgendaItem, mode: TimeFormat): string {
	const time = timeRange(new Date(item.startDatetime), item.durationMinutes, mode);
	return item.location ? `${time} · ${item.location}` : time;
}

// (*MVOX:Josquin*)
