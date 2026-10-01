// Season, series and event rows as Entu returns them; each reader Picks the props it asks for.
export interface ParentRef {
	reference: string;
	entity_type?: string;
}

export interface NamedValue {
	string: string;
}

// Rights props sit in the private bucket: a caller without a grant reads the row but not these.
export interface RightsRefs {
	_owner?: Array<{ reference?: string }>;
	_editor?: Array<{ reference?: string }>;
}

export interface SeasonWire extends RightsRefs {
	_id: string;
	name?: NamedValue[];
	start_date?: Array<{ date: string }>;
	end_date?: Array<{ date: string }>;
	conductor?: Array<{ reference: string }>;
}

export interface SeriesWire extends RightsRefs {
	_id: string;
	name?: NamedValue[];
	duration_minutes?: Array<{ number: number }>;
	default_location?: NamedValue[];
	default_description?: NamedValue[];
}

export interface EventWire extends RightsRefs {
	_id: string;
	event_name?: NamedValue[];
	event_type?: NamedValue[];
	start_datetime?: Array<{ datetime: string }>;
	duration_minutes?: Array<{ number: number }>;
	location?: NamedValue[];
	description?: NamedValue[];
	capacity?: Array<{ number: number }>;
	conductor?: Array<{ reference: string }>;
	_parent?: ParentRef[];
}
