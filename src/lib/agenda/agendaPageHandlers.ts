// The agenda's rsvp, attendance and part-open handlers, writing the page's own state object.
import { get } from 'svelte/store';
import { m } from '$lib/paraglide/messages.js';
import { cfgFor } from '$lib/entu/cfg';
import { selectedCollectiveIdentityStore, sameCollectiveIdentity } from '$lib/collectives/store';
import type { AgendaItem } from '$lib/agenda/types';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import { attendanceQueueHandlers } from '$lib/agenda/attendancePanel';
import type * as RsvpData from '$lib/rsvp/rsvpData';
import type { MyRsvp, RsvpStatus } from '$lib/rsvp/rsvpData';
import { createRsvpChangeQueue, type RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
import { createRsvpWriteStatus } from '$lib/rsvp/rsvpWriteStatus';
import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
import type { AttendanceStatus, EventAttendance } from '$lib/attendance/attendanceData';
import { createWriteTokens } from '$lib/net/writeTokens';
import { getAppByteStore } from '$lib/files/appByteStore';
import { openPart } from '$lib/parts/openPart';
import type { WorkRow } from '$lib/repertoire/types';
import { rosterOrder } from '$lib/sections/sectionData';
import { withItem } from '$lib/collections/immutable';

export interface AgendaPageHandlerDeps {
	selected: () => { db: string; personId: string } | null | undefined;
	isOffline: () => boolean;
	pendingEventIds: { get(): Set<string>; set(ids: Set<string>): void };
	findMyMemberId: typeof RsvpData.findMyMemberId;
	panelWorkRows: () => readonly WorkRow[];
}

export function createAgendaPageHandlers(ag: AgendaLoadState, deps: AgendaPageHandlerDeps) {
	const collectiveTokens = () =>
		createWriteTokens(() => get(selectedCollectiveIdentityStore), sameCollectiveIdentity);

	let presenceSeq = 0;
	function refreshPresence(db: string, personId: string, isCurrent: () => boolean): void {
		const seq = ++presenceSeq;
		try {
			getAppByteStore()
				.heldFileIds(db, personId)
				.then((ids) => {
					if (seq !== presenceSeq || !isCurrent()) return;
					ag.heldFileIds = new Set(ids);
				})
				.catch((e) => {
					console.error('agenda: file presence read failed', e);
				});
		} catch (e) {
			console.error('agenda: file presence read failed', e);
		}
	}

	function rosterPickerOptions(
		excludeIds: readonly string[]
	): Array<{ id: string; label: string }> {
		return rosterOrder(ag.rosterRows, ag.rosterSections)
			.filter((row) => !excludeIds.includes(row.personId))
			.map((row) => ({ id: row.personId, label: row.name }));
	}

	function pickerPromptText(optionCount: number, addPrompt: string): string {
		if (optionCount > 0) return addPrompt;
		if (ag.rosterReadFailed) return m.picker_roster_unavailable();
		if (ag.rosterReadsInFlight > 0) return m.picker_roster_loading();
		if (ag.rosterRows.length === 0) return m.picker_no_members();
		return m.picker_everyone_added();
	}

	const rsvpQueue = createRsvpChangeQueue(
		createRsvpWriteStatus({
			tokens: collectiveTokens(),
			accessors: {
				setEntry(eventId, entry) {
					const next = { ...ag.rsvpByEventId };
					if (entry) next[eventId] = entry;
					else delete next[eventId];
					ag.rsvpByEventId = next;
				},
				setPending: (eventId, pending) =>
					deps.pendingEventIds.set(withItem(deps.pendingEventIds.get(), eventId, pending)),
				setFailed(eventId, failed) {
					if (failed || ag.failedEventIds.has(eventId)) {
						ag.failedEventIds = withItem(ag.failedEventIds, eventId, failed);
					}
				},
				setSaved(eventId, saved) {
					if (saved || ag.savedEventIds.has(eventId)) {
						ag.savedEventIds = withItem(ag.savedEventIds, eventId, saved);
					}
				}
			}
		})
	);

	function handleRsvpChange(item: AgendaItem, newStatus: RsvpStatus | null) {
		const selected = deps.selected();
		if (!selected) return;
		if (deps.isOffline()) return;
		const cfg = cfgFor(selected.db);
		const personId = selected.personId;
		const identity = { db: selected.db, personId };

		const current: RsvpEntry | undefined = ag.rsvpByEventId[item.id];
		const existing: MyRsvp | null = current
			? { rsvpId: current.rsvpId, eventId: item.id, status: current.status }
			: null;

		rsvpQueue.request({
			cfg,
			personId,
			memberId: ag.memberId,
			resolveMemberId: async () => {
				const id = await deps.findMyMemberId(cfg, personId);
				if (sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity)) {
					ag.memberId = id;
					if (!id) ag.membership = 'non-member';
				}
				return id;
			},
			eventId: item.id,
			existing,
			newStatus
		});
	}

	function findWorkRowByFileId(fileId: string): WorkRow | undefined {
		for (const rows of [...Object.values(ag.worksByEventId), deps.panelWorkRows()]) {
			const row = rows.find((r) => r.fileId === fileId);
			if (row) return row;
		}
		return undefined;
	}

	function handlePdfClick(fileId: string) {
		const selected = deps.selected();
		if (!selected) return;
		const row = findWorkRowByFileId(fileId);
		openPart(
			selected.db,
			fileId,
			row
				? {
						work: row.workName,
						composer: row.composer,
						edition: row.editionName,
						filename: row.fileName
					}
				: undefined
		);
	}

	const attendanceQueue = createAttendanceChangeQueue(
		attendanceQueueHandlers(ag, collectiveTokens())
	);

	function handleAttendanceToggle(memberId: string, newStatus: AttendanceStatus | null) {
		const selected = deps.selected();
		if (!selected || !ag.attendanceItem) return;
		if (deps.isOffline()) return;
		const cfg = cfgFor(selected.db);
		const current = ag.attendanceMap[memberId];
		const existing: EventAttendance | null = current
			? { attendanceId: current.attendanceId, memberId, status: current.status }
			: null;
		attendanceQueue.request({ cfg, eventId: ag.attendanceItem.id, memberId, existing, newStatus });
	}

	return {
		refreshPresence,
		rosterPickerOptions,
		pickerPromptText,
		handleRsvpChange,
		handlePdfClick,
		attendanceQueue,
		handleAttendanceToggle
	};
}
