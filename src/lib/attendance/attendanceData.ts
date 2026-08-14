import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { RsvpStatus } from '$lib/rsvp/rsvpData';

// #84 TA.3 GREEN — the attendance write/read data layer. Mirrors rsvpData.ts
// EXACTLY, with the structural differences pinned by #77's ruling:
//
//   - `attendance` is a CHILD OF EVENT (`_parent` = eventId) — the conductor
//     records it, so it hangs off the event, not the singer's person (the
//     participation split: rsvp child-of-person/member-created, attendance
//     child-of-event/conductor-created).
//   - status enum is present | absent | late (three, not four).
//   - three sentinels: present_ref / absent_ref / late_ref, each carrying the
//     EVENT id as reference — for attendance the event IS `_parent`, so the
//     sentinel's reference and the parent coincide (unlike rsvp, where the
//     sentinel points at the separate `event` prop).
//   - `_sharing: domain` EXPLICIT at create time per v4E (#82 widen: the whole
//     collective may see who showed up, and the singer can read her own row).
//   - per-tap immediate writes — NOT batch. Each toggle tap is one createAttendance /
//     updateAttendanceStatus / deleteAttendance round-trip; there is no "save all"
//     payload shape anywhere in this module's API.

export type AttendanceStatus = 'present' | 'absent' | 'late';

export interface CreateAttendanceInput {
	eventId: string;
	memberId: string;
	status: AttendanceStatus;
}

/** One attendance record as read back for the conductor's panel (#84). */
export interface EventAttendance {
	attendanceId: string;
	memberId: string;
	status: AttendanceStatus;
}

/** The panel's per-member initial state, keyed by member id. */
export type AttendanceByMemberId = Record<string, { attendanceId: string; status: AttendanceStatus }>;

/**
 * One attendance record as read back for the SINGER's own "my attendance" line
 * (#85 TA.4). The inverse shape of {@link EventAttendance}: there `memberId`
 * rides along (one event, many members); here `eventId` rides along (one
 * member, many events) — read off `_parent`, since attendance's parent IS the
 * event (#77 participation split).
 */
export interface MyAttendance {
	attendanceId: string;
	eventId: string;
	status: AttendanceStatus;
}

/** One rsvp row as read for the conductor's RSVP→attendance comparison (#84). */
export interface RsvpForEvent {
	rsvpId: string;
	memberId: string;
	status: RsvpStatus;
}

/**
 * Create a new attendance record under the EVENT (`_parent` = eventId — the
 * participation split: attendance is conductor-created, hangs off the event, not
 * the singer's person). Sends `_type` as a resolved `reference` (never `string` —
 * #10 pinned wire-shape), plus the ONE sentinel matching `status`; the other two
 * sentinels are simply absent (a fresh create has no stale values to clear).
 *
 * explicit `{ type: '_sharing', string: 'domain' }` required (#133 audit) — KEEP,
 * do not remove: the parent here is the EVENT, which is NOT a uniformly-domain
 * tier (21 live events are domain, one — 6a7a164e23dc1d97bb8f18a1 'Test
 * rehearsal' — is public). Public wins at Entu's create-time copy, so an
 * attendance created under a public event would inherit `public`;
 * aggregate.js:269 then drops the domain bucket, and since member/status are
 * domain-tier prop-defs they'd become unreadable via listAttendance/
 * listMyAttendance. The explicit `domain` pins the intended tier regardless of
 * the parent event's own tier — public concert events are a legitimate product
 * state, so this pin is not redundant. `domain` is also the intended visibility
 * per the #82 widen: the whole collective may see who showed up, and the singer
 * can read her own row.
 */
