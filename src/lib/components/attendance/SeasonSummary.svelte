<!-- src/lib/components/attendance/SeasonSummary.svelte -->
<!--
	#85 TA.4 — the season summary, ALWAYS visible at the top of the Recent
	section (never conditional on data: zero attendance renders "Attended 0 of
	N", it never hides the block). Every signed-in member sees her own rate;
	a conductor additionally gets an expand affordance into the full-roster
	per-member rates. A non-conductor gets no expand affordance at all — the
	roster view is unreachable from here, not just visually collapsed.

	Presentation only: the page owns the underlying reads (listMyAttendance,
	roster + per-event listAttendance for the expanded view) and the expanded/
	collapsed state, exactly like AttendanceSurface owns none of the attendance
	write mechanics itself.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { MemberAttendanceRate } from '$lib/attendance/attendanceSummary';

	interface Props {
		myRate: { attended: number; total: number };
		/** Whether the signed-in person can expand into the full-roster view (conductor seat). */
		canExpand?: boolean;
		expanded?: boolean;
		/** Roster-order, zero-filled per-member rates — only rendered once expanded. */
		memberRates?: MemberAttendanceRate[];
		/** F2 fix: explicit loading/error for the roster rate read. */
		loading?: boolean;
		error?: boolean;
		onexpand?: () => void;
	}
	const { myRate, canExpand = false, expanded = false, memberRates = [], loading = false, error = false, onexpand }: Props = $props();

	// A stable per-instance id for the member-rates region — $props.id()
	// generates a component-scoped ID that is consistent between server and
	// client (Svelte 5.20+), eliminating the SSR hydration mismatch latent in
	// the previous Math.random() approach.
	const componentId = $props.id();
	const membersRegionId = `season-summary-members-${componentId}`;
</script>

<div data-testid="season-summary" class="mb-1 flex flex-col gap-2 rounded-lg border border-ink-5 bg-paper-2 p-3">
	<div class="flex items-center justify-between gap-2">
		<div class="flex flex-col gap-0.5">
			<span class="font-mono text-[9px] tracking-wide text-ink-3 uppercase">{m.attendance_season_summary()}</span>
			<p data-testid="my-season-rate" class="text-sm text-ink">
				{m.attendance_season_rate({ attended: myRate.attended, total: myRate.total })}
			</p>
		</div>
		{#if canExpand}
			<button
				type="button"
				data-testid="season-summary-expand"
				class="shrink-0 rounded-md border border-ink px-2 py-1 font-mono text-[9px] tracking-wide text-ink hover:bg-ink hover:text-paper"
				aria-expanded={expanded}
				onclick={() => onexpand?.()}
			>
				{m.attendance_all_members()}
			</button>
		{/if}
	</div>
	{#if canExpand && expanded}
		<div
			id={membersRegionId}
			data-testid="season-summary-members"
			class="flex flex-col gap-1 border-t border-dashed border-ink-5 pt-2"
		>
			{#if loading}
				<p data-testid="season-rates-loading" class="text-xs text-ink-3">{m.attendance_season_loading()}</p>
			{:else if error}
				<p data-testid="season-rates-error" class="text-xs text-red" role="alert">{m.attendance_season_load_error()}</p>
			{:else}
				<div role="list" class="flex flex-col gap-1">
					{#each memberRates as rate (rate.memberId)}
						<div
							data-testid="member-rate-{rate.memberId}"
							role="listitem"
							class="flex items-center justify-between gap-2 text-xs"
						>
							<span class="truncate text-ink-2">{rate.name}</span>
							<span class="shrink-0 font-mono text-ink">
								{m.attendance_member_rate({ attended: rate.attended, total: rate.total })}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- (*MVOX:Josquin*) -->
