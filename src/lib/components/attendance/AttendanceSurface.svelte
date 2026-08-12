<!-- src/lib/components/attendance/AttendanceSurface.svelte -->
<!--
	#84 TA.3 — the conductor's inline "Take attendance" panel. Expands under the
	recent-event row (no navigation) with one row per roster member: name (left)
	+ RSVP comparison label (middle, going/not_going/maybe/late/no-answer) + a
	P/A/L segmented toggle (right). Every toggle tap saves immediately — this
	component only renders + forwards; the page owns the write queue exactly like
	AgendaList/RsvpControl own none of the RSVP write mechanics themselves
	(rsvpChangeQueue.ts lives at the page level, see +page.svelte).

	The collapse control aria-label and the live tally line use i18n message
	keys (attendance_close, attendance_tally) added in the #84 review pass.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import type { AttendanceStatus } from '$lib/attendance/attendanceData';
	import type { RosterRow } from '$lib/roster/rosterData';

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
		// While a member's write is in flight, that member's whole toggle (all 3
		// buttons) is unclickable — same #15 shape as RsvpControl/pendingEventIds,
		// keyed by member id instead of event id (attendanceChangeQueue.ts).
		pendingMemberIds?: ReadonlySet<string>;
		// Members whose last write REJECTED — surfaces an inline save-failed line.
		failedMemberIds?: ReadonlySet<string>;
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
		ontoggle,
		onclose
	}: Props = $props();

	// #113 RED — the 'Take attendance' button that opened this panel unmounts
	// the instant it does (the #112/#1 hide-while-open behaviour), so without
	// explicit placement focus drops to <body> (WCAG 2.4.3). The close button
	// is the natural landing: first focusable element in the panel, and the
	// symmetric undo (`closeAttendancePanel` in +page.svelte returns focus to
	// the restored 'Take attendance' button on the way back out).
	let closeButtonEl = $state<HTMLButtonElement | undefined>(undefined);
	onMount(() => {
		closeButtonEl?.focus();
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

	function handleToggle(memberId: string, status: AttendanceStatus) {
		if (pendingMemberIds.has(memberId) || !ontoggle) return;
		// Tap the ACTIVE status -> clear the record (null); tap any other -> set it.
		const current = attendanceByMemberId[memberId]?.status;
		ontoggle(memberId, current === status ? null : status);
	}

	/** Text of the panel's always-mounted sr-only live region.
	 *
	 *  #113 review F1 — a live region announces CHANGES to its contents, so it
	 *  must already be in the DOM before the text it should announce arrives.
	 *  The first cut mounted the region together with its loading text inside
	 *  the `{#if loading}` branch, which is the one shape that never announces:
	 *  the panel mounts with `loading` already true, so there is no empty→text
	 *  transition on the way in, and on the way out the region unmounted
	 *  entirely (aria-busy falling off a non-live container is not spoken), so
	 *  there was no completion cue either. Mounted once for the panel's whole
	 *  life and driven by state, both edges become real content changes. Same
	 *  rule the roster regions already follow (roster/+page.svelte).
	 *
	 *  The error branch deliberately yields '' — the visible error line already
	 *  carries role="alert", and two regions saying the same thing double-speak. */
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
</script>

<!-- #113 review F4 — `aria-busy` belongs on the CONTAINER the focused control
     lives in, not on the skeleton: the open-focus above parks the user on the
     Close button while `loading` is true, so without it a screen-reader user
     hears "Close, button" and then silence until the roster resolves, with
     nothing saying a wait is in progress. The skeleton itself stays
     aria-hidden (decoration); the sr-only role="status" below is what carries
     the words — the same role="status" + aria-live + m.* text + aria-hidden
     glyph split as the roster's reorder spinner. It sits OUTSIDE the
     loading/error/loaded branches on purpose (review F1, see `statusText`):
     mounted for the panel's whole life, so both the arrival of the loading
     text and its replacement by the loaded text are announced. -->
<div
	data-testid="attendance-panel"
	aria-busy={loading ? 'true' : undefined}
	class="mt-3 flex flex-col gap-2 rounded-lg border border-ink-4 bg-paper p-3"
>
	<div class="flex items-center justify-between">
		<span class="truncate font-display text-sm text-ink">{item.name}</span>
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

	{#if loading}
		<div data-testid="attendance-panel-loading" class="flex flex-col gap-2" aria-hidden="true">
			{#each [0, 1, 2] as skeletonRow (skeletonRow)}
				<div class="h-8 animate-pulse rounded bg-ink-5"></div>
			{/each}
		</div>
	{:else if error}
		<p data-testid="attendance-panel-error" class="text-sm text-ink-2" role="alert">{m.attendance_load_error()}</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each members as member (member.memberId)}
				<div
					data-testid="attendance-row-{member.memberId}"
					class="flex flex-col gap-1 border-b border-dashed border-ink-5 pb-2 last:border-b-0"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="min-w-0 flex-1 truncate text-sm text-ink">{member.name}</span>
						<span data-testid="attendance-rsvp-{member.memberId}" class="text-[10px] text-ink-2"
							role="img"
							aria-label={m.attendance_rsvp_aria_label({ name: member.name, rsvp: rsvpLabel(member.memberId) })}
						>
							{rsvpLabel(member.memberId)}
						</span>
						<div
							class="inline-flex overflow-hidden rounded-md border border-ink-4"
							aria-busy={pendingMemberIds.has(member.memberId) ? 'true' : undefined}
						>
							{#each STATUSES as status (status.value)}
								<button
									data-testid="attendance-toggle-{member.memberId}-{status.value}"
									type="button"
									aria-disabled={pendingMemberIds.has(member.memberId) ? 'true' : undefined}
									aria-pressed={attendanceByMemberId[member.memberId]?.status === status.value
										? 'true'
										: 'false'}
									aria-label={m.attendance_toggle_aria_label({ name: member.name, status: status.label() })}
									class="border-r border-ink-4 px-2 py-1 font-mono text-[9px] tracking-wide last:border-r-0 aria-disabled:cursor-default aria-disabled:opacity-[0.45]"
									class:bg-ink={attendanceByMemberId[member.memberId]?.status === status.value}
									class:text-paper={attendanceByMemberId[member.memberId]?.status === status.value}
									class:text-ink-2={attendanceByMemberId[member.memberId]?.status !== status.value}
									onclick={() => handleToggle(member.memberId, status.value)}
								>
									{status.label()}
								</button>
							{/each}
						</div>
					</div>
					{#if failedMemberIds.has(member.memberId)}
						<p
							data-testid="attendance-save-failed-{member.memberId}"
							class="text-[9px] text-red"
							role="alert"
						>
							{m.attendance_save_failed()}
						</p>
					{/if}
				</div>
			{/each}
		</div>
		<p data-testid="attendance-tally" class="pt-1 text-[10px] text-ink-2" aria-live="polite">
			{m.attendance_tally({ present: tally.present, absent: tally.absent, late: tally.late })}
		</p>
	{/if}
</div>
