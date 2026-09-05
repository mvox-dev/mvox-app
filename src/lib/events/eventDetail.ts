// src/lib/events/eventDetail.ts
//
// #101 TE.1 — the /event/[id] detail page's data layer: one event, resolved to
// its FULL header shape (name/type/time/duration/location/description/conductor).
//
// Series inheritance is the SAME read-time merge `listEvents` performs
// (entuSeasons.ts:104) — event value wins, series fills the gap, else 0/''. Kept
// as its own small merge here rather than reused verbatim: this reads a SINGLE
// event by id (no season-scoped list, no series cache), and additionally carries
// `name`/`description`, which listEvents's AgendaItem never needed.
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
	/**
	 * #103 TE.3 — the parent SEASON's id, null when the event has no season
	 * parent (or it is not visible). Already known from the event's `_parent`
	 * read; surfaced instead of discarded so no caller has to GET the same
	 * entity a second time just to learn it.
	 */
	seasonId: string | null;
	/**
	 * #103 TE.3 — the parent season's `_owner`/`_editor` refs VISIBLE to this
	 * caller, same private-bucket mechanics as `ownerIds`/`editorIds` above.
	 * The season entity is ALREADY read here (conductor source), so its rights
	 * props ride along on that same GET: the caller runs `manageRightsFrom`
	 * over them as pure computation and spends no round-trip resolving season
	 * management rights (#91 review F1's rule, applied to one event instead of
	 * 500). [] whenever `seasonId` is null or the season read failed.
	 */
	seasonOwnerIds: string[];
	seasonEditorIds: string[];
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
	// Denormalized `entity_type` per parent (same shape EventRaw relies on,
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
	/** #103 TE.3 — the season's rights tiers, read on the SAME GET the conductor
	 *  list comes from; private-bucket, so a non-granted reader gets neither. */
	_owner?: Array<{ reference: string }>;
	_editor?: Array<{ reference: string }>;
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
 * `listEvents`'s own series-cache posture).
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
	// null (not '') is the surfaced "no season parent" — `seasonId` is part of
	// the returned contract now, and '' would read as a real id to a caller.
	const seasonId = parents.find((p) => p.entity_type === 'season')?.reference ?? null;
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
	const seasonOwnerIds = (season?._owner ?? []).flatMap((r) => (r.reference ? [r.reference] : []));
	const seasonEditorIds = (season?._editor ?? []).flatMap((r) => (r.reference ? [r.reference] : []));

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
		seasonEditorIds
	};
}

/**
 * The parent season: conductor source AND (since #103 TE.3) season-rights
 * source. `_owner`/`_editor` are asked for on this SAME GET — an unrequested
 * prop comes back absent, which every caller would read as "no rights", and a
 * second `entity/{seasonId}?props=_owner,_editor` round-trip to learn what this
 * read could have carried is the per-entity rights fan-out #91 review F1
 * removed from the agenda.
 */
async function fetchSeason(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch
): Promise<SeasonRaw | undefined> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seasonId}?props=conductor,_owner,_editor`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) return undefined;
	const body = (await res.json()) as { entity?: SeasonRaw };
	return body.entity;
}

/**
 * #248 — the detail route's location-suggestion corpus. This route holds no
 * multi-event location list in memory (unlike the agenda page's
 * agendaItems/recentItems — see page.location-datalist.spec.ts's header), so
 * per the PO ruling (option c) the corpus is fetched, but the CALLER decides
 * when: this function itself fires unconditionally on every call — the
 * lazy-on-first-focus / single-flight discipline lives in the page (a request
 * a caller never makes is the only kind that never happens on page load).
 *
 * Collective-scoped (db-scoped — "collective = database", databaseEntity.ts —
 * a single-collective db has no narrower org to filter by), existing entu list
 * shape (Path C: entuFetch only), smallest projection (`location` alone).
 * De-duplicated and blank-dropped HERE (not left to the caller) since a
 * suggestion corpus is the only thing this read is for. Ordering is whatever
 * the wire returns — not pinned, matching the spec's SORTED-comparison-only
 * assertions.
 */
export async function listEventLocations(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&props=location&limit=1000`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEventLocations failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ location?: Array<{ string: string }> }> };
	const entities = body.entities ?? [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const e of entities) {
		const loc = e.location?.[0]?.string ?? '';
		if (loc && !seen.has(loc)) {
			seen.add(loc);
			out.push(loc);
		}
	}
	return out;
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
// (*MVOX:Palestrina* — #103 TE.3 review round 2, F1/F2: seasonId + season rights
//  on the one read that already happened; loadEventSeasonId deleted)
