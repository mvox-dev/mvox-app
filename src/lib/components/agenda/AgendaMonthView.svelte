<!-- src/lib/components/agenda/AgendaMonthView.svelte -->
<script lang="ts">
	// #247 — the month overview: a compact per-month listing behind the
	// Nimekiri|Kuu toggle (Ruled 2026-09-06). A SIBLING of AgendaList, not a
	// branch inside it — AgendaList stays byte-unchanged (every pre-existing
	// agenda/AgendaList spec is the fence) and this component owns the whole
	// leaner second view instead of interleaving a second row-shape into the
	// rich one AgendaList already renders.
	//
	// SCOPE (Gama's ruling comment): this component takes `items` (upcoming)
	// ONLY — no `recentItems` prop exists here at all, so there is nothing to
	// accidentally render. The current month therefore shows only its
	// remainder; that is the ruling, not a gap.
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import { eventTypeLabel } from '$lib/events/eventTypeLabels';
	// #211 — the SAME color scheme the day list and the filter chips use.
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	// #251 — month headings follow the APP language, not the device's.
	import { getLocale } from '$lib/paraglide/runtime.js';
	// #231 — the shared Tallinn-zoned ISO-date factory (same one AgendaList's
	// own groupKeyFmt uses), so the month-boundary Tallinn discipline here is
	// identical to the day list's, not a second hand-rolled timezone path.
	import { isoDateFormatter } from '$lib/preferences/timeFormat';

	interface Props {
		items: AgendaItem[];
		loading?: boolean;
		// #214 — the SAME filter-agnostic seam AgendaList carries, because #214's
		// rule is about the agenda, not about one of its two views: "a filter
		// yielding zero rows" and "no upcoming events" are different truths in
		// month mode too. This component knows nothing about filters — it renders
		// whatever the caller hands it here INSTEAD OF its own default
		// agenda_empty_no_events message, whenever items is empty and loading is
		// false. Omitted = the original default paragraph.
		emptyState?: Snippet;
	}

	const { items, loading = false, emptyState }: Props = $props();

	const TZ = 'Europe/Tallinn';
	const dayKeyFmt = isoDateFormatter(TZ);

	/** Localized month heading, e.g. "juuni 2030" / "June 2030" — the app
	 *  language via getLocale() (#251's rule), never the device locale. */
	const monthHeaderFmt = $derived(
		new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' })
	);

	/** Accessible name for a row's event-detail link — same shape as
	 *  AgendaList's own rowLinkLabel (an unnamed event still gets a
	 *  screen-reader-sane floor, never a blank). */
	function rowLinkLabel(name: string): string {
		return name.trim() === ''
			? m.agenda_row_link_label_unnamed()
			: m.agenda_row_link_label({ event: name });
	}

	/** The short-weekday locale key for `date`'s TALLINN calendar day — via the
	 *  Tallinn Y-M-D (dayKeyFmt), then a noon-anchored local `Date` so
	 *  `.getDay()` reads the calendar date's weekday, never the UTC one (the
	 *  #247 month-boundary trap: 2030-06-30T22:00Z is Tallinn July 1st,
	 *  Monday — a raw `date.getUTCDay()`/`.getDay()` on the instant itself
	 *  would say Sunday). Sun=0…Sat=6, matching `agenda_weekday_short_N`. */
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

	/** `dayKey` ('YYYY-MM-DD') → day-of-month number, no leading zero — the
	 *  month is named once in the section heading (ruling 11), so the row
	 *  never repeats it. */
	function dayOfMonth(dayKey: string): number {
		return Number(dayKey.slice(8, 10));
	}

	/** Items grouped by Tallinn calendar month (YYYY-MM), preserving the
	 *  chronological order `items` already arrives in — the same run-length
	 *  grouping idiom as +page.svelte's seriesCreateMonthGroups, applied to
	 *  the Tallinn day key rather than a local wall-clock string. */
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
					<!-- Same 3rem date column the real rows use, so the skeleton does not
					     reflow the list the moment the data lands. -->
					<div class="h-3 w-12 rounded bg-ink-5"></div>
					<div class="h-3 w-2/3 rounded bg-ink-5"></div>
				</div>
			{/each}
		</div>
	{:else if items.length === 0}
		{#if emptyState}
			<!-- #214 — the page substitutes its own filtered-empty message here
			     (agenda-filter-empty) when a type filter, not a genuinely empty
			     agenda, is what emptied `items`. Same contract as AgendaList's:
			     this component never decides which, it just renders what it's
			     given. -->
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
					>
						<a
							href="/event/{item.id}"
							aria-label={rowLinkLabel(item.name)}
							class="flex min-w-0 items-center gap-2 font-mono"
						>
							<!-- The date column holds up to 5 characters — a two-character
							     weekday key plus a two-digit day ('Нд 30' in uk, 'Se 28' in
							     lv, 'Su 30' in en; et's single letters are the narrow case,
							     'E 12'). At text-xs (12px) a monospace advance of ~0.6em puts
							     that near 36px, so the old w-8 (32px) overflowed into the
							     adjacent title on three of four locales — `shrink-0` with no
							     clipping means the excess RUNS OVER the neighbour rather than
							     being contained. min-w rather than a fixed w: the column still
							     aligns down the whole list at 3rem, and any future locale whose
							     key is wider grows the column instead of colliding again. -->
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

<!-- (*MVOX:Byrd* — #247 GREEN: the month overview, a sibling of AgendaList that consumes `items` only per Gama's scope ruling) -->
<!-- (*MVOX:Byrd* — #247 review fixes: F1 the #214 `emptyState` seam, F2 the date-column width) -->
