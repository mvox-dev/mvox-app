<!-- Always shown; a conductor can expand into per-member rates. The page owns the reads. -->
<script lang="ts">
	import PartialNotice from '$lib/components/PartialNotice.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { MemberAttendanceRate } from '$lib/attendance/attendanceSummary';
	import PersonName from '$lib/components/PersonName.svelte';

	interface Props {
		myRate: { attended: number; total: number };
		/** Whether the signed-in person can expand into the full-roster view (conductor seat). */
		canExpand?: boolean;
		expanded?: boolean;
		/** Roster-order, zero-filled per-member rates — only rendered once expanded. */
		memberRates?: MemberAttendanceRate[];
		loading?: boolean;
		error?: boolean;
		/** A member read was partial, so rows are missing from a comparison table. */
		membersPartial?: boolean;
		onexpand?: () => void;
	}
	const { myRate, canExpand = false, expanded = false, memberRates = [], loading = false, error = false, membersPartial = false, onexpand }: Props = $props();

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
				<!-- role="alert" matches AttendanceSurface's panel error. -->
				<p data-testid="season-rates-error" class="text-sm text-red-700" role="alert">{m.attendance_season_load_error()}</p>
			{:else}
				<!-- Above the rows so it is read first; absent once both member reads complete. -->
				{#if membersPartial}
					<PartialNotice
						testid="season-summary-partial-notice"
						text={m.season_summary_partial_notice()}
						class="text-xs"
					/>
				{/if}
				<div role="list" class="flex flex-col gap-1">
					{#each memberRates as rate (rate.memberId)}
						{#if rate.inactive}
							<!-- A deactivated member keeps a marked row: the count, no rate (see
							     deriveAllMemberRates), and its own testid. -->
							<div
								data-testid="member-rate-inactive-{rate.memberId}"
								role="listitem"
								class="flex items-center justify-between gap-2 text-xs text-ink-3"
							>
								<span class="truncate">
									<PersonName name={rate.name} />
									<span class="text-[9px] tracking-wide uppercase">{m.attendance_member_inactive_badge()}</span>
								</span>
								<span class="shrink-0 font-mono">
									{m.attendance_member_count_inactive({ attended: rate.attended })}
								</span>
							</div>
						{:else}
							<div
								data-testid="member-rate-{rate.memberId}"
								role="listitem"
								class="flex items-center justify-between gap-2 text-xs"
							>
								<span class="truncate text-ink-2"><PersonName name={rate.name} /></span>
								<span class="shrink-0 font-mono text-ink">
									{m.attendance_member_rate({ attended: rate.attended, total: rate.total })}
								</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- (*MVOX:Josquin*) -->
