// Entity shapes and helpers the season list, edit and delete modules share.
import type { EventWire, SeriesWire } from '$lib/entu/wireTypes';

export type SeriesEntity = Pick<SeriesWire, '_id' | 'name' | '_owner'>;

export type EventEntity = Pick<EventWire, '_id' | 'event_name' | 'start_datetime' | '_parent'>;

export function seriesRefOf(event: EventEntity): string | undefined {
	return (event._parent ?? []).find((p) => p.entity_type === 'event_series')?.reference;
}
