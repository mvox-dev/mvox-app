// src/lib/events/eventDetail.ts
//
// #101 TE.1 — the /event/[id] detail page's data layer: one event, resolved to
// its FULL header shape (name/type/time/duration/location/description/conductor).
//
// Series inheritance is the SAME read-time merge `listRehearsals` performs
// (entuSeasons.ts:104) — event value wins, series fills the gap, else 0/''. Kept
// as its own small merge here rather than reused verbatim: this reads a SINGLE
// event by id (no season-scoped list, no series cache), and additionally carries
// `name`/`description`, which listRehearsals's AgendaItem never needed.
//
// Conductor resolution reuses `resolveConductors` verbatim (#77's model,
// conductorLogic.ts) against the event's own season (read here, not passed in —
// this page has no season list already loaded the way the agenda does).
//
// Conductor NAMES: the SAME domain-or-public scan `toRosterRow` inlines
// (rosterData.ts) — never `resolveField`, never a private-tier name, domain
// preferred when both tiers hold one. A conductor with neither tier's name is
// DROPPED from `conductorNames` (never a raw entity id — "Entity IDs need names"
// cuts both ways), while `conductorIds` keeps every resolved id regardless.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { resolveConductors } from '$lib/attendance/conductorLogic';
import { listMyProfiles, type MyProfile } from '$lib/profile/profileData';

export type EventDetail = {
	id: string;
	/** Event value, else the parent series' name, else ''. */
	name: string;
	/** `event_type` (e.g. 'rehearsal'), verbatim — never inherited. */
	eventType: string;
	/** ISO datetime the event starts, verbatim — never inherited. */
	startDatetime: string;
	/** Event value, else the parent series', else 0. */
	durationMinutes: number;
	/** Event value, else the parent series' `default_location`, else ''. */
	location: string;
	/** Event value, else the parent series' `default_description`, else ''. */
	description: string;
	/** resolveConductors(season.conductor, event.conductor) — every resolved id. */
	conductorIds: string[];
	/** Display names, same order as `conductorIds`; a nameless conductor is dropped. */
	conductorNames: string[];
	/** #102 TE.2 — event.capacity, null when unset (0 is a real, distinct value). */
	capacity: number | null;
	/**
	 * #102 TE.2 — the `_owner` refs VISIBLE to this caller. Same private-bucket
	 * mechanics as `editorIds` below. Carried ALONGSIDE the editors (never
	 * merged into one list) so the caller can run the app's single rights rule,
	 * `manageRightsFrom(owners, editors, personId)` — ownership subsumes editing
	 * (repertoireActions.ts), and an owner-only conductor must not be told she
	 * is not an editor of her own event.
	 */
	ownerIds: string[];
	/**
	 * #102 TE.2 — the `_editor` refs VISIBLE to this caller. Rights props live in
	 * the private bucket (rights-visibility memory note), so a non-granted
	 * reader gets [] — indistinguishable from "no editors set" by design; the
	 * caller only ever uses this to test membership, never to assert the full
	 * editor roster.
	 */
	editorIds: string[];
};

/**
 * #101 review fix (F5) — a load failure that carries WHY it failed, so the page
 * can tell "this event is not visible in the selected collective" (retrying can
 * never help — the id belongs to another db) apart from a transient failure
 * (retry is the right offer). Previously every failure became a bare `Error` and
 * the page offered a Retry button that, after a collective switch, could not
 * possibly succeed.
 */
export class EventDetailLoadError extends Error {
	/** HTTP status of the failing event read; 0 when the response was 2xx but carried no entity. */
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'EventDetailLoadError';
		this.status = status;
	}

	/**
	 * True when THIS id is simply not readable in THIS db — 403 (no rights), 404
	 * (no such entity), or a 2xx that carried no entity at all (status 0). Retry
	 * is futile for all three; the caller should point at the back link instead.
	 */
	get unavailable(): boolean {
		return this.status === 0 || this.status === 403 || this.status === 404;
	}
}

interface EventRaw {
	_id: string;
	name?: Array<{ string: string }>;
	event_type?: Array<{ string: string }>;
	start_datetime?: Array<{ datetime: string }>;
	duration_minutes?: Array<{ number: number }>;
	location?: Array<{ string: string }>;
	description?: Array<{ string: string }>;
	conductor?: Array<{ reference: string }>;
	// Denormalized `entity_type` per parent (same shape RehearsalRaw relies on,
	// seasons/types.ts) — how the season/series parents are told apart without an
	// org arg.
	_parent?: Array<{ reference: string; entity_type?: string }>;
	/** #102 TE.2 — seat capacity, absent/empty means unset. */
	capacity?: Array<{ number: number }>;
	/** #102 TE.2 — rights props; visible only to a caller with rights on this event.
	 *  BOTH tiers are read: the app's rule is owner-OR-editor everywhere else
	 *  (manageRightsFrom, entuSeasons's `_owner,_editor` per season/event). */
	_owner?: Array<{ reference: string }>;
	_editor?: Array<{ reference: string }>;
}