export async function createAttendance(
	cfg: EntuCfg,
	input: CreateAttendanceInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const attendanceTypeId = await resolveTypeId(cfg, 'attendance', fetchImpl);
	// One sentinel (`<status>_ref`) matching the chosen status, carrying the EVENT
	// id — which IS `_parent` here (unlike rsvp, there is no separate `event` prop).
	// The other two sentinels are simply absent on a fresh create. Explicit
	// `_sharing: domain` pins the tier because the parent event tier is NOT
	// uniform (#133 — see the JSDoc above).
	const props = [
		{ type: '_type', reference: attendanceTypeId },
		{ type: '_parent', reference: input.eventId },
		{ type: 'member', reference: input.memberId },
		{ type: 'status', string: input.status },
		{ type: `${input.status}_ref`, reference: input.eventId },
		{ type: '_sharing', string: 'domain' }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createAttendance failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

/**
 * Change an existing attendance's status. Reads the current entity (status +
 * `_parent` + all three sentinel value-ids), deletes the old status value AND
 * every existing sentinel value found, then writes the new status + its matching
 * sentinel. The sentinel's event reference is sourced from the GET's `_parent`
 * (attendance's parent IS the event) — this function only ever receives a status
 * change, not an event.
 */
export async function updateAttendanceStatus(
	cfg: EntuCfg,
	attendanceId: string,
	status: AttendanceStatus,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const getRes = await entuFetch(
		cfg.db,
		`entity/${attendanceId}?props=status,_parent,present_ref,absent_ref,late_ref`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!getRes.ok) throw new Error(`updateAttendanceStatus lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as {
		entity?: {
			status?: Array<{ _id: string }>;
			_parent?: Array<{ reference: string }>;
			present_ref?: Array<{ _id: string }>;
			absent_ref?: Array<{ _id: string }>;
			late_ref?: Array<{ _id: string }>;
		};
	};
	const entity = body.entity ?? {};
	// Sentinel event reference comes from the stored attendance's `_parent`, never
	// the caller — this function only ever takes a status change.
	const eventId = entity._parent?.[0]?.reference;
	if (!eventId) throw new Error('updateAttendanceStatus: _parent reference missing — cannot write sentinel');

	// GENERIC delete: the old status value AND every sentinel value-id that exists,
	// not just the one we expect. If corrupted state left two sentinels set, both go
	// — otherwise an orphan would survive as a phantom count.
	const toDelete = [
		...(entity.status ?? []),
		...(entity.present_ref ?? []),
		...(entity.absent_ref ?? []),
		...(entity.late_ref ?? [])
	];
	for (const value of toDelete) {
		const delRes = await entuFetch(
			cfg.db,
			`property/${value._id}`,
			cfg.token,
			{ method: 'DELETE' },
			fetchImpl
		);
		if (!delRes.ok) throw new Error(`updateAttendanceStatus delete failed: ${delRes.status}`);
	}

	const postRes = await entuFetch(
		cfg.db,
		`entity/${attendanceId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				{ type: 'status', string: status },
				{ type: `${status}_ref`, reference: eventId }
			])
		},
		fetchImpl
	);
	if (!postRes.ok) throw new Error(`updateAttendanceStatus POST failed: ${postRes.status}`);
}

/**
 * Clear an attendance (tap-active-to-toggle-off). The `status` enum has no "none"
 * value, so deletion IS the "no record" representation — this is also what keeps
 * the three sentinels from surviving as orphan phantom counts.
 */
export async function deleteAttendance(
	cfg: EntuCfg,
	attendanceId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(
		cfg.db,
		`entity/${attendanceId}`,
		cfg.token,
		{ method: 'DELETE' },
		fetchImpl
	);
	if (!res.ok) throw new Error(`deleteAttendance failed: ${res.status}`);
}

/**
 * List every attendance record for one event. `attendance` is a child of
 * `event` — scoping by `_parent.reference=eventId` alone is the whole query, the
 * exact mirror of `listMyRsvps`' child-of-person scoping.
 */
export async function listAttendance(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventAttendance[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=attendance&_parent.reference=${encodeURIComponent(eventId)}&props=member,status&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listAttendance failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			member?: Array<{ reference: string }>;
			status?: Array<{ string: string }>;
		}>;
	};
	return (body.entities ?? []).flatMap((raw) => {
		const memberId = raw.member?.[0]?.reference;
		const status = raw.status?.[0]?.string as AttendanceStatus | undefined;
		if (!memberId || !status) {
			// Fail loudly: a row with no member or no status means the caller cannot
			// see the private bucket (prop-def _sharing not widened). Drop the row and
			// log — never fabricate a memberId or default a status, which would collapse
			// all invisible rows onto key '' and stamp them with a lie (#84 review).
			console.warn(
				`listAttendance: dropping entity ${raw._id} — missing ${!memberId ? 'member' : ''}${!memberId && !status ? '+' : ''}${!status ? 'status' : ''} (prop-def _sharing not domain?)`
			);
			return [];
		}
		return [{ attendanceId: raw._id, memberId, status }];
	});
}

