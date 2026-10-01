// A series' defaults, shown as placeholders while the event-create form has that series selected.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from './entuSeasons';

/** `durationMinutes` is null when the series carries none. */
export interface SeriesDefaults {
	name: string;
	durationMinutes: number | null;
	defaultLocation: string;
	defaultDescription: string;
}

interface SeriesDefaultsEntity {
	name?: Array<{ string: string }>;
	default_location?: Array<{ string: string }>;
	default_description?: Array<{ string: string }>;
	duration_minutes?: Array<{ number: number }>;
}

/** The props the read side inherits from a series, so the preview matches what shows later. */
export async function getSeriesDefaults(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeriesDefaults> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seriesId}?props=name,default_location,duration_minutes,default_description`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`getSeriesDefaults failed: ${res.status}`);
	const body = (await res.json()) as { entity?: SeriesDefaultsEntity };
	const entity = body.entity ?? {};
	return {
		name: entity.name?.[0]?.string ?? '',
		durationMinutes: entity.duration_minutes?.[0]?.number ?? null,
		defaultLocation: entity.default_location?.[0]?.string ?? '',
		defaultDescription: entity.default_description?.[0]?.string ?? ''
	};
}
