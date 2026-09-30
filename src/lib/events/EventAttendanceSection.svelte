<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import { isPastDetail } from '$lib/events/eventTime';
	import AttendanceSurface from '$lib/components/attendance/AttendanceSurface.svelte';
	import AttendanceBadge from '$lib/components/attendance/AttendanceBadge.svelte';
	import TakeAttendanceButton from '$lib/components/attendance/TakeAttendanceButton.svelte';
	import type { AttendanceStatus, EventAttendance } from '$lib/attendance/attendanceData';
	import type { AgendaItem } from '$lib/agenda/types';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions, EventPageState } from '$lib/events/eventPageState';
	import { withItem, without } from '$lib/collections/immutable';
	import { focusAfterRender } from '$lib/a11y/focusable';

	let {
		detail,
		selected,
		ev,
		isOffline,
		canMarkAttendanceForEvent,
		generation,
		actions
	}: {
		detail: EventDetail;
		selected: Collective | null;
		ev: EventPageState;
		isOffline: boolean;
		canMarkAttendanceForEvent: boolean;
		generation: () => number;
		actions: EventActions;
	} = $props();

	const isPast = $derived(isPastDetail(detail));

	let attendancePanelOpen = $state(false);
	let attendancePanelLoading = $state(false);
	let attendancePanelError = $state(false);
	let attendanceRoster = $state<RosterRow[]>([]);
	let attendanceRosterPartial = $state(false);
	let attendanceRsvpMap = $state<Record<string, { rsvpId: string; status: string }>>({});
	let attendancePendingMemberIds = $state<Set<string>>(new Set());
	let attendanceFailedMemberIds = $state<Set<string>>(new Set());
	let attendanceSavedMemberIds = $state<Set<string>>(new Set());

	const myAttendanceStatus = $derived<AttendanceStatus | 'not-recorded' | null>(
		ev.memberId === null ? null : (ev.attendanceMap[ev.memberId]?.status ?? 'not-recorded')
	);

	const hasAttendanceRecords = $derived(Object.keys(ev.attendanceMap).length > 0);

	const attendanceTally = $derived.by(() => {
		let present = 0;
		let absent = 0;
		let late = 0;
		for (const entry of Object.values(ev.attendanceMap)) {
			if (entry.status === 'present') present++;
			else if (entry.status === 'absent') absent++;
			else if (entry.status === 'late') late++;
		}
		return { present, absent, late };
	});

	const showAttendanceSection = $derived(
		isPast && detail !== null && (hasAttendanceRecords || canMarkAttendanceForEvent)
	);

	const agendaItemForPanel = $derived<AgendaItem | null>(
		detail === null
			? null
			: {
					id: detail.id,
					name: detail.name,
					startDatetime: detail.startDatetime,
					durationMinutes: detail.durationMinutes,
					location: detail.location,
					conductors: detail.conductorIds,
					owners: detail.ownerIds,
					editors: detail.editorIds
				}
	);

	function openAttendancePanel(): void {
		if (!selected || !detail || !canMarkAttendanceForEvent) return;
		attendancePanelOpen = true;
		attendancePanelLoading = true;
		attendancePanelError = false;
		attendanceSavedMemberIds = new Set();
		const cfg = cfgFor(selected.db);
		const evId = detail.id;
		const g = generation();
		Promise.all([loadRoster(cfg), actions.listAttendance(cfg, evId), actions.listAllRsvpsForEvent(cfg, evId)])
			.then(([rosterRead, records, rsvps]) => {
				if (g !== generation() || detail?.id !== evId) return;
				attendanceRoster = rosterRead.items;
				attendanceRosterPartial = rosterRead.truncated;
				ev.attendanceMap = actions.attendanceByMemberId(records);
				const rsvpMap: Record<string, { rsvpId: string; status: string }> = {};
				for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
				attendanceRsvpMap = rsvpMap;
				attendancePanelLoading = false;
			})
			.catch((e) => {
				console.error('event detail: attendance panel load failed', e);
				if (g !== generation() || detail?.id !== evId) return;
				attendancePanelLoading = false;
				attendancePanelError = true;
				attendanceRosterPartial = false;
			});
	}

	function closeAttendancePanel(): void {
		attendancePanelOpen = false;
		void focusAfterRender(() =>
			document.querySelector<HTMLElement>(
				'[data-testid="event-detail-attendance"] [data-testid="take-attendance-btn"]'
			)
		);
	}

	const attendanceWriteGenerations = new Map<string, number>();
	function isCurrentAttendanceWrite(evId: string, targetMemberId: string): boolean {
		return (
			detail !== null &&
			evId === detail.id &&
			attendanceWriteGenerations.get(targetMemberId) === generation()
		);
	}

	const attendanceQueue = untrack(() =>
		actions.createAttendanceChangeQueue({
			setOptimistic(evId, targetMemberId, entry) {
				if (!isCurrentAttendanceWrite(evId, targetMemberId)) return;
				const next = { ...ev.attendanceMap };
				if (entry) next[targetMemberId] = entry;
				else delete next[targetMemberId];
				ev.attendanceMap = next;
			},
			setPending(evId, targetMemberId, pending) {
				if (pending) attendanceWriteGenerations.set(targetMemberId, generation());
				if (!isCurrentAttendanceWrite(evId, targetMemberId)) return;
				attendancePendingMemberIds = withItem(attendancePendingMemberIds, targetMemberId, pending);
				if (pending) {
					attendanceFailedMemberIds = without(attendanceFailedMemberIds, targetMemberId);
					attendanceSavedMemberIds = without(attendanceSavedMemberIds, targetMemberId);
				}
			},
			reconcile(evId, targetMemberId, entry) {
				const stillCurrent = isCurrentAttendanceWrite(evId, targetMemberId);
				attendanceWriteGenerations.delete(targetMemberId);
				if (!stillCurrent) return;
				const next = { ...ev.attendanceMap };
				if (entry) next[targetMemberId] = entry;
				else delete next[targetMemberId];
				ev.attendanceMap = next;
				const saved = new Set(attendanceSavedMemberIds);
				saved.add(targetMemberId);
				attendanceSavedMemberIds = saved;
			},
			revert(evId, targetMemberId, before) {
				const stillCurrent = isCurrentAttendanceWrite(evId, targetMemberId);
				attendanceWriteGenerations.delete(targetMemberId);
				if (!stillCurrent) return;
				const next = { ...ev.attendanceMap };
				if (before) next[targetMemberId] = before;
				else delete next[targetMemberId];
				ev.attendanceMap = next;
				const failed = new Set(attendanceFailedMemberIds);
				failed.add(targetMemberId);
				attendanceFailedMemberIds = failed;
				if (attendanceSavedMemberIds.has(targetMemberId)) {
					attendanceSavedMemberIds = without(attendanceSavedMemberIds, targetMemberId);
				}
			}
		})
	);

	function handleAttendanceToggle(targetMemberId: string, newStatus: AttendanceStatus | null): void {
		if (!selected || !detail) return;
		if (isOffline) return;
		const cfg = cfgFor(selected.db);
		const current = ev.attendanceMap[targetMemberId];
		const existing: EventAttendance | null = current
			? { attendanceId: current.attendanceId, memberId: targetMemberId, status: current.status }
			: null;
		attendanceQueue.request({ cfg, eventId: detail.id, memberId: targetMemberId, existing, newStatus });
	}
