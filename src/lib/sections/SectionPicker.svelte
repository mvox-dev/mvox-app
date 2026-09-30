<!-- Native single-choice section pickers for one member, one per held section, plus a [+]. -->
<script lang="ts">
	// aria-label, not id + label[for]: a two-section member mounts this twice with one memberId.
	import { m } from '$lib/paraglide/messages.js';
	import type { SectionNode } from './sectionData';
	import { flattenSections } from './sectionTree';

	interface Props {
		memberId: string;
		memberName: string;
		sections: SectionNode[];
		selectedIds: string[];
		// Kept apart from selectedIds: what this card draws vs what she holds. One list for both
		// offered her other held section as free, and choosing it posted a duplicate `_parent`.
		renderIds: string[];
		busy: boolean;
		onassign: (sectionId: string) => void;
		onunassign: (sectionId: string) => void;
		onmove: (fromId: string, toId: string) => void;
	}

	const {
		memberId,
		memberName,
		sections,
		selectedIds,
		renderIds,
		busy,
		onassign,
		onunassign,
		onmove
	}: Props = $props();

	let blankOpen = $state(false);

	const flatSections = $derived(flattenSections(sections));

	// `<option>` can't be styled portably, so depth is an NBSP indent in the label text.
	function optionLabel(node: SectionNode): string {
		return '  '.repeat(node.depth) + node.name;
	}

	// A held select keeps its own section; exclusion reads the whole membership, not the card.
	function heldOptions(thisId: string): SectionNode[] {
		return flatSections.filter((node) => node.id === thisId || !selectedIds.includes(node.id));
	}

	const blankOptions = $derived(flatSections.filter((node) => !selectedIds.includes(node.id)));

	// Also closes the blank picker when the membership grows from elsewhere, e.g. another card.
	let prevSelectedCount = -1;
	$effect(() => {
		const count = selectedIds.length;
		if (prevSelectedCount !== -1 && blankOpen && count > prevSelectedCount) blankOpen = false;
		prevSelectedCount = count;
	});

	function chooseHeld(sectionId: string, newValue: string): void {
		if (newValue === '') onunassign(sectionId);
		else onmove(sectionId, newValue);
	}

	function chooseBlank(newValue: string): void {
		if (newValue === '') return; // left at Määramata — writes nothing
		onassign(newValue);
		blankOpen = false;
	}

	function openBlank(): void {
		blankOpen = true;
	}

	const addLabel = $derived(m.roster_section_add_label({ name: memberName }));
	const pickerLabel = $derived(m.roster_section_picker_label({ name: memberName }));
</script>

<div class="flex flex-col items-end gap-1" aria-busy={busy}>
	{#each renderIds as sectionId (sectionId)}
		{@const node = flatSections.find((n) => n.id === sectionId)}
		<select
			data-testid="section-picker-select-{memberId}-{sectionId}"
			aria-label={node ? `${pickerLabel}: ${node.name}` : pickerLabel}
			value={sectionId}
			disabled={busy}
			onchange={(e) => {
				// `value` is one-way and keyed, so after a failed write the select would keep showing
				// a section she is not in; re-assert it from state before delegating.
				const el = e.currentTarget as HTMLSelectElement;
				const chosen = el.value;
				el.value = sectionId;
				chooseHeld(sectionId, chosen);
			}}
			class="border border-ink-5 bg-paper px-1.5 py-0.5 text-ink"
		>
			<option value="">{m.roster_unassigned()}</option>
			{#each heldOptions(sectionId) as opt (opt.id)}
				<option value={opt.id}>{optionLabel(opt)}</option>
			{/each}
		</select>
	{/each}
	{#if blankOpen}
		<select
			data-testid="section-picker-select-{memberId}-blank"
			aria-label={pickerLabel}
			value=""
			disabled={busy}
			onchange={(e) => {
				// Same re-assert: a blank picker left open shows Määramata, not the failed choice.
				const el = e.currentTarget as HTMLSelectElement;
				const chosen = el.value;
				el.value = '';
				chooseBlank(chosen);
			}}
			class="border border-ink-5 bg-paper px-1.5 py-0.5 text-ink"
		>
			<option value="">{m.roster_unassigned()}</option>
			{#each blankOptions as opt (opt.id)}
				<option value={opt.id}>{optionLabel(opt)}</option>
			{/each}
		</select>
	{:else}
		<button
			type="button"
			data-testid="section-picker-add-{memberId}"
			aria-label={addLabel}
			title={addLabel}
			disabled={busy}
			class="flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:bg-ink-5 hover:text-ink disabled:cursor-default disabled:opacity-60"
			onclick={openBlank}
		>
			<svg aria-hidden="true" viewBox="0 0 16 16" class="h-3.5 w-3.5 fill-current">
				<path d="M7 2h2v5h5v2H9v5H7V9H2V7h5z" />
			</svg>
		</button>
	{/if}
</div>

<!-- (*MVOX:Palestrina*) -->
