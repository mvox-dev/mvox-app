<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import { goto } from '$app/navigation';
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		longDayFormatter,
		tallinnDayKey
	} from '$lib/preferences/timeFormat';
	import { rowLinkLabel } from '$lib/agenda/agendaRowParts';
	import AgendaEmpty from '$lib/agenda/AgendaEmpty.svelte';
	import EventTypeBadge from '$lib/agenda/EventTypeBadge.svelte';
	import type { RsvpByEventId, RsvpStatus } from '$lib/rsvp/rsvpData';
	import RsvpControl from '$lib/components/agenda/RsvpControl.svelte';
	import RsvpNonMemberHint from '$lib/components/agenda/RsvpNonMemberHint.svelte';
	import RepertoireElement from '$lib/agenda/RepertoireElement.svelte';
	import type { WorkRow, WorksManage } from '$lib/repertoire/types';
	import AttendanceSurface from '$lib/components/attendance/AttendanceSurface.svelte';
	import type { AttendancePanel } from '$lib/attendance/types';
	import AttendanceBadge, { type BadgeStatus } from '$lib/components/attendance/AttendanceBadge.svelte';
	import TakeAttendanceButton from '$lib/components/attendance/TakeAttendanceButton.svelte';
	import { compareScheduleItems, type ScheduleItem } from '$lib/schedule/scheduleSort';

	interface Props {
		items: AgendaItem[];
		loading?: boolean;
		rsvpByEventId?: RsvpByEventId;
		membership?: 'loading' | 'member' | 'non-member';
		canRsvp?: 'loading' | 'editor' | 'not-editor';
		onrsvpchange?: (item: AgendaItem, status: RsvpStatus | null) => void;
		pendingEventIds?: ReadonlySet<string>;
		failedEventIds?: ReadonlySet<string>;
		savedEventIds?: ReadonlySet<string>;
		recentItems?: AgendaItem[];
		conductorEventIds?: ReadonlySet<string>;
		ontakeattendance?: (item: AgendaItem) => void;
		attendancePanel?: AttendancePanel;
		myAttendanceByEventId?: Record<string, BadgeStatus>;
		seasonSummary?: Snippet;
		worksByEventId?: Record<string, WorkRow[]>;
		onpdfclick?: (fileId: string) => void;
		heldFileIds?: ReadonlySet<string> | null;
		partLinkDb?: string;
		worksManage?: WorksManage;
		emptyState?: Snippet;
		recentEmptyState?: Snippet;
		scheduleItemsByEventId?: Record<string, ScheduleItem[]>;
		justCreatedEventId?: string | null;
	}
	const {
		items,
		loading = false,
		rsvpByEventId = {},
		membership = 'loading',
		canRsvp = 'loading',
		onrsvpchange,
		pendingEventIds = new Set<string>(),
		failedEventIds = new Set<string>(),
		savedEventIds = new Set<string>(),
		recentItems = [],
		conductorEventIds = new Set<string>(),
		ontakeattendance,
		attendancePanel,
		myAttendanceByEventId = {},
		seasonSummary,
		worksByEventId = {},
		onpdfclick,
		heldFileIds = null,
		partLinkDb,
		worksManage,
		emptyState,
		recentEmptyState,
		scheduleItemsByEventId = {},
		justCreatedEventId = null
	}: Props = $props();

	let showAllRecent = $state(false);

	$effect(() => {
		const id = justCreatedEventId;
		if (!id) return;
		if (recentItems.findIndex((it) => it.id === id) > 0) showAllRecent = true;
	});

	function scheduleLineText(eventId: string): string {
		const rows = scheduleItemsByEventId[eventId];
		if (!rows || rows.length === 0) return '';
		return [...rows]
			.sort(compareScheduleItems)
			.map((row) => `${formatTime(tallinnHHMM(new Date(row.datetime)), $timeFormatStore)} ${row.name}`)
			.join(' · ');
	}

	function worksContext(eventId: string): 'repertoire' | 'programme' {
		return worksByEventId[eventId]?.some((r) => r.kind === 'program') ? 'programme' : 'repertoire';
	}
	const NO_KEYS: ReadonlySet<string> = new Set<string>();
	const NO_OPTIONS: never[] = [];
	const NO_OPTIONS_BY_ID: Record<string, never[]> = {};

	function eventRightsFor(eventId: string) {
		return worksManage?.eventRightsByEventId[eventId] ?? 'not-editor';
	}
	function showWorks(eventId: string): boolean {
		if (worksByEventId[eventId]?.length) return true;
		if (!worksManage) return false;
		return worksManage.seasonRights === 'editor' || eventRightsFor(eventId) === 'editor';
	}

	function badgeStatus(eventId: string): BadgeStatus {
		return myAttendanceByEventId[eventId] ?? 'not-recorded';
	}

	const headerFmt = $derived(longDayFormatter());

	const groups = $derived.by(() => {
		const seen = new Map<string, AgendaItem[]>();
		const order: string[] = [];
		for (const item of items) {
			const d = new Date(item.startDatetime);
			const key = tallinnDayKey(d);
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

	const now = new Date();
	const todayKey = tallinnDayKey(now);
	const tomorrowKey = tallinnDayKey(
		new Date(new Date(todayKey + 'T12:00:00').getTime() + 24 * 60 * 60 * 1000)
	);

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

	const CARD_CONTROLS =
		'a, button, input, select, textarea, label, [role="button"], [role="toolbar"], [data-card-controls]';

	function openEventOnCardTap(event: MouseEvent, id: string) {
		const target = event.target as HTMLElement | null;
		if (target?.closest(CARD_CONTROLS)) return;
		void goto(`/event/${id}`);
	}
</script>

{#snippet worksElement(item: AgendaItem)}
	{#if showWorks(item.id)}
		<RepertoireElement
			rows={worksByEventId[item.id] ?? NO_OPTIONS}
			{onpdfclick}
			{heldFileIds}
			{partLinkDb}
			context={worksContext(item.id)}
			seasonRights={worksManage?.seasonRights ?? 'not-editor'}
			eventRights={eventRightsFor(item.id)}
			pickableWorksList={worksManage?.pickableWorksList ?? NO_OPTIONS}
			pickableWorksVisible={worksManage?.pickableWorksVisible}
			pickableWorksPartial={worksManage?.pickableWorksPartial ?? false}
			pickableEditions={worksManage?.pickableEditionsByEventId[item.id] ?? NO_OPTIONS}
			pickableEditionsVisible={worksManage?.pickableEditionsVisibleByEventId[item.id]}
			pickableEditionsPartial={worksManage?.pickableEditionsPartial ?? false}
			editionOptionsByRowId={worksManage?.editionOptionsByRowId ?? NO_OPTIONS_BY_ID}
			editionsResolvedWorkIds={worksManage?.editionsResolvedWorkIds ?? NO_KEYS}
			pendingKeys={worksManage?.pendingKeys ?? NO_KEYS}
			onaddwork={(workId) => worksManage?.onaddwork(workId)}
			onstatuschange={(itemId, status) => worksManage?.onstatuschange(itemId, status)}
			onpinedition={(itemId, editionId) => worksManage?.onpinedition(itemId, editionId)}
			onremoveitem={(itemId) => worksManage?.onremoveitem(item.id, itemId)}
			onmoveitem={(itemId, direction) => worksManage?.onmoveitem(item.id, itemId, direction)}
			onaddprogramitem={(editionId, ordinal) =>
				worksManage?.onaddprogramitem(item.id, editionId, ordinal)}
		/>
	{/if}
{/snippet}

{#snippet scheduleLine(item: AgendaItem)}
	{#if scheduleItemsByEventId[item.id]?.length}
		<span data-testid="agenda-schedule-line-{item.id}" class="text-[10px] text-ink-2"
			>{scheduleLineText(item.id)}</span
		>
	{/if}
{/snippet}

{#snippet rowBody(item: AgendaItem, locationTestid?: string)}
	<a
		href="/event/{item.id}"
		aria-label={rowLinkLabel(item.name)}
		class="flex min-w-0 items-baseline gap-1"
	>
		<span class="truncate text-sm text-ink">{item.name}</span>
		<span aria-hidden="true" class="text-ink-3">▸</span>
	</a>
	{#if item.eventType}
		<EventTypeBadge id={item.id} eventType={item.eventType} class="w-fit" />
	{/if}
	{#if item.location}
		<span data-testid={locationTestid} class="truncate text-xs text-ink-2">{item.location}</span>
	{/if}
	{@render worksElement(item)}
	{@render scheduleLine(item)}
{/snippet}

{#if recentItems.length > 0 || recentEmptyState}
	<section data-testid="agenda-recent" class="flex flex-col">
		<h2
			data-testid="agenda-recent-header"
			class="pt-4 pb-1 text-[10px] font-normal tracking-wide text-ink-2 uppercase"
		>
			{m.agenda_recent()}
		</h2>
		{#if seasonSummary && membership === 'member'}
			{@render seasonSummary()}
		{/if}
		{#if recentItems.length === 0 && recentEmptyState}
			{@render recentEmptyState()}
		{/if}
		{#each showAllRecent ? recentItems : recentItems.slice(0, 1) as item (item.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				data-testid="agenda-recent-row-{item.id}"
				class="grid grid-cols-[60px_1fr] gap-3 border-b border-dashed border-ink-5 py-2 last:border-b-0"
				class:bg-highlight={item.id === justCreatedEventId}
				onclick={(event) => openEventOnCardTap(event, item.id)}
			>
				{#if item.id === justCreatedEventId}
					<span data-testid="agenda-row-created-mark" aria-hidden="true" class="sr-only"></span>
				{/if}
				<a href="/event/{item.id}" aria-hidden="true" tabindex="-1" class="flex flex-col font-mono">
					<span data-testid="recent-row-date" class="text-[10px] text-ink-2">{tallinnDayKey(new Date(item.startDatetime))}</span>
					<span class="text-sm text-ink">{formatTime(tallinnHHMM(new Date(item.startDatetime)), $timeFormatStore)}</span>
					<span class="text-[10px] text-ink-2">{m.agenda_duration_min({ minutes: item.durationMinutes })}</span>
				</a>
				<div class="flex min-w-0 flex-col gap-1">
					{@render rowBody(item)}
					<RsvpControl status={rsvpByEventId[item.id]?.status ?? null} pending={true} />
					{#if membership === 'member'}
						<AttendanceBadge status={badgeStatus(item.id)} testid="attendance-badge-{item.id}" />
					{/if}
					{#if conductorEventIds.has(item.id) && ontakeattendance && !(attendancePanel && attendancePanel.item.id === item.id)}
						<TakeAttendanceButton eventName={item.name} onclick={() => ontakeattendance?.(item)} />
					{/if}
					{#if attendancePanel && attendancePanel.item.id === item.id}
						<div data-card-controls>
							<AttendanceSurface
								item={attendancePanel.item}
								members={attendancePanel.members}
								attendanceByMemberId={attendancePanel.attendanceByMemberId}
								rsvpByMemberId={attendancePanel.rsvpByMemberId}
								loading={attendancePanel.loading}
								error={attendancePanel.error}
								pendingMemberIds={attendancePanel.pendingMemberIds}
								failedMemberIds={attendancePanel.failedMemberIds}
								savedMemberIds={attendancePanel.savedMemberIds}
								membersPartial={attendancePanel.membersPartial}
								ontoggle={attendancePanel.ontoggle}
								onclose={attendancePanel.onclose}
							/>
						</div>
					{/if}
					{#if !showAllRecent && recentItems.length > 1}
						<button
							type="button"
							data-testid="agenda-recent-show-more"
							class="self-end rounded-md border border-ink px-2 py-1 font-mono text-[9px] tracking-wide text-ink hover:bg-ink hover:text-paper"
							onclick={async (event) => {
								const section = (event.currentTarget as HTMLElement).closest(
									'[data-testid="agenda-recent"]'
								);
								const firstRevealedId = recentItems[1]?.id;
								showAllRecent = true;
								await tick();
								if (!section || firstRevealedId === undefined) return;
								section
									.querySelector<HTMLElement>(
										`[data-testid="agenda-recent-row-${firstRevealedId}"] a[aria-label]`
									)
									?.focus();
							}}
						>
							{m.agenda_recent_show_more()}
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</section>
{/if}
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
		{#if emptyState}
			{@render emptyState()}
		{:else}
			<AgendaEmpty />
		{/if}
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
					class="flex items-baseline gap-2 pt-6 pb-2 text-base font-semibold tracking-wide text-ink uppercase"
					class:bg-highlight={group.relative === 'today'}
				>
					{#if group.relative === 'today'}
						<span data-testid="agenda-relative-today" class="rounded-full border border-ink px-2">{m.agenda_today()}</span>
					{:else if group.relative === 'tomorrow'}
						<span data-testid="agenda-relative-tomorrow" class="rounded-full border border-ink px-2">{m.agenda_tomorrow()}</span>
					{/if}
					<span>{group.header}</span>
				</div>
				{#each group.rows as item (item.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						data-testid="agenda-row-{item.id}"
						class="grid grid-cols-[60px_1fr] gap-3 border-b border-dashed border-ink-5 py-2 last:border-b-0"
						class:bg-highlight={item.id === justCreatedEventId}
						onclick={(event) => openEventOnCardTap(event, item.id)}
					>
						{#if item.id === justCreatedEventId}
							<span data-testid="agenda-row-created-mark" aria-hidden="true" class="sr-only"></span>
						{/if}
						<a href="/event/{item.id}" aria-hidden="true" tabindex="-1" class="flex flex-col font-mono">
							<span data-testid="row-time" class="text-sm text-ink">{formatTime(tallinnHHMM(new Date(item.startDatetime)), $timeFormatStore)}</span>
							<span data-testid="row-duration" class="text-[10px] text-ink-2">{m.agenda_duration_min({ minutes: item.durationMinutes })}</span>
						</a>
						<div class="flex min-w-0 flex-col gap-1">
							{@render rowBody(item, 'row-location')}
							{#if membership === 'non-member'}
								<RsvpNonMemberHint />
							{:else if canRsvp !== 'not-editor'}
								<RsvpControl
									status={rsvpByEventId[item.id]?.status ?? null}
									pending={canRsvp === 'loading' || pendingEventIds.has(item.id)}
									saveFailed={failedEventIds.has(item.id)}
									saved={savedEventIds.has(item.id)}
									onchange={(newStatus) => onrsvpchange?.(item, newStatus)}
								/>
							{/if}
						</div>
					</div>
				{/each}
			</section>
		{/each}
	{/if}
</div>
