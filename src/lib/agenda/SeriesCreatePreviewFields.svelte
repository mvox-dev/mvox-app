<!-- The series create form's preview fieldset: the date grid, run notices and the buttons. -->
<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import FormActions from '$lib/components/FormActions.svelte';
	import { monthLabel } from '$lib/preferences/timeFormat';
	import type { SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';

	interface Props {
		monthGroups: Array<{ month: string; items: string[] }> | null;
		previewDates: string[] | null;
		resume: SeriesResumeEntry | null;
		skipDates: string[];
		locked: boolean;
		hiddenCount: number;
		nextBatchSize: number;
		showAllCount: number;
		progress: { current: number; total: number } | null;
		error: (() => string) | null;
		submitting: boolean;
		nothingToSubmit: boolean;
		isOffline: boolean;
		isoDay: (date: string) => string;
		ontoggleskip: (iso: string) => void;
		onrevealnext: () => void;
		onrevealall: () => void;
		onsubmit: () => void;
		oncancel: () => void;
	}

	let {
		monthGroups,
		previewDates,
		resume,
		skipDates,
		locked,
		hiddenCount,
		nextBatchSize,
		showAllCount,
		progress,
		error,
		submitting,
		nothingToSubmit,
		isOffline,
		isoDay,
		ontoggleskip,
		onrevealnext,
		onrevealall,
		onsubmit,
		oncancel
	}: Props = $props();
</script>

<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
	<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
		{m.series_create_group_preview_label()}
	</legend>
	{#if monthGroups !== null}
		<div data-testid="series-create-preview" class="text-xs text-ink-2">
			<p class="tracking-wide uppercase">
				{m.series_create_preview_label()}
			</p>
			{#if !resume && previewDates !== null}
				<p data-testid="series-create-preview-count" class="text-ink">
					{previewDates.length === 1
						? m.series_create_preview_count_one()
						: m.series_create_preview_count_other({
								count: previewDates.length
							})}
				</p>
			{/if}
			<div class="flex flex-col gap-2">
				{#each monthGroups as group (group.month)}
					<div class="flex flex-col gap-1.5">
						<h4
							data-testid="series-create-month-{group.month}"
							class="text-xs tracking-wide text-ink-2 uppercase"
						>
							{monthLabel(group.month)}
						</h4>
						<div class="flex flex-wrap gap-1.5">
							{#each group.items as date (date)}
								{@const iso = isoDay(date)}
								{@const skipped = !resume && skipDates.includes(iso)}
								<button
									type="button"
									data-testid="series-create-date-{iso}"
									aria-pressed={skipped ? 'false' : 'true'}
									aria-label={skipped ? m.series_create_date_skipped({ date: iso }) : undefined}
									disabled={locked}
									class="flex min-h-11 min-w-11 items-center justify-center border border-ink-5 px-1.5 text-xs disabled:opacity-50 {skipped
										? 'text-ink-2 line-through'
										: 'text-ink'}"
									onclick={() => ontoggleskip(iso)}
								>
									{iso}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			{#if hiddenCount > 0}
				<div class="flex gap-2">
					<button
						type="button"
						data-testid="series-create-show-next"
						class="flex min-h-11 items-center border border-ink-5 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
						onclick={onrevealnext}
					>
						{m.series_create_show_next_label({ count: nextBatchSize })}
					</button>
					<button
						type="button"
						data-testid="series-create-show-all"
						class="flex min-h-11 items-center border border-ink-5 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
						onclick={onrevealall}
					>
						{m.series_create_show_all_label({
							count: showAllCount
						})}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if resume}
		<p data-testid="series-create-resume" class="text-xs text-ink-2">
			{m.series_create_resume_notice({
				remaining: resume.remaining.length,
				total: resume.total
			})}
		</p>
	{/if}

	{#if progress}
		<p data-testid="series-create-progress" role="status" class="text-xs text-ink-2">
			{m.series_create_progress({
				current: progress.current,
				total: progress.total
			})}
		</p>
	{/if}

	{#if error}
		<FormError id="series-create-error" data-testid="series-create-error">
			{error()}
		</FormError>
	{/if}

	<FormActions
		testid="series-create"
		submitLabel={m.series_create_submit()}
		cancelLabel={m.roster_cancel()}
		{submitting}
		{isOffline}
		submitBlocked={nothingToSubmit}
		{onsubmit}
		{oncancel}
	/>
</fieldset>
