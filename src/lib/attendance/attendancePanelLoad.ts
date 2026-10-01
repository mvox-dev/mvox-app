// The attendance panel load shared by the agenda and the event page.
import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
import { without } from '$lib/collections/immutable';
import type { AttendanceEntry } from '$lib/attendance/attendanceChangeQueue';
import type * as AttendanceData from '$lib/attendance/attendanceData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type AttendanceMap = Record<string, AttendanceEntry>;
export type AttendanceRsvpMap = Record<string, { rsvpId: string; status: string }>;

export interface AttendancePanelRead {
	roster: RosterRow[];
	rosterPartial: boolean;
	attendance: AttendanceMap;
	rsvps: AttendanceRsvpMap;
}

export interface AttendancePanelLoadDeps {
	label: string;
	listAttendance: typeof AttendanceData.listAttendance;
	listAllRsvpsForEvent: typeof AttendanceData.listAllRsvpsForEvent;
	attendanceByMemberId: typeof AttendanceData.attendanceByMemberId;
	pendingMembersForEvent(eventId: string): Set<string>;
}

export interface AttendancePanelTarget {
	isCurrent(): boolean;
	liveAttendance(): AttendanceMap;
	loaded(read: AttendancePanelRead): void;
	failed(): void;
}

export function mergeAttendance(
	serverMap: AttendanceMap,
	liveMap: AttendanceMap,
	pendingMembers: Set<string>
): AttendanceMap {
	const merged = { ...serverMap };
	for (const mid of pendingMembers) {
		if (mid in liveMap) merged[mid] = liveMap[mid];
		else delete merged[mid];
	}
	for (const mid of Object.keys(liveMap)) {
		if (pendingMembers.has(mid)) continue;
		const liveEntry = liveMap[mid];
		const serverEntry = serverMap[mid];
		if (liveEntry && (!serverEntry || serverEntry.attendanceId !== liveEntry.attendanceId)) {
			merged[mid] = liveEntry;
		}
	}
	return merged;
}

export type FailedByEvent = Map<string, Set<string>>;

export function withFailedMark(
	byEvent: FailedByEvent,
	eventId: string,
	memberId: string,
	failed: boolean
): FailedByEvent {
	const eventFailed = byEvent.get(eventId);
	if (failed) return new Map(byEvent).set(eventId, new Set(eventFailed).add(memberId));
	if (!eventFailed?.has(memberId)) return byEvent;
	const cleared = without(eventFailed, memberId);
	return cleared.size === 0 ? without(byEvent, eventId) : new Map(byEvent).set(eventId, cleared);
}

export function failedMarksFor(byEvent: FailedByEvent, eventId: string): Set<string> {
	return new Set(byEvent.get(eventId) ?? []);
}

export function createAttendancePanelLoad(deps: AttendancePanelLoadDeps) {
	let requestId = 0;

	function open(cfg: EntuCfg, eventId: string, target: AttendancePanelTarget): void {
		const thisRequest = ++requestId;
		const current = () => thisRequest === requestId && target.isCurrent();
		Promise.all([
			loadRoster(cfg),
			deps.listAttendance(cfg, eventId),
			deps.listAllRsvpsForEvent(cfg, eventId)
		])
			.then(([rosterRead, records, rsvps]) => {
				if (!current()) return;
				const rsvpMap: AttendanceRsvpMap = {};
				for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
				target.loaded({
					roster: rosterRead.items,
					rosterPartial: rosterRead.truncated,
					attendance: mergeAttendance(
						deps.attendanceByMemberId(records),
						target.liveAttendance(),
						deps.pendingMembersForEvent(eventId)
					),
					rsvps: rsvpMap
				});
			})
			.catch((e) => {
				console.error(`${deps.label}: attendance panel load failed`, e);
				if (!current()) return;
				target.failed();
			});
	}

	function cancel(): void {
		requestId++;
	}

	return { open, cancel };
}
