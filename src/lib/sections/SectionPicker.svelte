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
		/**
		 * TS.3/#97 — fired ONCE on a VALID "Create + assign" submit of the inline
		 * new-section form: `{ name }` trimmed, `parentId` a section id or null for
		 * "(top level)". The CALLER does the two writes (createSection, then
		 * assignMemberSection with the returned id) — this component stays
		 * presentational. Contract pinned by SectionPicker.create.spec.ts.
		 * OPTIONAL in type only so TS.2-era call sites stay type-clean — the
		 * /roster page MUST pass it (pinned by page.roster-create-section.spec.ts).
		 */
		oncreate?: (input: { name: string; parentId: string | null }) => void;
	}

	const { memberId, sections, selectedIds, onpick, oncreate }: Props = $props();

	let open = $state(false);
	/** The component root — the "inside" an outside-click is measured against. */
	let root: HTMLElement | null = null;

	// TS.3/#97 — the inline "+ New section…" form. `creating` TRANSFORMS the open
	// menu (section options + Unassigned are replaced by the form, not stacked
	// alongside it); `createName`/`createParentId` are the form's own local
	// state, reset fresh every time the form is (re)opened so Cancel → reopen
	// never leaks a previously typed name. `createError` holds the localized
	// message key currently shown (null = no error region at all, per spec).
	let creating = $state(false);
	let createName = $state('');
	let createParentId = $state('');
	let createError = $state<(() => string) | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);

	// Per-member so a roster full of pickers never mints duplicate DOM ids — the
	// name input's aria-describedby points at exactly ITS OWN error paragraph.
	const errorId = $derived(`section-create-error-${memberId}`);

	function openCreateForm(): void {
		createName = '';
		createParentId = '';
		createError = null;
		creating = true;
	}

	function closeCreateForm(): void {
		creating = false;
		createName = '';
		createParentId = '';
		createError = null;
	}

	function submitCreateForm(): void {
		const name = createName.trim();
		if (!name) {
			createError = m.roster_section_name_required;
			return;
		}
		const isDuplicate = flatSections.some((node) => node.name.toLowerCase() === name.toLowerCase());
		if (isDuplicate) {
			createError = m.roster_section_duplicate;
			return;
		}
		const parentId = createParentId === '' ? null : createParentId;
		oncreate?.({ name, parentId });
		// Close-after-action — the WHOLE picker closes, same semantics as onpick.
		creating = false;
		createName = '';
		createParentId = '';
		createError = null;
		open = false;
	}

	// F5 code-review fix: the name input is auto-focused, so "type the name, press
	// Enter" is the natural interaction — it previously did nothing (this is a
	// <div> of buttons, not a <form>, so there is no implicit submit) and the user
	// had to reach for the mouse. Kept as a plain keydown on the input rather than
	// wrapping the picker in a <form>: this component renders inside the roster
	// row's own markup, and a nested <form> is invalid HTML wherever a caller
	// already has one. Escape is NOT handled here — the window handler below
	// already routes it to closeMenu.
	function onNameKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		submitCreateForm();
	}

	/**
	 * F5 code-review fix: the parent <select> rendered every section flush-left, so
	 * "Soprano 1" looked like a sibling of the root "Soprano" and the tree shape was
	 * lost — while the option BUTTONS above already convey depth via padding-left.
	 * `<option>` can't be styled portably, so indent the label text itself; NBSP,
	 * because leading ordinary spaces collapse in rendered option labels.
	 */
	function parentOptionLabel(node: SectionNode): string {
		return '\u00a0\u00a0'.repeat(node.depth) + node.name;
	}

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
		closeMenu();
	}

	/** Fully closes the picker — menu AND the inline create form, if either is open. */
	function closeMenu(): void {
		open = false;
		closeCreateForm();
	}

	// F2 code-review fix — non-destructive dismissal. Both handlers are registered
	// unconditionally (`<svelte:window>` can't live inside an `{#if}`) and bail
	// immediately while closed, so a roster full of pickers costs one no-op
	// comparison per event.
	function onWindowKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') closeMenu();
	}

	// Click, not pointerdown/mousedown: the trigger's own `onclick` toggles on the
	// SAME event, and by the time it bubbles to the window `root.contains(target)`
	// keeps the just-opened menu open. A click on ANOTHER member's trigger is
	// outside this root, so it closes this menu while opening that one.
	function onWindowClick(event: MouseEvent): void {
		if (!open) return;
		const target = event.target;
		if (root && target instanceof Node && root.contains(target)) return;
		closeMenu();
	}

	function toggleTrigger(): void {
		if (open) closeMenu();
		else open = true;
	}

	// Auto-focus the name input the instant the inline form appears (TS.3/#97
	// contract). Runs after every DOM update; the `creating` read is what gates
	// it, so it's a no-op on renders that don't just-opened the form.
	$effect(() => {
		if (creating && nameInput) nameInput.focus();
	});
