<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import SectionPicker from '$lib/sections/SectionPicker.svelte';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { Collective } from '$lib/collectives/types';
	import type { AdminState } from '$lib/nav/adminStore';
	import type { MemberOpsState, RosterState } from '$lib/roster/rosterPageState';
	import type { MemberOps } from '$lib/roster/rosterMemberOps';
	import {
		formatJoinStateDate,
		JOIN_STATE_BADGE_CLASS,
		JOIN_STATE_LABEL,
		joinStateLine
	} from '$lib/roster/joinStateView';
	import MemberRecordEditor from '$lib/roster/MemberRecordEditor.svelte';
	import { sectionNamesFor } from '$lib/sections/sectionTree';
	import MemberInvite from '$lib/roster/MemberInvite.svelte';
	import MemberDeactivate from '$lib/roster/MemberDeactivate.svelte';

	let {
		row,
		showSection,
		groupSectionId,
		admin,
		selected,
		isOffline,
		roster,
		memberOps,
		ops,
		sectionNameById
	}: {
		row: RosterRow;
		showSection: boolean;
		groupSectionId: string | null;
		admin: AdminState;
		selected: Collective | null;
		isOffline: boolean;
		roster: RosterState;
		memberOps: MemberOpsState;
		ops: MemberOps;
		sectionNameById: Map<string, string>;
	} = $props();

	const rowSectionNames = $derived(sectionNamesFor(row.sectionIds, sectionNameById));
	const memberSectionIds = $derived(row.sectionIds ?? []);
	const pickerRenderIds = $derived(
		groupSectionId === null
			? memberSectionIds
			: memberSectionIds.filter((id) => id === groupSectionId)
	);
	const line = $derived(joinStateLine(row, roster.joinStateDetails));
</script>

<li
	data-testid="roster-row-{row.memberId}"
	class="relative flex min-h-11 flex-col gap-0.5 border-b border-dashed border-ink-5 py-2 last:border-b-0"
>
	<span data-testid="roster-row-name" class="text-sm text-ink"><RedactedText>{row.name}</RedactedText></span>
	{#if row.email}
		<span data-testid="roster-row-email" class="text-xs text-ink-2"><RedactedText>{row.email}</RedactedText></span>
	{/if}
	{#if line !== undefined}
		<span
			data-testid="roster-row-join-state-{row.memberId}"
			data-join-state={line.display}
			class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {JOIN_STATE_BADGE_CLASS[
				line.display
			]}"
		>
			{JOIN_STATE_LABEL[line.display]({ date: formatJoinStateDate(line.at) })}
		</span>
	{/if}
	{#if showSection && rowSectionNames.length > 0}
		<span data-testid="roster-row-section" class="text-xs text-ink-2">{rowSectionNames.join(', ')}</span>
	{/if}
	{#if admin === 'admin' && memberOps.recordEditorMemberId !== row.memberId}
		<button
			type="button"
			data-testid="roster-row-card-{row.memberId}"
			class="absolute inset-0 rounded-md border border-ink-5 text-left hover:border-ink-3 focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
			onclick={() => ops.openRecordEditor(row)}
		>
			<span class="sr-only">{m.roster_record_edit_label()} <RedactedText>{row.profileName ?? row.name}</RedactedText></span>
		</button>
	{/if}
	{#if admin === 'admin' && memberOps.recordEditorMemberId === row.memberId}
		<div class="mt-1 flex flex-col gap-2">
			<MemberRecordEditor {row} {memberOps} {ops} {isOffline} />
			<MemberInvite {row} {roster} {memberOps} {ops} {isOffline} />
		</div>
	{/if}
	{#if admin === 'admin' && row.personId !== selected?.personId && (memberOps.recordEditorMemberId === row.memberId || memberOps.pendingDeactivateId === row.memberId)}
		<MemberDeactivate {row} {selected} {memberOps} {ops} {isOffline} />
	{/if}
	{#if row.ownerIds?.includes(selected?.personId ?? '') && !roster.sectionsError}
		<div class="absolute top-1 right-1">
			<SectionPicker
				memberId={row.memberId}
				memberName={row.profileName ?? row.name}
				sections={roster.sections}
				selectedIds={memberSectionIds}
				renderIds={pickerRenderIds}
				busy={memberOps.sectionBusyIds.has(row.memberId) || isOffline}
				onassign={(sectionId) => ops.handleAssign(row.memberId, sectionId)}
				onunassign={(sectionId) => ops.handleUnassign(row.memberId, sectionId)}
				onmove={(fromId, toId) => ops.handleMove(row.memberId, fromId, toId)}
			/>
		</div>
		{#if memberOps.sectionWriteError?.memberId === row.memberId}
			<p
				data-testid="section-write-error-{row.memberId}"
				role="alert"
				class="relative text-xs text-red-700"
			>
				{m.roster_section_write_failed()}
			</p>
		{/if}
	{/if}
</li>
