// One event's detail header: own values first, then the series', conductors and rights.
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { resolveConductors } from '$lib/attendance/conductorLogic';
import { listMyProfiles, type MyProfile } from '$lib/profile/profileData';
import { resolveRealNameByPerson } from '$lib/roster/rosterData';
import { deriveListRead, type ListRead } from '$lib/entu/listRead';
import { referenceIds } from '$lib/entu/references';
import type { EventWire, SeasonWire, SeriesWire } from '$lib/entu/wireTypes';
import { reportProblem } from '$lib/problems/reportProblem';

export type EventInheritedField = 'name' | 'durationMinutes' | 'location' | 'description';

export type EventDetail = {
	id: string;
	name: string;
	eventType: string;
	startDatetime: string;
	durationMinutes: number;
	location: string;
	description: string;
	conductorIds: string[];
	conductorNames: string[];
	capacity: number | null;
	// Kept apart from editorIds so callers run manageRightsFrom: an owner also manages.
	ownerIds: string[];
	editorIds: string[];
	seasonId: string | null;
	seasonOwnerIds: string[];
	seasonEditorIds: string[];
	seriesId: string | null;
	// Own value absent and the series' present; a stored '' or 0 blocks inheritance.
	inheritedFields: EventInheritedField[];
};

export class EventDetailLoadError extends Error {
	// 0 when a 2xx response carried no entity.
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'EventDetailLoadError';
		this.status = status;
	}

	// Not readable in this db, so a retry cannot help.
	get unavailable(): boolean {
		return this.status === 0 || this.status === 403 || this.status === 404;
	}
}

type EventRaw = Pick<
	EventWire,
	| '_id'
	| 'event_name'
	| 'event_type'
	| 'start_datetime'
	| 'duration_minutes'
	| 'location'
	| 'description'
	| 'conductor'
	| '_parent'
	| 'capacity'
	| '_owner'
	| '_editor'
>;

type SeasonRaw = Pick<SeasonWire, '_id' | 'conductor' | '_owner' | '_editor'>;

type SeriesRaw = Pick<
	SeriesWire,
	'_id' | 'name' | 'duration_minutes' | 'default_location' | 'default_description'
>;

// Never a private-tier name: it would leak into the conductor line.
function domainOrPublicName(profiles: MyProfile[]): string {
	let domain: MyProfile | undefined;
	let pub: MyProfile | undefined;
	for (const p of profiles) {
		if (p._sharing === 'domain') domain = p;
		else if (p._sharing === 'public') pub = p;
	}
	const domainName = domain?.name.trim() ?? '';
	const publicName = pub?.name.trim() ?? '';
	return domainName !== '' ? domainName : publicName;
}