</script>

{#if showAttendanceSection}
	<section
		data-testid="event-detail-attendance"
		class="mt-4 flex flex-col gap-2"
		aria-labelledby="event-detail-attendance-heading"
	>
		<h2 id="event-detail-attendance-heading" class="font-display text-lg text-ink-2">
			{m.event_detail_attendance_heading()}
		</h2>
		{#if myAttendanceStatus !== null}
			<AttendanceBadge status={myAttendanceStatus} testid="event-detail-attendance-badge" />
		{/if}
		{#if hasAttendanceRecords}
			<p
				data-testid="event-detail-attendance-tally"
				class="text-xs text-ink-2"
				aria-live="polite"
			>
				<span data-testid="event-detail-attendance-tally-present"
					>{m.event_detail_attendance_tally_present({ count: attendanceTally.present })}</span
				>
				·
				<span data-testid="event-detail-attendance-tally-absent"
					>{m.event_detail_attendance_tally_absent({ count: attendanceTally.absent })}</span
				>
				·
				<span data-testid="event-detail-attendance-tally-late"
					>{m.event_detail_attendance_tally_late({ count: attendanceTally.late })}</span
				>
			</p>
		{/if}
		{#if canMarkAttendanceForEvent && !attendancePanelOpen}
			<TakeAttendanceButton eventName={detail.name} onclick={openAttendancePanel} />
		{/if}
		{#if attendancePanelOpen && agendaItemForPanel}
			<AttendanceSurface
				item={agendaItemForPanel}
				members={attendanceRoster}
				attendanceByMemberId={ev.attendanceMap}
				rsvpByMemberId={attendanceRsvpMap}
				loading={attendancePanelLoading}
				error={attendancePanelError}
				pendingMemberIds={attendancePendingMemberIds}
				failedMemberIds={attendanceFailedMemberIds}
				savedMemberIds={attendanceSavedMemberIds}
				membersPartial={attendanceRosterPartial}
				ontoggle={handleAttendanceToggle}
				onclose={closeAttendancePanel}
			/>
		{/if}
	</section>
{/if}
