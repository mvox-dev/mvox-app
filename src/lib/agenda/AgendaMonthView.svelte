<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import { rowLinkLabel } from '$lib/agenda/agendaRowParts';
	import AgendaEmpty from '$lib/agenda/AgendaEmpty.svelte';
	import EventTypeBadge from '$lib/agenda/EventTypeBadge.svelte';
	import { groupByMonth, monthLabel, tallinnDayKey } from '$lib/preferences/timeFormat';

	interface Props {
		items: AgendaItem[];
		loading?: boolean;
		emptyState?: Snippet;
		justCreatedEventId?: string | null;
	}

	const { items, loading = false, emptyState, justCreatedEventId = null }: Props = $props();

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

	const monthGroups = $derived(
		groupByMonth(
			items.map((item) => ({ item, dayKey: tallinnDayKey(new Date(item.startDatetime)) })),
			(row) => row.dayKey
		).map((group) => ({ key: group.month, label: monthLabel(group.month), rows: group.items }))
	);
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
			<AgendaEmpty />
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
								<EventTypeBadge id={item.id} eventType={item.eventType} class="shrink-0" />
							{/if}
						</a>
					</div>
				{/each}
			</section>
		{/each}
	{/if}
</div>
