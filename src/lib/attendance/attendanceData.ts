// Attendance, a child of the event recorded by the conductor, plus the rsvp reads it compares.
import { entuFetch } from '$lib/entu/request';
import { overwriteEntityValues } from '$lib/entu/replaceProperty';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { RsvpStatus } from '$lib/rsvp/rsvpData';
import { deriveListRead, type ListRead } from '$lib/entu/listRead';

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

/** A singer's own attendance; the event id is read off `_parent`. */
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

export async function createAttendance(
	cfg: EntuCfg,
	input: CreateAttendanceInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const attendanceTypeId = await resolveTypeId(cfg, 'attendance', fetchImpl);
	const props = [
		{ type: '_type', reference: attendanceTypeId },
		{ type: '_parent', reference: input.eventId },
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
	if (!res.ok) throw new Error(`createAttendance failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

// One atomic overwrite POST for status and sentinel, as in updateRsvpStatus; the sentinel's
// event id is the stored `_parent`.
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
	const eventId = entity._parent?.[0]?.reference;
	if (!eventId) throw new Error('updateAttendanceStatus: _parent reference missing — cannot write sentinel');

	const allSentinels = [
		...(entity.present_ref ?? []),
		...(entity.absent_ref ?? []),
		...(entity.late_ref ?? [])
	];
	await overwriteEntityValues(
		cfg,
		attendanceId,
		[
			{ value: { type: 'status', string: status }, existing: entity.status ?? [] },
			{ value: { type: `${status}_ref`, reference: eventId }, existing: allSentinels }
		],
		fetchImpl,
		'updateAttendanceStatus'
	);
}

// `status` has no "none" value, so deleting the record is how a mark is cleared.
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

export async function listAttendance(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<EventAttendance[]> {
	// One row per member at most, so limit=500 is bounded by the active roster, not by time.
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
			// A row the caller cannot fully read is dropped and logged, never given a made-up value.
			console.warn(
				`listAttendance: dropping entity ${raw._id} — missing ${!memberId ? 'member' : ''}${!memberId && !status ? '+' : ''}${!status ? 'status' : ''} (prop-def _sharing not domain?)`
			);
			return [];
		}
		return [{ attendanceId: raw._id, memberId, status }];
	});
}

// Filtered by `member`, since `_parent` is the event. Lifetime list: `truncated` compares the
// server count with the raw rows, before unreadable rows are dropped.
export async function listMyAttendance(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ListRead<MyAttendance>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=attendance&member.reference=${encodeURIComponent(memberId)}&props=_parent,status&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listMyAttendance failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			_parent?: Array<{ reference: string }>;
			status?: Array<{ string: string }>;
		}>;
	};
	const raw = body.entities ?? [];
	const items = raw.flatMap((r) => {
		const eventId = r._parent?.[0]?.reference;
		const status = r.status?.[0]?.string as AttendanceStatus | undefined;
		if (!eventId || !status) {
			console.warn(
				`listMyAttendance: dropping entity ${r._id} — missing ${!eventId ? '_parent' : ''}${!eventId && !status ? '+' : ''}${!status ? 'status' : ''} (prop-def _sharing not domain?)`
			);
			return [];
		}
		return [{ attendanceId: r._id, eventId, status }];
	});
	return deriveListRead(items, raw.length, body.count);
}

// Scoped through the `event` reference: an rsvp's `_parent` is the person.
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
			console.warn(
				`listAllRsvpsForEvent: dropping entity ${raw._id} — missing ${!memberId ? 'member' : ''}${!memberId && !status ? '+' : ''}${!status ? 'status' : ''} (prop-def _sharing not domain?)`
			);
			return [];
		}
		return [{ rsvpId: raw._id, memberId, status }];
	});
}

// A member without a record is absent from the map, never defaulted to a status.
export function attendanceByMemberId(records: EventAttendance[]): AttendanceByMemberId {
	const map: AttendanceByMemberId = {};
	for (const r of records) {
		map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
	}
	return map;
}

// (*MVOX:Josquin*)
