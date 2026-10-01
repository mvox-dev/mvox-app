<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { SectionNode } from '$lib/sections/sectionData';
	import { findSectionNode, flattenSections, type ArrangeRow } from '$lib/sections/sectionTree';
	import type { ArrangeOps, ArrangeState } from '$lib/sections/sectionArrangeOps';
	import { rovingStop, type ArrangeDrag } from '$lib/sections/sectionDrag';
	import type { RosterState } from '$lib/roster/rosterPageState';
	import type { AdminState } from '$lib/nav/adminStore';
	import SectionArrangeRow from '$lib/sections/SectionArrangeRow.svelte';
	import { focusOnMount } from '$lib/a11y/focusable';

	let {
		roster,
		arrange,
		ops,
		drag,
		arrangeRows,
		visibleSections,
		admin,
		isOffline,
		isOwnDbEntitySection
	}: {
		roster: RosterState;
		arrange: ArrangeState;
		ops: ArrangeOps;
		drag: ArrangeDrag;
		arrangeRows: ArrangeRow[];
		visibleSections: SectionNode[];
		admin: AdminState;
		isOffline: boolean;
		isOwnDbEntitySection: (id: string) => boolean;
	} = $props();

	const ownOrgFlatSections = $derived(flattenSections(visibleSections));

	function pageCreateParentLabel(node: SectionNode): string {
		return '  '.repeat(node.depth) + node.name;
	}

	const activeArrangeRowId = $derived(
		rovingStop(arrange.rovingHandleId, drag.arrangeReorderableIds())
	);

	const heldSectionId = $derived(
		arrange.grabbedSectionId ?? arrange.draggedSectionId ?? arrange.touchDragId ?? null
	);

	const heldSubtreeIds = $derived.by(() => {
		const ids = new Set<string>();
		if (heldSectionId === null) return ids;
		const node = findSectionNode(roster.sections, heldSectionId);
		if (!node) return ids;
		for (const child of flattenSections(node.children)) ids.add(child.id);
		return ids;
	});

	const ARRANGE_DROP_HINT_END = '__end__';

	const arrangeDropHintBeforeId = $derived.by((): string | null => {
		if (roster.viewMode !== 'arrange') return null;
		const fromId = arrange.draggedSectionId ?? arrange.touchDragId;
		const overId = arrange.draggedSectionId !== null ? arrange.dragOverId : arrange.touchOverId;
		if (fromId === null || overId === null || overId === fromId) return null;
		const siblingIds = ops.visibleSiblingsOf(overId)?.map((n) => n.id) ?? [];
		const fromIdx = siblingIds.indexOf(fromId);
		const toIdx = siblingIds.indexOf(overId);
		if (fromIdx < 0 || toIdx < 0) return null;
		if (fromIdx > toIdx) return overId;
		const targetIdx = arrangeRows.findIndex((r) => r.id === overId);
		if (targetIdx < 0) return null;
		const targetDepth = arrangeRows[targetIdx].depth;
		let i = targetIdx + 1;
		while (i < arrangeRows.length && arrangeRows[i].depth > targetDepth) i += 1;
		return arrangeRows[i]?.id ?? ARRANGE_DROP_HINT_END;
	});
</script>

{#snippet dropIndicator()}
	<div
		data-testid="section-drop-indicator"
		aria-hidden="true"
		class="mx-2 h-0.5 border-t-2 border-dashed border-ink-3"
	></div>
{/snippet}

<div data-testid="roster-arrange-list" class="flex flex-col">
	{#each arrangeRows as row (row.id)}
		{@const node = findSectionNode(roster.sections, row.id)}
		{#if node}
			{#if arrangeDropHintBeforeId === row.id}
				{@render dropIndicator()}
			{/if}
			<SectionArrangeRow
				{row}
				{node}
				{arrange}
				{ops}
				{drag}
				{isOffline}
				{heldSectionId}
				{heldSubtreeIds}
				{activeArrangeRowId}
				{isOwnDbEntitySection}
			/>
		{/if}
	{/each}
	{#if arrangeDropHintBeforeId === ARRANGE_DROP_HINT_END}
		{@render dropIndicator()}
	{/if}
</div>
{#if admin === 'admin'}
	<div class="flex flex-col gap-1.5 border-t border-dashed border-ink-5 pt-3">
		{#if !arrange.pageCreateOpen}
			<button
				type="button"
				data-testid="roster-new-section"
				class="self-start rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50"
				disabled={isOffline}
				onclick={ops.openPageCreateForm}
			>
				{m.roster_new_section()}
			</button>
		{:else}
			<div
				data-testid="roster-new-section-form"
				role="dialog"
				aria-label={m.roster_new_section_form_label()}
				tabindex="-1"
				class="flex flex-col gap-1.5"
				onkeydown={ops.onPageCreateFormKeydown}
			>
				<input
					type="text"
					data-testid="roster-new-section-name"
					use:focusOnMount
					aria-label={m.roster_section_name_label()}
					placeholder={m.roster_section_name_label()}
					aria-invalid={arrange.pageCreateError ? true : undefined}
					aria-describedby={arrange.pageCreateError ? 'roster-new-section-error' : undefined}
					value={arrange.pageCreateName}
					oninput={(e) => (arrange.pageCreateName = (e.currentTarget as HTMLInputElement).value)}
					class="border border-ink-5 bg-paper px-1.5 py-1 text-ink"
				/>
				<select
					data-testid="roster-new-section-parent"
					aria-label={m.roster_section_parent_label()}
					value={arrange.pageCreateParentId}
					onchange={(e) =>
						(arrange.pageCreateParentId = (e.currentTarget as HTMLSelectElement).value)}
					class="border border-ink-5 bg-paper px-1.5 py-1 text-ink"
				>
					<option value="">{m.roster_new_section_top_level()}</option>
					{#each ownOrgFlatSections as node (node.id)}
						<option value={node.id}>{pageCreateParentLabel(node)}</option>
					{/each}
				</select>
				{#if arrange.pageCreateError}
					<p
						id="roster-new-section-error"
						role="alert"
						data-testid="roster-new-section-error"
						class="text-xs text-red-700"
					>
						{arrange.pageCreateError()}
					</p>
				{/if}
				<div class="flex gap-2">
					<button
						type="button"
						data-testid="roster-new-section-submit"
						class="border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
						disabled={isOffline}
						onclick={() => void ops.submitPageCreate()}
					>
						{m.roster_create_assign()}
					</button>
					<button
						type="button"
						data-testid="roster-new-section-cancel"
						class="px-2 py-1 text-xs text-ink-2 hover:text-ink"
						onclick={ops.closePageCreateForm}
					>
						{m.roster_cancel()}
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
