// Entity shapes and helpers the season list, edit and delete modules share.
export interface ParentRef {
	reference: string;
	entity_type?: string;
}

export interface SeriesEntity {
	_id: string;
	name?: Array<{ string: string }>;
	_owner?: Array<{ reference?: string }>;
}

/** `.reference` only, never `.string`: the reference string bakes a display name (PII). */
export function ownerIdsOf(series: SeriesEntity): string[] {
	return (series._owner ?? []).flatMap((o) => (o.reference ? [o.reference] : []));
}

export interface EventEntity {
	_id: string;
	event_name?: Array<{ string: string }>;
	start_datetime?: Array<{ datetime: string }>;
	_parent?: ParentRef[];
}

/** The event's event_series parent, if it has one — absence marks it standalone. */
export function seriesRefOf(event: EventEntity): string | undefined {
	return (event._parent ?? []).find((p) => p.entity_type === 'event_series')?.reference;
}
