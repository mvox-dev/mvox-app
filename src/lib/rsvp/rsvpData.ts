// A singer's own rsvp on an event. Member lookup assumes one active member row per person per db.
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import { overwriteEntityValues } from '$lib/entu/replaceProperty';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { deriveListRead, type ListRead } from '$lib/entu/listRead';

export type RsvpStatus = 'going' | 'not_going' | 'maybe' | 'late';

export interface CreateRsvpInput {
	personId: string;
	eventId: string;
	memberId: string;
	status: RsvpStatus;
}

/** A singer's own rsvp as read back for the agenda (#11). */
export interface MyRsvp {
	rsvpId: string;
	eventId: string;
	status: RsvpStatus;
}

/** The row-control's initial state, keyed by event id. */
export type RsvpByEventId = Record<string, { rsvpId: string; status: RsvpStatus }>;

// The singer's active member id, or null with no roster row. Callers that write must not pass
// a cache flag in `opts`: this read is a step inside the rsvp write.
export async function findMyMemberId(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<string | null> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=member&person.reference=${encodeURIComponent(personId)}&status.string=active&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`findMyMemberId failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	return body.entities?.[0]?._id ?? null;
}

// One rsvp per person per event, so limit=1 never truncates and null means no answer.
export async function findMyRsvpForEvent(
	cfg: EntuCfg,
	personId: string,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ rsvpId: string; status: RsvpStatus } | null> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=rsvp&_parent.reference=${encodeURIComponent(personId)}&event.reference=${encodeURIComponent(eventId)}&props=status&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`findMyRsvpForEvent failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string; status?: Array<{ string: string }> }> };
	const row = body.entities?.[0];
	if (!row) return null;
	return { rsvpId: row._id, status: (row.status?.[0]?.string ?? 'going') as RsvpStatus };
}

// Person-lifetime, no season bound: a long-time member can reach the 500 cap, so `truncated`
// tells the agenda its answer set is incomplete.
export async function listMyRsvps(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<MyRsvp>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=rsvp&_parent.reference=${encodeURIComponent(personId)}&props=event,status&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listMyRsvps failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			event?: Array<{ reference: string }>;
			status?: Array<{ string: string }>;
		}>;
	};
	const raw = body.entities ?? [];
	const items = raw.map((r) => ({
		rsvpId: r._id,
		eventId: r.event?.[0]?.reference ?? '',
		status: (r.status?.[0]?.string ?? 'going') as RsvpStatus
	}));
	return deriveListRead(items, raw.length, body.count);
}

// An event without an rsvp is absent from the map, never defaulted to a status.
export function rsvpsByEventId(rsvps: MyRsvp[]): RsvpByEventId {
	const map: RsvpByEventId = {};
	for (const r of rsvps) {
		map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
	}
	return map;
}

// One sentinel, matching `status`. No `_sharing`: Entu copies the person's `domain` at create.
export async function createRsvp(
	cfg: EntuCfg,
	input: CreateRsvpInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const rsvpTypeId = await resolveTypeId(cfg, 'rsvp', fetchImpl);
	const props = [
		{ type: '_type', reference: rsvpTypeId },
		{ type: '_parent', reference: input.personId },
		{ type: 'event', reference: input.eventId },
		{ type: 'member', reference: input.memberId },
		{ type: 'status', string: input.status },
		{ type: `${input.status}_ref`, reference: input.eventId }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createRsvp failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

// One atomic overwrite POST for status and sentinel, so a failed POST leaves the old status.
// A sentinel pairs with any old sentinel; the event id comes from the stored rsvp.
export async function updateRsvpStatus(
	cfg: EntuCfg,
	rsvpId: string,
	status: RsvpStatus,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const getRes = await entuFetch(
		cfg.db,
		`entity/${rsvpId}?props=status,event,going_ref,not_going_ref,maybe_ref,late_ref`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!getRes.ok) throw new Error(`updateRsvpStatus lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as {
		entity?: {
			status?: Array<{ _id: string }>;
			event?: Array<{ reference: string }>;
			going_ref?: Array<{ _id: string }>;
			not_going_ref?: Array<{ _id: string }>;
			maybe_ref?: Array<{ _id: string }>;
			late_ref?: Array<{ _id: string }>;
		};
	};
	const entity = body.entity ?? {};
	const eventId = entity.event?.[0]?.reference ?? '';

	const allSentinels = [
		...(entity.going_ref ?? []),
		...(entity.not_going_ref ?? []),
		...(entity.maybe_ref ?? []),
		...(entity.late_ref ?? [])
	];
	await overwriteEntityValues(
		cfg,
		rsvpId,
		[
			{ value: { type: 'status', string: status }, existing: entity.status ?? [] },
			{ value: { type: `${status}_ref`, reference: eventId }, existing: allSentinels }
		],
		fetchImpl,
		'updateRsvpStatus'
	);
}

// `status` has no "none" value, so deleting the rsvp is how an answer is cleared.
export async function deleteRsvp(
	cfg: EntuCfg,
	rsvpId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${rsvpId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteRsvp failed: ${res.status}`);
}

// (*MVOX:Tallis*)