interface SeasonRaw {
	_id: string;
	conductor?: Array<{ reference: string }>;
}

interface SeriesRaw {
	_id: string;
	name?: Array<{ string: string }>;
	duration_minutes?: Array<{ number: number }>;
	default_location?: Array<{ string: string }>;
	default_description?: Array<{ string: string }>;
}

/**
 * Same domain-or-public scan `toRosterRow` inlines (rosterData.ts) — NEVER
 * `resolveField`, NEVER a private-tier name (narrower-wins would let a
 * PRIVATE-only name leak into the conductor line). Domain preferred when both
 * tiers hold a name. '' when neither does — the caller drops that id from
 * `conductorNames`.
 */
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

/**
 * Load ONE event's full detail shape: the event entity, its parent season
 * (conductor source) and parent series (inheritance source), merged per the
 * module doc. Fails loud on a non-2xx event read (no silent empty detail) — the
 * season/series reads are best-effort (a missing/unreadable parent degrades to
 * "nothing to inherit/no conductors from it", never a thrown error, matching
 * `listRehearsals`'s own series-cache posture).
 */
export async function loadEventDetail(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventDetail> {
	const eventRes = await entuFetch(
		cfg.db,
		`entity/${eventId}?props=name,event_type,start_datetime,duration_minutes,location,description,conductor,_parent,capacity,_owner,_editor`,
		cfg.token,
		{},
		fetchImpl
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
	const seasonId = parents.find((p) => p.entity_type === 'season')?.reference ?? '';
	const seriesId = parents.find((p) => p.entity_type === 'event_series')?.reference ?? '';

	const [season, series] = await Promise.all([
		seasonId ? fetchSeason(cfg, seasonId, fetchImpl) : Promise.resolve(undefined),
		seriesId ? fetchSeries(cfg, seriesId, fetchImpl) : Promise.resolve(undefined)
	]);

	const name = event.name?.[0]?.string ?? series?.name?.[0]?.string ?? '';
	const durationMinutes =
		event.duration_minutes?.[0]?.number ?? series?.duration_minutes?.[0]?.number ?? 0;
	const location = event.location?.[0]?.string ?? series?.default_location?.[0]?.string ?? '';
	const description =
		event.description?.[0]?.string ?? series?.default_description?.[0]?.string ?? '';

	const seasonConductors = (season?.conductor ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
	const eventConductors = (event.conductor ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
	const conductorIds = resolveConductors(seasonConductors, eventConductors);

	// One profile read per conductor (genuinely independent, same fan-out shape
	// as loadRoster — rosterData.ts:224-235).
	const profilesById = new Map<string, MyProfile[]>();
	await Promise.all(
		conductorIds.map(async (id) => {
			profilesById.set(id, await listMyProfiles(cfg, id, fetchImpl));
		})
	);
	const conductorNames = conductorIds
		.map((id) => domainOrPublicName(profilesById.get(id) ?? []))
		.filter((resolvedName) => resolvedName !== '');

	// 0 is a real, representable capacity — only an ABSENT prop means "unset".
	const capacity = event.capacity?.[0]?.number ?? null;
	const ownerIds = (event._owner ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
	const editorIds = (event._editor ?? []).flatMap((r) => (r.reference ? [r.reference] : []));

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
		editorIds
	};
}

async function fetchSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch
): Promise<SeasonRaw | undefined> {
	const res = await entuFetch(cfg.db, `entity/${seasonId}?props=conductor`, cfg.token, {}, fetchImpl);
	if (!res.ok) return undefined;
	const body = (await res.json()) as { entity?: SeasonRaw };
	return body.entity;
}

async function fetchSeries(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch
): Promise<SeriesRaw | undefined> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seriesId}?props=name,duration_minutes,default_location,default_description`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) return undefined;
	const body = (await res.json()) as { entity?: SeriesRaw };
	return body.entity;
}

// (*MVOX:Josquin* — #101 TE.1 GREEN)
// (*MVOX:Josquin* — #101 TE.1 review round 2, F5: typed EventDetailLoadError)
// (*MVOX:Byrd* — #102 TE.2 GREEN: capacity + editorIds)
// (*MVOX:Byrd* — #102 TE.2 review F1: ownerIds alongside editorIds — owner-or-editor)
