<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { SectionGroup, SectionNode } from '$lib/sections/sectionData';
	import type { Collective } from '$lib/collectives/types';
	import type { AdminState } from '$lib/nav/adminStore';
	import type { MemberOpsState, RosterState } from '$lib/roster/rosterPageState';
	import type { MemberOps } from '$lib/roster/rosterMemberOps';
	import MemberRow from '$lib/roster/MemberRow.svelte';

	let {
		visibleSections,
		groupById,
		unassignedGroup,
		onToggleSection,
		admin,
		selected,
		isOffline,
		roster,
		memberOps,
		ops,
		sectionNameById
	}: {
		visibleSections: SectionNode[];
		groupById: Map<string, SectionGroup>;
		unassignedGroup: SectionGroup | null;
		onToggleSection: (id: string) => void;
		admin: AdminState;
		selected: Collective | null;
		isOffline: boolean;
		roster: RosterState;
		memberOps: MemberOpsState;
		ops: MemberOps;
		sectionNameById: Map<string, string>;
	} = $props();
</script>

{#snippet memberRow(row: RosterRow, showSection: boolean, groupSectionId: string | null)}
	<MemberRow
		{row}
		{showSection}
		{groupSectionId}
		{admin}
		{selected}
		{isOffline}
		{roster}
		{memberOps}
		{ops}
		{sectionNameById}
	/>
{/snippet}

{#snippet sectionGroup(node: SectionNode)}
	{@const group = groupById.get(node.id)}
	{@const isExpanded = roster.expandedIds.has(node.id)}
	<section
		data-testid="section-group-{node.id}"
		data-depth={node.depth}
		class="flex flex-col"
		style="margin-left: {node.depth === 0 ? 0 : 1}rem"
	>
		<div class="flex items-center gap-2 py-1.5">
			<button
				type="button"
				data-testid="section-toggle-{node.id}"
				aria-expanded={isExpanded}
				aria-controls={isExpanded ? `section-region-${node.id}` : undefined}
				class="flex items-center gap-2 text-left"
				onclick={() => onToggleSection(node.id)}
			>
				<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
				<span data-testid="section-header-{node.id}" class="text-sm font-medium text-ink">
					{node.name} ({group?.memberCount ?? 0})
				</span>
			</button>
		</div>
		{#if node.parentDamaged}
			<p data-testid="section-parent-damaged-{node.id}" role="alert" class="text-sm text-red-700">
				{m.roster_section_parent_damaged({ name: node.name })}
			</p>
		{/if}
		{#if isExpanded}
			<div id="section-region-{node.id}" class="contents">
				<ul class="flex flex-col pl-5">
					{#each group?.members ?? [] as row (row.memberId)}
						{@render memberRow(row, false, node.id)}
					{/each}
				</ul>
				{#each node.children as child (child.id)}
					{@render sectionGroup(child)}
				{/each}
			</div>
		{/if}
	</section>
{/snippet}

<div data-testid="roster-groups" class="flex flex-col">
	{#each visibleSections as node (node.id)}
		{@render sectionGroup(node)}
	{/each}
	{#if unassignedGroup}
		{@const isExpanded = roster.expandedIds.has('unassigned')}
		<section data-testid="section-group-unassigned" data-depth="0" class="flex flex-col">
			<button
				type="button"
				data-testid="section-toggle-unassigned"
				aria-expanded={isExpanded}
				aria-controls={isExpanded ? 'section-region-unassigned' : undefined}
				class="flex items-center gap-2 py-1.5 text-left"
				onclick={() => onToggleSection('unassigned')}
			>
				<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
				<span data-testid="section-header-unassigned" class="text-sm font-medium text-ink">
					{m.roster_unassigned()} ({unassignedGroup.memberCount})
				</span>
			</button>
			{#if isExpanded}
				<ul id="section-region-unassigned" class="flex flex-col pl-5">
					{#each unassignedGroup.members as row (row.memberId)}
						{@render memberRow(row, false, null)}
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
