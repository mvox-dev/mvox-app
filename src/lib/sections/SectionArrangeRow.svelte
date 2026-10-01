<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import type { SectionNode } from '$lib/sections/sectionData';
	import type { ArrangeRow } from '$lib/sections/sectionTree';
	import {
		isStructuralWritePending,
		type ArrangeOps,
		type ArrangeState
	} from '$lib/sections/sectionArrangeOps';
	import type { ArrangeDrag } from '$lib/sections/sectionDrag';

	let {
		row,
		node,
		arrange,
		ops,
		drag,
		isOffline,
		heldSectionId,
		heldSubtreeIds,
		activeArrangeRowId,
		isOwnDbEntitySection
	}: {
		row: ArrangeRow;
		node: SectionNode;
		arrange: ArrangeState;
		ops: ArrangeOps;
		drag: ArrangeDrag;
		isOffline: boolean;
		heldSectionId: string | null;
		heldSubtreeIds: Set<string>;
		activeArrangeRowId: string | null;
		isOwnDbEntitySection: (id: string) => boolean;
	} = $props();

	const ARRANGE_INDENT_CLASSES = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16'] as const;
	function arrangeIndentClass(depth: number): string {
		return ARRANGE_INDENT_CLASSES[Math.min(depth, ARRANGE_INDENT_CLASSES.length - 1)];
	}

	const structuralWritePending = $derived(isStructuralWritePending(arrange));
	const siblingIds = $derived(ops.visibleSiblingsOf(row.id)?.map((n) => n.id) ?? []);
	const acceptsDrop = $derived(
		arrange.draggedSectionId !== null &&
			arrange.draggedSectionId !== row.id &&
			siblingIds.includes(arrange.draggedSectionId)
	);
	const acceptsTouchDrop = $derived(
		arrange.touchDragId !== null &&
			arrange.touchOverId === row.id &&
			arrange.touchOverId !== arrange.touchDragId &&
			siblingIds.includes(arrange.touchDragId)
	);
	const canDelete = $derived(
		row.memberCount === 0 && node.children.length === 0 && isOwnDbEntitySection(row.id)
	);
	const indentApplicable = $derived(ops.canIndent(row.id));
	const unindentApplicable = $derived(ops.canUnindent(row.id));
	const damaged = $derived(node?.parentDamaged === true);

	let renameInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (arrange.renamingSectionId !== null && renameInputEl) {
			renameInputEl.focus();
			renameInputEl.select();
		}
	});
</script>

{#if damaged}
	<p
		data-testid="section-parent-damaged-{row.id}"
		role="alert"
		class="text-sm text-red-700 {arrangeIndentClass(row.depth)}"
	>
		{m.roster_section_parent_damaged({ name: row.name })}
	</p>
{/if}
<div
	class="flex items-center focus-within:ring-2 focus-within:ring-indigo {(acceptsDrop &&
		arrange.dragOverId === row.id) ||
	acceptsTouchDrop
		? 'bg-ink-5'
		: ''} {arrange.touchDragId === row.id ? 'opacity-50' : ''} {heldSectionId === row.id
		? 'outline-2 outline-dashed outline-indigo'
		: ''} {heldSubtreeIds.has(row.id) ? 'bg-indigo-soft' : ''}"
	role="presentation"
	data-drop-row={row.id}
	ondragover={acceptsDrop ? (event: DragEvent) => drag.handleDragOver(row.id, event) : undefined}
	ondragleave={acceptsDrop
		? (event: DragEvent) => drag.handleDragLeave(row.id, event)
		: undefined}
	ondrop={acceptsDrop ? (event: DragEvent) => drag.handleDrop(row.id, event) : undefined}
