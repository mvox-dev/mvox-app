<!-- The conductor's inline attendance panel: one row per member with a P/A/L toggle. -->
<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import PartialNotice from '$lib/components/PartialNotice.svelte';
	import { onMount, tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import type { AttendanceStatus } from '$lib/attendance/attendanceData';
	import type { RosterRow } from '$lib/roster/rosterData';
	import SegmentedPill from '$lib/components/SegmentedPill.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import { writesAvailable } from '$lib/net/online';

	interface AttendanceEntryLite {
		attendanceId: string;
		status: AttendanceStatus;
	}
	interface RsvpEntryLite {
		rsvpId: string;
		status: string;
	}

	interface Props {
		item: AgendaItem;
		members?: RosterRow[];
		attendanceByMemberId?: Record<string, AttendanceEntryLite>;
		rsvpByMemberId?: Record<string, RsvpEntryLite>;
		loading?: boolean;
		error?: boolean;
		pendingMemberIds?: ReadonlySet<string>;
		failedMemberIds?: ReadonlySet<string>;
		savedMemberIds?: ReadonlySet<string>;
		// A cut-short read must say so: a missing row reads as "she is not a member".
		membersPartial?: boolean;
		ontoggle?: (memberId: string, status: AttendanceStatus | null) => void;
		onclose?: () => void;
	}
	const {
		item,
		members = [],
		attendanceByMemberId = {},
		rsvpByMemberId = {},
		loading = false,
		error = false,
		pendingMemberIds = new Set<string>(),
		failedMemberIds = new Set<string>(),
		savedMemberIds = new Set<string>(),
		membersPartial = false,
		ontoggle,
		onclose
	}: Props = $props();

	// The button that opened the panel unmounts, so focus lands on Close instead of <body>.
	let closeButtonEl = $state<HTMLButtonElement | undefined>(undefined);
	onMount(() => {
		closeButtonEl?.focus();
	});

	// Scroll once, after the data loads, so the rows' real height is measured. `hasScrolled`
	// is a plain let so the effect tracks only `loading` and never scrolls again mid-use.
	let panelEl = $state<HTMLDivElement | undefined>(undefined);
	let hasScrolled = false;
	$effect(() => {
		if (loading || hasScrolled) return;
		hasScrolled = true;
		tick().then(() => {
			panelEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		});
	});

	const STATUSES: { value: AttendanceStatus; label: () => string }[] = [
		{ value: 'present', label: m.attendance_status_present },
		{ value: 'absent', label: m.attendance_status_absent },
		{ value: 'late', label: m.attendance_status_late }
	];

	const RSVP_LABELS: Record<string, () => string> = {
		going: m.rsvp_status_going,
		not_going: m.rsvp_status_not_going,
		maybe: m.rsvp_status_maybe,
		late: m.rsvp_status_late
	};

	function rsvpLabel(memberId: string): string {
		const entry = rsvpByMemberId[memberId];
		if (!entry) return m.attendance_rsvp_none();
		return RSVP_LABELS[entry.status]?.() ?? entry.status;
	}

	const isOffline = $derived(!$writesAvailable);

	/** Mounted for the panel's whole life, so the loading and loaded text are both announced.
	 *  The error branch is '' because the error line already has role="alert". */
	const statusText = $derived(
		loading ? m.attendance_loading() : error ? '' : m.attendance_ready({ count: members.length })
	);

	/** Live tally of the currently-known statuses across the roster. Pure. */
	const tally = $derived.by(() => {
		let present = 0;
		let absent = 0;
		let late = 0;
		for (const member of members) {
			const status = attendanceByMemberId[member.memberId]?.status;
			if (status === 'present') present++;
			else if (status === 'absent') absent++;
			else if (status === 'late') late++;
		}
		return { present, absent, late };
	});

	// The tally counts optimistic values, so it says so while any write is in flight.
	const tallyUnconfirmed = $derived(pendingMemberIds.size > 0);
</script>

<!-- aria-busy on the container: focus sits on Close while the roster loads. -->
<div
	bind:this={panelEl}
	data-testid="attendance-panel"
	aria-busy={loading ? 'true' : undefined}
	class="mt-3 flex flex-col gap-2 rounded-lg border border-ink-4 bg-paper p-3"
>
	<div class="flex items-center justify-between">
		<span class="truncate text-sm text-ink">{item.name}</span>
		<button
			bind:this={closeButtonEl}
			type="button"
			data-testid="attendance-collapse-btn"
			aria-label={m.attendance_close()}
			class="rounded-md border border-ink-4 px-2 py-1 font-mono text-[10px] leading-none text-ink-2 hover:bg-ink hover:text-paper"
			onclick={() => onclose?.()}
		>
			&times;
		</button>
	</div>

	<span data-testid="attendance-panel-status" role="status" aria-live="polite" class="sr-only"
		>{statusText}</span
	>

	{#if isOffline}
		<p data-testid="attendance-write-unavailable" class="text-xs text-ink-2">
			{m.write_unavailable_no_signal()}
		</p>
	{/if}

	{#if loading}
		<div data-testid="attendance-panel-loading" class="flex flex-col gap-2" aria-hidden="true">
			{#each [0, 1, 2] as skeletonRow (skeletonRow)}
				<div class="h-8 animate-pulse rounded bg-ink-5"></div>
			{/each}
		</div>
	{:else if error}
		<p data-testid="attendance-panel-error" class="text-sm text-red-700" role="alert">{m.attendance_load_error()}</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#if membersPartial}
				<PartialNotice
					testid="attendance-panel-partial-notice"
					text={m.picker_partial_members_notice()}
					class="text-xs"
				/>
			{/if}
			{#each members as member (member.memberId)}
				<div
					data-testid="attendance-row-{member.memberId}"
					class="flex flex-col gap-1 border-b border-dashed border-ink-5 pb-2 last:border-b-0"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="min-w-0 flex-1 truncate text-sm text-ink"><PersonName name={member.name} /></span>
						<span data-testid="attendance-rsvp-{member.memberId}" class="text-[10px] text-ink-2"
							role="img"
							aria-label={m.attendance_rsvp_aria_label({ name: member.name, rsvp: rsvpLabel(member.memberId) })}
						>
							{rsvpLabel(member.memberId)}
						</span>
						<!-- Tapping the chosen status clears the record; a pending row stays reachable. -->
						<SegmentedPill
							testid="attendance-status-group-{member.memberId}"
							label={m.attendance_group_label({ name: member.name })}
							options={STATUSES.map((status) => ({
								value: status.value,
								label: status.label(),
								testid: `attendance-toggle-${member.memberId}-${status.value}`,
								ariaLabel: m.attendance_toggle_aria_label({ name: member.name, status: status.label() })
							}))}
							selected={attendanceByMemberId[member.memberId]?.status ?? null}
							emptyAllowed={true}
							kind="data"
							busy={pendingMemberIds.has(member.memberId)}
							reachableWhenBlocked={true}
							onselect={(status) => ontoggle?.(member.memberId, status)}
						/>
					</div>
					{#if failedMemberIds.has(member.memberId)}
						<FormError data-testid="attendance-save-failed-{member.memberId}">
							{m.attendance_save_failed()}
						</FormError>
					{/if}
					<!-- Always mounted: a live region must exist before its first change is announced. -->
					<p
						data-testid="attendance-saved-status-{member.memberId}"
						role="status"
						aria-live="polite"
						class="min-h-[16px] text-xs leading-[16px] text-ink-2"
					>
						{#if savedMemberIds.has(member.memberId)}{m.attendance_saved()}{/if}
					</p>
				</div>
			{/each}
		</div>
		<p data-testid="attendance-tally" class="pt-1 text-[10px] text-ink-2" aria-live="polite">
			{m.attendance_tally({ present: tally.present, absent: tally.absent, late: tally.late })}
			{#if tallyUnconfirmed}
				<span data-testid="attendance-tally-unconfirmed" class="text-ink-2"
					>{m.attendance_tally_unconfirmed()}</span
				>
			{/if}
		</p>
	{/if}
</div>