</script>

<svelte:window onkeydown={onWindowKeydown} onclick={onWindowClick} />

<div bind:this={root} class="relative inline-block">
	<button
		type="button"
		data-testid="section-picker-trigger-{memberId}"
		aria-expanded={open}
		class="text-xs text-ink-2 underline decoration-dotted hover:text-ink"
		onclick={toggleTrigger}
	>
		{triggerLabel}
	</button>
	{#if open}
		<div
			data-testid="section-picker-menu-{memberId}"
			class="absolute z-10 mt-1 flex min-w-40 flex-col border border-ink bg-paper py-1 shadow-sm"
		>
			{#if !creating}
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
				<button
					type="button"
					data-testid="section-picker-new"
					class="border-t border-dashed border-ink-5 px-2 py-1 text-left text-xs text-ink-2 hover:bg-ink-5"
					onclick={openCreateForm}
				>
					{m.roster_new_section()}
				</button>
			{:else}
				<div data-testid="section-create-form" class="flex flex-col gap-1.5 px-2 py-1.5">
					<!-- F5 code-review fix: BOTH controls were nameless — a screen reader
					     announced a bare "edit text" / "combo box". i18n `aria-label`s,
					     matching the inline-control convention on the library page
					     (bulk-checkout + inline-checkout selects). The name field also
					     carries the same string as a visible placeholder, so sighted users
					     get the "Name:" hint the #97 widget sketch asked for without
					     spending a row of the narrow dropdown on a <label>. -->
					<input
						type="text"
						data-testid="section-create-name"
						bind:this={nameInput}
						aria-label={m.roster_section_name_label()}
						placeholder={m.roster_section_name_label()}
						aria-invalid={createError ? true : undefined}
						aria-describedby={createError ? errorId : undefined}
						value={createName}
						oninput={(e) => (createName = (e.currentTarget as HTMLInputElement).value)}
						onkeydown={onNameKeydown}
						class="border border-ink-5 bg-paper px-1.5 py-1 text-xs text-ink"
					/>
					<!-- One-way `value=` + explicit `onchange` (not `bind:value`) — same fix
					     as admin/invite/+page.svelte's `invite-db` select: `bind:value`'s
					     controlled-select sync effect raced this form's own state updates in
					     testing, landing on the wrong option. -->
					<select
						data-testid="section-create-parent"
						aria-label={m.roster_section_parent_label()}
						value={createParentId}
						onchange={(e) => (createParentId = (e.currentTarget as HTMLSelectElement).value)}
						class="border border-ink-5 bg-paper px-1.5 py-1 text-xs text-ink"
					>
						<option value="">{m.roster_new_section_top_level()}</option>
						{#each flatSections as node (node.id)}
							<option value={node.id}>{parentOptionLabel(node)}</option>
						{/each}
					</select>
					{#if createError}
						<!-- F5 code-review fix: `role="alert"` — the error appears only in
						     response to a submit, so without a live region a screen-reader
						     user gets silence and a form that just refuses to close. Paired
						     with the input's aria-invalid + aria-describedby above. -->
						<p id={errorId} role="alert" data-testid="section-create-error" class="text-xs text-red-700">
							{createError()}
						</p>
					{/if}
					<div class="flex gap-2">
						<button
							type="button"
							data-testid="section-create-submit"
							class="border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
							onclick={submitCreateForm}
						>
							{m.roster_create_assign()}
						</button>
						<button
							type="button"
							data-testid="section-create-cancel"
							class="px-2 py-1 text-xs text-ink-2 hover:text-ink"
							onclick={closeCreateForm}
						>
							{m.roster_cancel()}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- (*MVOX:Tallis* — RED stub + props contract, TS.2/#96) -->
<!-- (*MVOX:Palestrina* — GREEN implementation, TS.2/#96) -->
<!-- (*MVOX:Tallis* — RED oncreate prop contract, TS.3/#97) -->
<!-- (*MVOX:Palestrina* — GREEN inline create form, TS.3/#97) -->
