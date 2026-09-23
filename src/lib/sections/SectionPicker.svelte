<script lang="ts">
	// #470 GREEN — REWRITTEN from the TS.2/#96 popup-listbox into NATIVE
	// single-choice pickers, one per membership, plus a [+]. The custom listbox
	// (trigger/menu/role="option"/toggle-onpick) and the inline "+ New
	// section…" create form are RETIRED — creation left the assignment flow
	// entirely (the page-level `roster-new-section` entry in arrange mode is
	// the only create surface now, #124/#155, untouched). This file supersedes
	// the whole previous contract; see SectionPicker.spec.ts.
	//
	// Still PRESENTATIONAL (no fetch, no cfg): the write dispatch + optimistic
	// state + per-member freeze live in the roster page's wiring
	// (handleAssign/handleUnassign/handleMove, page.roster-picker.spec.ts).
	//
	// CONTRACT (pinned by SectionPicker.spec.ts):
	//   - Mihkel 1a/1b/1c: no held section → just the [+]; one held section →
	//     its own select (with an unassign choice) + the [+]; several → one
	//     select each + the [+].
	//   - The [+] opens ONE blank select valued '' (Määramata); Mihkel: the [+]
	//     is HIDDEN while a blank picker is open.
	//   - A held select's options: Määramata + that section + every section NOT
	//     held by this member. Choosing Määramata fires onunassign(thatId);
	//     choosing another section fires onmove(thatId, newId).
	//   - The blank select's options: Määramata + every section NOT held by
	//     this member (Gama: "a blank picker lists only sections she is not
	//     in" — nothing to gain by choosing one twice). Choosing a section
	//     fires onassign(newId) and the blank picker closes (the [+] returns).
	//     Left at Määramata, it writes nothing.
	//   - `busy` freezes EVERY control on THIS picker (disabled + aria-busy) —
	//     nothing visual beyond the native disabled state (no "saving…" text).
	import { m } from '$lib/paraglide/messages.js';
	import type { SectionNode } from './sectionData';

	interface Props {
		memberId: string;
		/** Names every control ("whose sections is this?") — the caller picks
		 *  which name is in scope; the roster page passes the PROFILE name. */
		memberName: string;
		/** The section tree, as returned by listSections. */
		sections: SectionNode[];
		/** The member's CURRENT section entity ids ([] = unassigned). */
		selectedIds: string[];
		/** Freeze: every select AND the [+] disabled, root aria-busy — Mihkel:
		 *  "the controls get freezed while entu syncs". */
		busy: boolean;
		/** A blank picker chose a section. */
		onassign: (sectionId: string) => void;
		/** A held section's picker chose Määramata. */
		onunassign: (sectionId: string) => void;
		/** A held section's picker chose ANOTHER section. */
		onmove: (fromId: string, toId: string) => void;
	}

	const { memberId, memberName, sections, selectedIds, busy, onassign, onunassign, onmove }: Props =
		$props();

	/** One blank (Määramata-valued) picker open at a time — Mihkel's [+] rule. */
	let blankOpen = $state(false);

	/** Flatten the tree PRE-ORDER — each node's own depth rides along already
	 *  (same shape as the old component's `flatten`/`parentOptionLabel`). */
	function flatten(nodes: SectionNode[]): SectionNode[] {
		const out: SectionNode[] = [];
		for (const node of nodes) {
			out.push(node);
			out.push(...flatten(node.children));
		}
		return out;
	}

	const flatSections = $derived(flatten(sections));

	/** `<option>` can't be styled portably — depth is carried in the label text
	 *  itself via NBSP indent (ordinary leading spaces collapse in rendered
	 *  option labels). */
	function optionLabel(node: SectionNode): string {
		return '  '.repeat(node.depth) + node.name;
	}

	/** A held picker's own option list: Määramata + that section + every
	 *  section NOT held by this member (the held section is kept even though
	 *  it IS held — it is THIS select's own current value). */
	function heldOptions(thisId: string): SectionNode[] {
		return flatSections.filter((node) => node.id === thisId || !selectedIds.includes(node.id));
	}

	/** The blank picker's option list: Määramata + every section NOT held —
	 *  Gama: "a blank picker lists only sections she is not in". */
	const blankOptions = $derived(flatSections.filter((node) => !selectedIds.includes(node.id)));

	// Closes the blank picker the moment its own choice fires (synchronous —
	// the [+] returns without waiting on the parent's optimistic prop update)
	// AND, redundantly, whenever `selectedIds` itself grows while a blank
	// picker is still open (a belt-and-braces close for any path that lands a
	// new membership without going through `chooseBlank` below — e.g. a
	// second control on the same row).
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
	{#each selectedIds as sectionId (sectionId)}
		{@const node = flatSections.find((n) => n.id === sectionId)}
		<label for="section-picker-select-{memberId}-{sectionId}" class="sr-only">
			{pickerLabel}{node ? `: ${node.name}` : ''}
		</label>
		<select
			id="section-picker-select-{memberId}-{sectionId}"
			data-testid="section-picker-select-{memberId}-{sectionId}"
			value={sectionId}
			disabled={busy}
			onchange={(e) => chooseHeld(sectionId, (e.currentTarget as HTMLSelectElement).value)}
			class="border border-ink-5 bg-paper px-1.5 py-0.5 text-ink"
		>
			<option value="">{m.roster_unassigned()}</option>
			{#each heldOptions(sectionId) as opt (opt.id)}
				<option value={opt.id}>{optionLabel(opt)}</option>
			{/each}
		</select>
	{/each}
	{#if blankOpen}
		<label for="section-picker-select-{memberId}-blank" class="sr-only">
			{pickerLabel}
		</label>
		<select
			id="section-picker-select-{memberId}-blank"
			data-testid="section-picker-select-{memberId}-blank"
			value=""
			disabled={busy}
			onchange={(e) => chooseBlank((e.currentTarget as HTMLSelectElement).value)}
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

<!-- (*MVOX:Palestrina* — #470 GREEN: native per-membership pickers + [+],
     replacing the TS.2/#96 popup-listbox + inline create form wholesale) -->