// Shared with post-write refreshes, so `opts` reaches every read, the real-names overlay too.
export async function loadEventDetail(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<EventDetail> {
	const eventRes = await entuFetch(
		cfg.db,
		`entity/${eventId}?props=event_name,event_type,start_datetime,duration_minutes,location,description,conductor,_parent,capacity,_owner,_editor`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!eventRes.ok)
		throw new EventDetailLoadError(`loadEventDetail failed: ${eventRes.status}`, eventRes.status);
	const eventBody = (await eventRes.json()) as { entity?: EventRaw };
	const event = eventBody.entity;
	if (!event)
		throw new EventDetailLoadError(
			`loadEventDetail: event ${eventId} carried no entity in its response`,
			0
		);

	const parents = event._parent ?? [];
	const seasonId = parents.find((p) => p.entity_type === 'season')?.reference ?? null;
	const seriesId = parents.find((p) => p.entity_type === 'event_series')?.reference ?? null;

	const [season, series] = await Promise.all([
		seasonId ? fetchSeason(cfg, seasonId, fetchImpl, opts) : Promise.resolve(undefined),
		seriesId ? fetchSeries(cfg, seriesId, fetchImpl, opts) : Promise.resolve(undefined)
	]);

	const name = event.event_name?.[0]?.string ?? series?.name?.[0]?.string ?? '';
	const durationMinutes =
		event.duration_minutes?.[0]?.number ?? series?.duration_minutes?.[0]?.number ?? 0;
	const location = event.location?.[0]?.string ?? series?.default_location?.[0]?.string ?? '';
	const description =
		event.description?.[0]?.string ?? series?.default_description?.[0]?.string ?? '';

	// Keyed on `event_name`, not the formula-owned `name`, which always holds a value.
	const inheritedFields: EventInheritedField[] = [];
	if (event.event_name?.[0] === undefined && series?.name?.[0] !== undefined) {
		inheritedFields.push('name');
	}
	if (event.duration_minutes?.[0] === undefined && series?.duration_minutes?.[0] !== undefined) {
		inheritedFields.push('durationMinutes');
	}
	if (event.location?.[0] === undefined && series?.default_location?.[0] !== undefined) {
		inheritedFields.push('location');
	}
	if (event.description?.[0] === undefined && series?.default_description?.[0] !== undefined) {
		inheritedFields.push('description');
	}

	const seasonConductors = referenceIds(season?.conductor);
	const eventConductors = referenceIds(event.conductor);
	// Racing writers can store one person twice; dedupe by id so ids and names stay aligned.
	const conductorIds = [...new Set(resolveConductors(seasonConductors, eventConductors))];

	const profilesById = new Map<string, MyProfile[]>();
	await Promise.all(
		conductorIds.map(async (id) => {
			profilesById.set(id, await listMyProfiles(cfg, id, fetchImpl, opts));
		})
	);
	// Record name if the person has one, else the profile name; a conductor with neither is dropped.
	const recordNameByPerson =
		conductorIds.length === 0
			? new Map<string, string>()
			: (await resolveRealNameByPerson(cfg, fetchImpl, opts)).byPerson;
	const conductorNames = conductorIds
		.map((id) => {
			const recordName = recordNameByPerson.get(id)?.trim();
			return recordName ? recordName : domainOrPublicName(profilesById.get(id) ?? []);
		})
		.filter((resolvedName) => resolvedName !== '');

	const capacity = event.capacity?.[0]?.number ?? null;
	const ownerIds = referenceIds(event._owner);
	const editorIds = referenceIds(event._editor);
	const seasonOwnerIds = referenceIds(season?._owner);
	const seasonEditorIds = referenceIds(season?._editor);

	return {
		id: event._id,
		name,
		eventType: event.event_type?.[0]?.string ?? '',
		startDatetime: event.start_datetime?.[0]?.datetime ?? '',
		durationMinutes,
		location,
		description,
		conductorIds,
		conductorNames,
		capacity,
		ownerIds,
		editorIds,
		seasonId,
		seasonOwnerIds,
		seasonEditorIds,
		seriesId,
		inheritedFields
	};
}

// Under the grants a 403 or 404 is an answer (not readable here), not a failed read.
function reportParentReadFailure(action: string, status: number): void {
	if (status === 403 || status === 404) return;
	reportProblem({ area: 'event', action, error: new Error(`HTTP ${status}`) });
}

// Rights ride on the conductor GET: an unrequested prop reads as "no rights".
async function fetchSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch,
	opts: EntuFetchOptions = {}
): Promise<SeasonRaw | undefined> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seasonId}?props=conductor,_owner,_editor`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) {
		reportParentReadFailure('reading the season', res.status);
		return undefined;
	}
	const body = (await res.json()) as { entity?: SeasonRaw };
	return body.entity;
}

// Feeds a free-text datalist, so truncation is logged, not shown: no option becomes unreachable.
export async function listEventLocations(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<string>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&props=location&limit=1000`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEventLocations failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{ location?: Array<{ string: string }> }>;
	};
	const entities = body.entities ?? [];
	const seen = new Set<string>();
	const items: string[] = [];
	for (const e of entities) {
		const loc = e.location?.[0]?.string ?? '';
		if (loc && !seen.has(loc)) {
			seen.add(loc);
			items.push(loc);
		}
	}
	return deriveListRead(items, entities.length, body.count);
}

async function fetchSeries(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch,
	opts: EntuFetchOptions = {}
): Promise<SeriesRaw | undefined> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seriesId}?props=name,duration_minutes,default_location,default_description`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) {
		reportParentReadFailure('reading the series', res.status);
		return undefined;
	}
	const body = (await res.json()) as { entity?: SeriesRaw };
	return body.entity;
}