/**
 * List the SINGER's own attendance records across ALL events (#85 TA.4 — the
 * "my attendance" line). `attendance` is a child of EVENT, so this can NOT be
 * scoped by `_parent.reference` (that would scope to one event) — it filters
 * by the `member` REFERENCE prop instead, and the event id is read back off
 * each row's `_parent` (attendance's parent IS the event). Mirrors
 * `listMyRsvps`' role for rsvp, with the participation split flipped: there
 * rsvp is child-of-person (`_parent` scoping); here attendance is
 * child-of-event (`member.reference` scoping).
 */
export async function listMyAttendance(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<MyAttendance[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=attendance&member.reference=${encodeURIComponent(memberId)}&props=_parent,status&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listMyAttendance failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			_parent?: Array<{ reference: string }>;
			status?: Array<{ string: string }>;
		}>;
	};
	return (body.entities ?? []).flatMap((raw) => {
		const eventId = raw._parent?.[0]?.reference;
		const status = raw.status?.[0]?.string as AttendanceStatus | undefined;
		if (!eventId || !status) {
			// Fail loudly: a row with no `_parent` or no status means the caller
			// cannot see the private bucket (prop-def _sharing not widened). Drop the
			// row and log — never fabricate an eventId or default a status, which
			// would collapse all invisible rows onto key '' and stamp them with a lie
			// (mirrors listAttendance/listAllRsvpsForEvent's #84-review rule).
			console.warn(
				`listMyAttendance: dropping entity ${raw._id} — missing ${!eventId ? '_parent' : ''}${!eventId && !status ? '+' : ''}${!status ? 'status' : ''} (prop-def _sharing not domain?)`
			);
			return [];
		}
		return [{ attendanceId: raw._id, eventId, status }];
	});
}

/**
 * The conductor's RSVP→attendance comparison read (#82 made rsvps domain-visible
 * exactly for this). `rsvp` is a child of PERSON, so the event scoping goes
 * through the `event` reference prop — NOT `_parent` (that would scope to a
 * person and return nothing). Cross-person by design: the conductor reads every
 * member's domain-tier answer for THIS event.
 */
export async function listAllRsvpsForEvent(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<RsvpForEvent[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=rsvp&event.reference=${encodeURIComponent(eventId)}&props=member,status&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listAllRsvpsForEvent failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			member?: Array<{ reference: string }>;
			status?: Array<{ string: string }>;
		}>;
	};
	return (body.entities ?? []).flatMap((raw) => {
		const memberId = raw.member?.[0]?.reference;
		const status = raw.status?.[0]?.string as RsvpStatus | undefined;
		if (!memberId || !status) {
			// Fail loudly: a row with no member or no status means the caller cannot
			// see the private bucket (prop-def _sharing not widened). Drop the row and
			// log — never fabricate a memberId or default a status, which would collapse
			// all invisible rows onto key '' and stamp them with a lie (#84 review).
			console.warn(
				`listAllRsvpsForEvent: dropping entity ${raw._id} — missing ${!memberId ? 'member' : ''}${!memberId && !status ? '+' : ''}${!status ? 'status' : ''} (prop-def _sharing not domain?)`
			);
			return [];
		}
		return [{ rsvpId: raw._id, memberId, status }];
	});
}

/**
 * Index attendance records by member id for the panel's per-member toggle rows'
 * initial state. Pure — no fetch. A member with no record is simply ABSENT from
 * the map — renders unmarked, never defaulted to any status. Exact mirror of
 * rsvpsByEventId.
 */
export function attendanceByMemberId(records: EventAttendance[]): AttendanceByMemberId {
	const map: AttendanceByMemberId = {};
	for (const r of records) {
		map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
	}
	return map;
}

// (*MVOX:Josquin*)
