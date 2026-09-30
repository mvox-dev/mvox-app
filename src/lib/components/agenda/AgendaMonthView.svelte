<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import { eventTypeLabel } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { isoDateFormatter, TALLINN_TZ } from '$lib/preferences/timeFormat';

	interface Props {
		items: AgendaItem[];
		loading?: boolean;
		emptyState?: Snippet;
		justCreatedEventId?: string | null;
	}

	const { items, loading = false, emptyState, justCreatedEventId = null }: Props = $props();

	const dayKeyFmt = isoDateFormatter(TALLINN_TZ);

	const monthHeaderFmt = $derived(
		new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' })
	);

	function rowLinkLabel(name: string): string {
		return name.trim() === ''
			? m.agenda_row_link_label_unnamed()
			: m.agenda_row_link_label({ event: name });
	}

	function weekdayKey(dayKey: string): string {
		const weekday = new Date(dayKey + 'T12:00:00').getDay();
		const keys = [
			m.agenda_weekday_short_0,
			m.agenda_weekday_short_1,
			m.agenda_weekday_short_2,
			m.agenda_weekday_short_3,
			m.agenda_weekday_short_4,
			m.agenda_weekday_short_5,
			m.agenda_weekday_short_6
		];
		return keys[weekday]();
	}

	function dayOfMonth(dayKey: string): number {
		return Number(dayKey.slice(8, 10));
	}

	const monthGroups = $derived.by(() => {
		const groups: { key: string; label: string; rows: { item: AgendaItem; dayKey: string }[] }[] =
			[];
		for (const item of items) {
			const dayKey = dayKeyFmt.format(new Date(item.startDatetime));
			const month = dayKey.slice(0, 7);
			const current = groups[groups.length - 1];
			const row = { item, dayKey };
			if (current && current.key === month) {
				current.rows.push(row);
			} else {
				const [year, monthNum] = month.split('-').map(Number);
				groups.push({
					key: month,
					label: monthHeaderFmt.format(new Date(year, monthNum - 1, 1)),
					rows: [row]
				});
			}
		}
		return groups;
	});
</script>

<div data-testid="agenda-month-list" class="flex flex-col">
	{#if loading}
		<div data-testid="agenda-skeleton" class="flex flex-col" aria-hidden="true">
			{#each [0, 1, 2] as skeletonRow (skeletonRow)}
				<div data-testid="agenda-skeleton-row" class="flex items-center gap-3 py-2 animate-pulse">
					<div class="h-3 w-12 rounded bg-ink-5"></div>
					<div class="h-3 w-2/3 rounded bg-ink-5"></div>
				</div>
			{/each}
		</div>
	{:else if items.length === 0}
		{#if emptyState}
			{@render emptyState()}
		{:else}
			<div data-testid="agenda-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.agenda_empty_no_events()}</p>
			</div>
		{/if}
	{:else}
		{#each monthGroups as group (group.key)}
			<section data-testid="agenda-month-group" class="flex flex-col">
				<h2
					data-testid="agenda-month-header"
					class="pt-6 pb-2 text-base font-semibold tracking-wide text-ink uppercase"
				>
					{group.label}
				</h2>
				{#each group.rows as { item, dayKey } (item.id)}
					<div
						data-testid="agenda-month-row-{item.id}"
						class="border-b border-dashed border-ink-5 py-1.5 last:border-b-0"
						class:bg-highlight={item.id === justCreatedEventId}
					>
						{#if item.id === justCreatedEventId}
							<span data-testid="agenda-row-created-mark" aria-hidden="true" class="sr-only"></span>
						{/if}
						<a
							href="/event/{item.id}"
							aria-label={rowLinkLabel(item.name)}
							class="flex min-w-0 items-center gap-2 font-mono"
						>
							<span
								data-testid="month-row-date"
								class="min-w-[3rem] shrink-0 text-xs text-ink-2 tabular-nums"
								>{weekdayKey(dayKey)} {dayOfMonth(dayKey)}</span
							>
							<span class="min-w-0 flex-1 truncate text-sm text-ink">{item.name}</span>
							{#if item.eventType}
								<span
									data-testid="event-type-badge-{item.id}"
									class="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] tracking-wide uppercase {eventTypeBadgeClass(
										item.eventType
									)}"
								>
									{eventTypeLabel(item.eventType)}
								</span>
							{/if}
						</a>
					</div>
				{/each}
			</section>
		{/each}
	{/if}
</div>
