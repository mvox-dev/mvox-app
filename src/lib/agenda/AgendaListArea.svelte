<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import AgendaList from '$lib/agenda/AgendaList.svelte';
	import AgendaMonthView from '$lib/agenda/AgendaMonthView.svelte';
	import AgendaTypeFilter from '$lib/agenda/AgendaTypeFilter.svelte';
	import AgendaViewToggle from '$lib/agenda/AgendaViewToggle.svelte';
	import ListOfStuff from '$lib/components/ListOfStuff.svelte';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
	import { agendaViewStore } from '$lib/preferences/agendaView';
	import { completionGateStore } from '$lib/profile/completionGate';
	import {
		attendancePanelOf,
		myAttendanceByEventIdOf,
		mySeasonRateOf
	} from '$lib/agenda/agendaWorksManage';
	import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
	import type { AgendaPageView } from '$lib/agenda/agendaPageView.svelte';

	type ListProps = ComponentProps<typeof AgendaList>;

	let {
		ag,
		view,
		selected,
		pendingEventIds,
		justCreatedEventId,
		onpdfclick,
		onrsvpchange,
		ontakeattendance,
		onexpandseasonsummary,
		onattendancetoggle,
		onattendanceclose
	}: {
		ag: AgendaLoadState;
		view: AgendaPageView;
		selected: { db: string };
		pendingEventIds: Set<string>;
		justCreatedEventId: string | null;
		onpdfclick: ListProps['onpdfclick'];
		onrsvpchange: ListProps['onrsvpchange'];
		ontakeattendance: ListProps['ontakeattendance'];
		onexpandseasonsummary: () => void;
		onattendancetoggle: Parameters<typeof attendancePanelOf>[1];
		onattendanceclose: Parameters<typeof attendancePanelOf>[2];
	} = $props();

	const attendancePanel = $derived(attendancePanelOf(ag, onattendancetoggle, onattendanceclose));
	const myAttendanceByEventId = $derived(myAttendanceByEventIdOf(ag.myAttendance));
	const mySeasonRate = $derived(mySeasonRateOf(ag));

	const gatedMembership = $derived(
		ag.membership === 'member' && $completionGateStore !== 'complete' ? 'loading' : ag.membership
	);
	const gatedCanRsvp = $derived(
		ag.rsvpRights === 'not-editor'
			? 'not-editor'
			: $completionGateStore !== 'complete'
				? 'loading'
				: ag.rsvpRights
	);
</script>

{#snippet typeFilter()}
	<AgendaTypeFilter
		chips={view.agendaFilterChips}
		filter={ag.agendaTypeFilter}
		onselect={view.selectAgendaTypeFilter}
	/>
{/snippet}
{#snippet viewToggle()}
	<AgendaViewToggle />
{/snippet}
{#snippet agendaFilterEmptyState()}
	<div data-testid="agenda-filter-empty" class="flex min-h-[30vh] items-center justify-center">
		<p class="font-display text-xl text-ink-2">{m.agenda_filter_empty()}</p>
	</div>
{/snippet}
{#snippet agendaRecentFilterEmptyState()}
	<p data-testid="agenda-recent-filter-empty" class="py-2 text-sm text-ink-2">
		{m.agenda_filter_recent_empty()}
	</p>
{/snippet}
<ListOfStuff
	title={m.nav_agenda()}
	filter={view.agendaFilterChips.length > 0 ? typeFilter : undefined}
	view={view.agendaFilterChips.length > 0 ? viewToggle : undefined}
>
{#if $agendaViewStore === 'list'}
	{#key selected?.db}
	<AgendaList
		items={view.filteredAgendaItems}
		loading={ag.agendaLoading}
		rsvpByEventId={ag.rsvpByEventId}
		membership={gatedMembership}
		canRsvp={gatedCanRsvp}
		{pendingEventIds}
		failedEventIds={ag.failedEventIds}
		savedEventIds={ag.savedEventIds}
		recentItems={view.filteredRecentItems}
		conductorEventIds={ag.attendanceEventIds}
		{myAttendanceByEventId}
		worksByEventId={ag.worksByEventId}
		worksManage={view.worksManage}
		heldFileIds={ag.heldFileIds}
		partLinkDb={selected.db}
		scheduleItemsByEventId={ag.scheduleByEventId}
		{attendancePanel}
		{justCreatedEventId}
		emptyState={ag.agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
		recentEmptyState={ag.agendaTypeFilter !== 'all' && ag.recentItems.length > 0
			? agendaRecentFilterEmptyState
			: undefined}
		{onpdfclick}
		{onrsvpchange}
		{ontakeattendance}
	>
		{#snippet seasonSummary()}
			<SeasonSummary
				myRate={mySeasonRate}
				canExpand={ag.seasonManageRights === 'editor'}
				expanded={ag.seasonSummaryExpanded}
				memberRates={ag.seasonMemberRates}
				membersPartial={ag.seasonRatesPartial}
				loading={ag.seasonRatesLoading}
				error={ag.seasonRatesError}
				onexpand={onexpandseasonsummary}
			/>
		{/snippet}
	</AgendaList>
	{/key}
{:else}
	<AgendaMonthView
		items={view.filteredAgendaItems}
		loading={ag.agendaLoading}
		{justCreatedEventId}
		emptyState={ag.agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
	/>
{/if}
</ListOfStuff>
{#if ag.manageError}
	<FormError data-testid="repertoire-manage-error" class="pt-2">
		{m.repertoire_manage_error()}
	</FormError>
{/if}
<div data-testid="repertoire-manage-status" role="status" aria-live="polite" class="sr-only">
	{ag.manageStatus}
</div>
