<script lang="ts">
	// TS.2/#96 GREEN — PRESENTATIONAL component, no fetch, no cfg: the write
	// dispatch + optimistic state live in the roster page's wiring (same split as
	// the attendance panel: component fires callbacks, page calls the data
	// layer).
	//
	// CONTRACT (pinned by SectionPicker.spec.ts):
	//
	//   - Trigger button `section-picker-trigger-<memberId>`, `aria-expanded`;
	//     label shows the current section NAMES (', '-joined; a member can be in
	//     several) or `m.roster_unassigned()` when selectedIds is empty.
	//   - Open menu `section-picker-menu-<memberId>`: one option button per
	//     section, `section-picker-option-<sectionId>`, flattened PRE-ORDER over
	//     the tree with `data-depth`, plus `section-picker-option-unassigned`
	//     LAST. Current sections carry `aria-pressed="true"` (toggle semantics —
	//     multiple may be pressed at once).
	//   - DISMISSABLE without writing (F2 code-review fix): Escape, or a click
	//     anywhere outside this component, closes the menu. Previously the only
	//     ways out were picking an option (an immediate live write — a mistaken
	//     tap is not undoable from the menu) or re-tapping the SAME trigger, so
	//     opening member B's picker left member A's absolutely-positioned menu
	//     stacked over neighbouring roster rows.
	//   - Tapping ANY section option fires `onpick(sectionId)` — the CALLER maps
	//     it to assign (id not in selectedIds) or unassign (id already in
	//     selectedIds). Tapping Unassigned fires `onpick(null)`. The menu closes
	//     after every pick (per-tap immediate write, no multi-select-then-save).
	import { m } from '$lib/paraglide/messages.js';
	import type { SectionNode } from './sectionData';

	interface Props {
		memberId: string;
		/** The section tree, as returned by listSections. */
		sections: SectionNode[];
		/** The member's CURRENT section entity ids ([] = unassigned). */
		selectedIds: string[];
		/** Fired per tap: a section id, or null for "(Unassigned)". */
		onpick: (sectionId: string | null) => void;
	}

	const { memberId, sections, selectedIds, onpick }: Props = $props();

	let open = $state(false);
	/** The component root — the "inside" an outside-click is measured against. */
	let root: HTMLElement | null = null;

	/** Flatten the tree PRE-ORDER — each node's own depth rides along already. */
	function flatten(nodes: SectionNode[]): SectionNode[] {
		const out: SectionNode[] = [];
		for (const node of nodes) {
			out.push(node);
			out.push(...flatten(node.children));
		}
		return out;
	}

	const flatSections = $derived(flatten(sections));

	const nameById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const node of flatSections) map.set(node.id, node.name);
		return map;
	});

	// F2 code-review fix: an id the tree can't name used to be DROPPED, so a member
	// whose sections all failed to resolve (e.g. the tree load failed and `sections`
	// is []) got '' — a zero-width, unlabeled, still-clickable button. Fall back to
	// the raw id instead: never silently drops a membership from the label, and the
	// control is never invisible. Resolvable ids render exactly as before.
	const triggerLabel = $derived.by(() => {
		if (selectedIds.length === 0) return m.roster_unassigned();
		return selectedIds.map((id) => nameById.get(id) ?? id).join(', ');
	});

	function pick(sectionId: string | null): void {
		onpick(sectionId);
		open = false;
	}

	// F2 code-review fix — non-destructive dismissal. Both handlers are registered
	// unconditionally (`<svelte:window>` can't live inside an `{#if}`) and bail
	// immediately while closed, so a roster full of pickers costs one no-op
	// comparison per event.
	function onWindowKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') open = false;
	}

	// Click, not pointerdown/mousedown: the trigger's own `onclick` toggles on the
	// SAME event, and by the time it bubbles to the window `root.contains(target)`
	// keeps the just-opened menu open. A click on ANOTHER member's trigger is
	// outside this root, so it closes this menu while opening that one.
	function onWindowClick(event: MouseEvent): void {
		if (!open) return;
		const target = event.target;
		if (root && target instanceof Node && root.contains(target)) return;
		open = false;
	}
</script>

<svelte:window onkeydown={onWindowKeydown} onclick={onWindowClick} />

<div bind:this={root} class="relative inline-block">
	<button
		type="button"
		data-testid="section-picker-trigger-{memberId}"
		aria-expanded={open}
		class="text-xs text-ink-2 underline decoration-dotted hover:text-ink"
		onclick={() => (open = !open)}
	>
		{triggerLabel}
	</button>
	{#if open}
		<div
			data-testid="section-picker-menu-{memberId}"
			class="absolute z-10 mt-1 flex min-w-40 flex-col border border-ink bg-paper py-1 shadow-sm"
		>
			{#each flatSections as node (node.id)}
				<button
					type="button"
					data-testid="section-picker-option-{node.id}"
					data-depth={node.depth}
					aria-pressed={selectedIds.includes(node.id)}
					class="px-2 py-1 text-left text-xs text-ink hover:bg-ink-5"
					style="padding-left: {0.5 + node.depth}rem"
					onclick={() => pick(node.id)}
				>
					{node.name}
				</button>
			{/each}
			<button
				type="button"
				data-testid="section-picker-option-unassigned"
				aria-pressed={selectedIds.length === 0}
				class="border-t border-dashed border-ink-5 px-2 py-1 text-left text-xs text-ink-2 hover:bg-ink-5"
				onclick={() => pick(null)}
			>
				{m.roster_unassigned()}
			</button>
		</div>
	{/if}
</div>

<!-- (*MVOX:Tallis* — RED stub + props contract, TS.2/#96) -->
<!-- (*MVOX:Palestrina* — GREEN implementation, TS.2/#96) -->
