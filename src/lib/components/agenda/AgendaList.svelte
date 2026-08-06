<!-- src/lib/components/agenda/AgendaList.svelte -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import type { RsvpByEventId, RsvpStatus } from '$lib/rsvp/rsvpData';
	import RsvpControl from './RsvpControl.svelte';

	interface Props {
		items: AgendaItem[];
		loading?: boolean;
		// #12 — one RsvpControl per row, seeded from rsvpByEventId (absent entry =
		// unanswered, never defaulted — #11's display AC), disabled when memberId
		// is null (non-member). onrsvpchange forwards (item, status) up so the
		// page can own the optimistic write (keeps this component's test unit-level).
		rsvpByEventId?: RsvpByEventId;
		memberId?: string | null;
		onrsvpchange?: (item: AgendaItem, status: RsvpStatus | null) => void;
	}
	const { items, loading = false, rsvpByEventId = {}, memberId = null, onrsvpchange }: Props = $props();

	// Tallinn IANA timezone — Europe/Tallinn (UTC+3 in summer, UTC+2 in winter)
	// PRESERVED VERBATIM from the harvested AgendaList (old mvox_v4e_web repo) — see
	// T5 build spec §3. Do not touch the TZ constant, the three formatters below, or
	// the `groups` derivation without re-checking the DST edge cases they guard.
	const TZ = 'Europe/Tallinn';

	// Grouping key: YYYY-MM-DD in Tallinn calendar day (en-CA gives ISO date format)
	const groupKeyFmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});

	// Locale-aware long header text: "Monday, 15 June" (locale of the browser)
	const headerFmt = new Intl.DateTimeFormat(undefined, {
		timeZone: TZ,
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});

	// Time-of-day HH:MM (24h, Tallinn)
	const timeFmt = new Intl.DateTimeFormat('en-GB', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});

	/** Group items by Tallinn calendar date, preserving chronological order. */
	const groups = $derived.by(() => {
		const seen = new Map<string, AgendaItem[]>();
		const order: string[] = [];
		for (const item of items) {
			const d = new Date(item.startDatetime);
			const key = groupKeyFmt.format(d);
			if (!seen.has(key)) {
				seen.set(key, []);
				order.push(key);
			}
			seen.get(key)!.push(item);
		}
		return order.map((key) => ({
			key,
			header: headerFmt.format(new Date(key + 'T12:00:00')), // noon avoids DST edge on the key date
			rows: seen.get(key)!
		}));
	});

	// --- T5 additions below: relative-day labels + multi-week gap markers. Layered
	// on top of `groups` rather than folded in, so the verbatim block above stays
	// untouched. `now` is read once at component init — fine for a page-load list;
	// revisit if the agenda is ever kept open across a real midnight.
	const now = new Date();
	const todayKey = groupKeyFmt.format(now);
	// Same noon-anchor trick as `header` above: reformat today's noon instant +24h
	// through the Tallinn-zoned formatter, so a DST transition can't shift the day.
	const tomorrowKey = groupKeyFmt.format(
		new Date(new Date(todayKey + 'T12:00:00').getTime() + 24 * 60 * 60 * 1000)
	);

	/**
	 * Whole weeks between two group keys, or null when the gap doesn't clear a
	 * genuine multi-week break. M4 fix: the old `days < 6` threshold fired at a
	 * normal weekly rehearsal cadence (≥6 days apart) — "In 1 weeks" showed up on
	 * every ordinary week. Require ~2 weeks (13+ days) before the marker appears.
	 */
	function gapWeeks(fromKey: string, toKey: string): number | null {
		const fromMs = new Date(fromKey + 'T12:00:00').getTime();
		const toMs = new Date(toKey + 'T12:00:00').getTime();
		const days = Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
		if (days < 13) return null;
		return Math.max(1, Math.round(days / 7));
	}

	const decoratedGroups = $derived.by(() => {
		let prevKey: string | null = null;
		return groups.map((group) => {
			const gap = prevKey ? gapWeeks(prevKey, group.key) : null;
			prevKey = group.key;
			const relative: 'today' | 'tomorrow' | null =
				group.key === todayKey ? 'today' : group.key === tomorrowKey ? 'tomorrow' : null;
			return { ...group, relative, gapWeeks: gap };
		});
	});
</script>

<div data-testid="agenda-list" class="flex flex-col">
	{#if loading}
		<div data-testid="agenda-skeleton" class="flex flex-col" aria-hidden="true">
			{#each [0, 1, 2] as skeletonRow (skeletonRow)}
				<div data-testid="agenda-skeleton-row" class="grid grid-cols-[60px_1fr] gap-3 py-2 animate-pulse">
					<div class="h-4 w-10 rounded bg-ink-5"></div>
					<div class="flex flex-col gap-1.5 pt-0.5">
						<div class="h-3 w-2/3 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if items.length === 0}
		<div data-testid="agenda-empty" class="flex min-h-[30vh] items-center justify-center">
			<p class="font-display text-xl text-ink-2">{m.agenda_empty_no_rehearsals()}</p>
		</div>
	{:else}
		{#each decoratedGroups as group (group.key)}
			{#if group.gapWeeks}
				<div data-testid="agenda-gap-marker" class="py-3 text-center font-mono text-[10px] tracking-wide text-ink-2">
					{m.agenda_gap_weeks({ weeks: group.gapWeeks })}
				</div>
			{/if}
			<section data-testid="agenda-day-group" class="flex flex-col">
				<div
					data-testid="agenda-date-header"
					class="flex items-baseline gap-2 pt-4 pb-1 text-[10px] tracking-wide text-ink-2 uppercase"
					class:bg-highlight={group.relative === 'today'}
				>
					{#if group.relative === 'today'}
						<span data-testid="agenda-relative-today" class="font-semibold text-ink">{m.agenda_today()}</span>
					{:else if group.relative === 'tomorrow'}
						<span data-testid="agenda-relative-tomorrow" class="font-semibold text-ink">{m.agenda_tomorrow()}</span>
					{/if}
					<span>{group.header}</span>
				</div>
				{#each group.rows as item (item.id)}
					<div data-testid="agenda-row-{item.id}" class="grid grid-cols-[60px_1fr] gap-3 border-b border-dashed border-ink-5 py-2 last:border-b-0">
						<div class="flex flex-col font-mono">
							<span data-testid="row-time" class="text-sm text-ink">{timeFmt.format(new Date(item.startDatetime))}</span>
							<span data-testid="row-duration" class="text-[10px] text-ink-2">{m.agenda_duration_min({ minutes: item.durationMinutes })}</span>
						</div>
						<div class="flex min-w-0 flex-col gap-1">
							<span class="truncate text-sm text-ink">{item.name}</span>
							{#if item.location}
								<span data-testid="row-location" class="truncate text-xs text-ink-2">{item.location}</span>
							{/if}
							<RsvpControl
								status={rsvpByEventId[item.id]?.status ?? null}
								disabled={memberId === null}
								onchange={(newStatus) => onrsvpchange?.(item, newStatus)}
							/>
						</div>
					</div>
				{/each}
			</section>
		{/each}
	{/if}
</div>