>
	{#if arrange.renamingSectionId === row.id}
		<div class="flex grow items-center gap-2 py-1.5 {arrangeIndentClass(row.depth)}">
			<span aria-hidden="true" class="w-4 shrink-0"></span>
			<input
				type="text"
				data-testid="arrange-rename-input-{row.id}"
				bind:this={renameInputEl}
				aria-label={m.roster_section_name_label()}
				value={arrange.renameValue}
				oninput={(e) => (arrange.renameValue = (e.currentTarget as HTMLInputElement).value)}
				onkeydown={ops.onRenameKeydown}
				onblur={() => void ops.submitRename({ blurTrigger: true, refocus: false })}
				class="min-w-0 grow border border-ink-5 bg-paper px-1.5 py-0.5 text-ink"
			/>
		</div>
	{:else}
		<div
			data-testid="arrange-row-{row.id}"
			data-depth={row.depth}
			data-grabbed={heldSectionId === row.id ? 'true' : undefined}
			data-grabbed-subtree={heldSubtreeIds.has(row.id) ? 'true' : undefined}
			role="button"
			tabindex={activeArrangeRowId === row.id ? 0 : -1}
			aria-label={`${row.name} (${row.memberCount})`}
			aria-grabbed={arrange.draggedSectionId === row.id || arrange.grabbedSectionId === row.id
				? 'true'
				: 'false'}
			aria-dropeffect={acceptsDrop ? 'move' : undefined}
			aria-describedby="section-reorder-instructions"
			draggable={structuralWritePending || damaged ? 'false' : 'true'}
			style="touch-action: pan-y"
			class="flex shrink-0 items-center gap-2 py-1.5 pr-2 {arrangeIndentClass(
				row.depth
			)} focus:outline-none select-none {structuralWritePending || damaged
				? 'cursor-default'
				: 'cursor-grab'}"
			ondragstart={(event: DragEvent) => drag.handleDragStart(row.id, event)}
			ondragend={drag.handleDragEnd}
			onpointermove={drag.handlePointerMove}
			onpointerup={drag.handlePointerUp}
			onpointercancel={drag.endTouchDrag}
			onlostpointercapture={drag.endTouchDrag}
			onkeydown={(event: KeyboardEvent) => void drag.handleHandleKeydown(node, event)}
			onclick={(event: MouseEvent) => {
				if (event.detail !== 0) return;
				drag.handleElementFor(row.id)?.focus();
				void drag.toggleGrab(node);
			}}
			onfocus={() => (arrange.rovingHandleId = row.id)}
			onblur={() => drag.handleHandleBlur(node)}
		>
			<span
				data-testid="arrange-grip-{row.id}"
				aria-hidden="true"
				style="touch-action: none"
				class="flex min-h-11 w-4 shrink-0 flex-col justify-center gap-0.5 rounded-sm py-1 text-ink-2 {structuralWritePending
					? 'cursor-default'
					: 'cursor-grab hover:bg-ink-5 hover:text-ink active:bg-ink-5 active:text-ink'}"
				onpointerdown={(event: PointerEvent) => drag.handlePointerDown(row.id, event)}
			>
				<span class="h-px w-full bg-current"></span>
				<span class="h-px w-full bg-current"></span>
				<span class="h-px w-full bg-current"></span>
			</span>
		</div>
	{/if}
	<button
		type="button"
		data-testid="arrange-rename-{row.id}"
		title={m.roster_section_rename({ name: row.name })}
		disabled={arrange.reorderPending ||
			arrange.removePending ||
			arrange.renamingSectionId === row.id ||
			isOffline}
		class="group flex min-h-11 min-w-0 flex-1 appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-left text-ink-2 hover:text-ink disabled:cursor-default"
		onclick={() => ops.startRename(node)}
	>
		<span class="sr-only">{m.roster_section_rename_action()}</span>
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			class="h-3 w-3 shrink-0 fill-current group-hover:text-ink group-disabled:opacity-30"
		>
			<path
				d="M11.3 1.3a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-8 8-3.7 1 1-3.7 8-8z"
			/>
		</svg>
		{#if arrange.renamingSectionId !== row.id}
			<span class="truncate text-sm">{row.name}</span>
		{/if}
	</button>
	<span data-testid="arrange-count-{row.id}" class="shrink-0 pl-2 text-sm text-ink"
		>({row.memberCount})</span
	>
	<button
		type="button"
		data-testid="arrange-indent-{row.id}"
		aria-label={m.roster_section_indent({ name: row.name })}
		title={m.roster_section_indent({ name: row.name })}
		disabled={structuralWritePending ||
			arrange.renamingSectionId === row.id ||
			damaged ||
			!indentApplicable || isOffline}
		tabindex="-1"
		class="flex min-h-11 min-w-11 items-center justify-center rounded text-ink disabled:cursor-default disabled:opacity-60 {indentApplicable
			? ''
			: 'invisible'}"
		onclick={() => void ops.handleIndent(node)}
	>
		<svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-current">
			<path d="M4 2 L12 8 L4 14 Z" />
		</svg>
	</button>
	<button
		type="button"
		data-testid="arrange-unindent-{row.id}"
		aria-label={m.roster_section_unindent({ name: row.name })}
		title={m.roster_section_unindent({ name: row.name })}
		disabled={structuralWritePending ||
			arrange.renamingSectionId === row.id ||
			damaged ||
			!unindentApplicable || isOffline}
		tabindex="-1"
		class="flex min-h-11 min-w-11 items-center justify-center rounded text-ink disabled:cursor-default disabled:opacity-60 {unindentApplicable
			? ''
			: 'invisible'}"
		onclick={() => void ops.handleUnindent(node)}
	>
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			class="h-4 w-4 fill-none stroke-current"
			stroke-width="1.5"
			stroke-linejoin="round"
		>
			<path d="M12 2 L4 8 L12 14 Z" />
		</svg>
	</button>
	{#if arrange.pendingRemoveId === row.id}
		<DeleteConfirmPair
			confirmTestid="section-remove-confirm-{row.id}"
			cancelTestid="section-remove-cancel-{row.id}"
			confirmLabel={m.roster_section_remove_confirm({ name: row.name })}
			cancelLabel={m.roster_section_remove_cancel({ name: row.name })}
			confirmText={m.roster_section_remove_confirm_short()}
			cancelText={m.roster_section_remove_cancel_short()}
			pending={structuralWritePending}
			busy={arrange.removePending}
			{isOffline}
			class="rounded"
			onconfirm={() => void ops.handleRemoveSection(row.id)}
			oncancel={() => void ops.disarmRemove(row.id)}
		/>
	{:else}
		<DeleteTrigger
			data-testid="section-remove-{row.id}"
			aria-label={m.roster_section_remove({ name: row.name })}
			title={m.roster_section_remove({ name: row.name })}
			disabled={structuralWritePending ||
				arrange.renamingSectionId === row.id ||
				!canDelete || isOffline}
			onclick={() => void ops.armRemove(row.id)}
		/>
	{/if}
</div>
{#if arrange.renameError?.id === row.id}
	<p
		data-testid="arrange-rename-error-{row.id}"
		role="alert"
		class="text-xs text-red-700 {arrangeIndentClass(row.depth)}"
	>
		{m.roster_section_rename_failed({ name: arrange.renameError.name })}
	</p>
{/if}
