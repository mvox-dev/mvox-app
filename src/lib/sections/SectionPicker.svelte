<script lang="ts">
	// TS.2/#96 GREEN — PRESENTATIONAL component, no fetch, no cfg: the write
	// dispatch + optimistic state live in the roster page's wiring (same split as
	// the attendance panel: component fires callbacks, page calls the data
	// layer).
	//
	// CONTRACT (pinned by SectionPicker.spec.ts):
	//
	//   - Trigger button `section-picker-trigger-<memberId>`, `aria-expanded` +
	//     `aria-haspopup="listbox"`; label shows the current section NAMES
	//     (', '-joined; a member can be in several) or `m.roster_unassigned()`
	//     when selectedIds is empty.
	//   - Open menu `section-picker-menu-<memberId>` — the roleless POPUP wrapper —
	//     holds `section-picker-listbox-<memberId>` (`role="listbox"`, named after
	//     the member) and, as its SIBLING, the "+ New section…" button. One
	//     `role="option"` button per section, `section-picker-option-<sectionId>`,
	//     flattened PRE-ORDER over the tree with `data-depth`, plus
	//     `section-picker-option-unassigned` LAST. Current sections carry
	//     `aria-selected="true"` (toggle semantics — multiple may be selected at
	//     once; #99/TS.5 — supersedes the earlier `aria-pressed` pin, which is an
	//     invalid ARIA mix on `role="option"`). ArrowDown/ArrowUp walk the
	//     options + the "+ New section…" entry (the listbox pattern); Tab alone
	//     is not sufficient keyboard support for a listbox.
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
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { SectionNode } from './sectionData';

	interface Props {
		memberId: string;
		/**
		 * #99 review F1 — the member's display name, used ONLY to name the listbox
		 * ("Sections for Ada Lovelace"). `role="listbox"` is "Name From: author" with
		 * an accessible name REQUIRED, and a roster renders one picker per row: an
		 * unnamed one announces a bare "list box, multi-selectable, 6 items" with
		 * nothing saying whose sections it edits. Optional in type only so TS.2-era
		 * call sites stay type-clean — without it the listbox falls back to
		 * `aria-labelledby` on the trigger, which at least names the current sections.
		 */
		memberName?: string;
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

	const { memberId, memberName, sections, selectedIds, onpick, oncreate }: Props = $props();

	let open = $state(false);
	/** The component root — the "inside" an outside-click is measured against. */
	let root: HTMLElement | null = null;
	/** The trigger button — focus goes back here when the menu is dismissed. */
	let triggerEl: HTMLButtonElement | null = null;

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
	/** The open menu — the "widget" arrow-key navigation (below) is scoped to. */
	let menuEl = $state<HTMLElement | null>(null);

	// Per-member so a roster full of pickers never mints duplicate DOM ids — the
	// name input's aria-describedby points at exactly ITS OWN error paragraph.
	const errorId = $derived(`section-create-error-${memberId}`);
	// #99 review F1 — the same per-member discipline for the three ids the
	// trigger's `aria-controls` has to resolve against: the trigger itself (the
	// listbox's fallback name), the listbox, and the create form.
	const triggerId = $derived(`section-picker-trigger-${memberId}`);
	const listboxId = $derived(`section-picker-listbox-${memberId}`);
	const formId = $derived(`section-create-form-${memberId}`);

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
		// Close-after-action — the WHOLE picker closes, same semantics as onpick
		// (via closeMenu, so the submit button's focus lands back on the trigger
		// rather than on <body> — see closeMenu).
		closeMenu();
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

	/** Tears the picker down — menu AND the inline create form — without touching focus. */
	function dismiss(): void {
		open = false;
		closeCreateForm();
	}

	/**
	 * Fully closes the picker AND returns focus to the trigger.
	 *
	 * #99 review F1 — every dismissal used to DROP focus to <body>: Escape and a
	 * pick both unmount the menu while an option still holds focus, and an
	 * unmounted activeElement is not focus, it is nothing. A keyboard user who
	 * opened a picker halfway down the roster lost their place, and the next Tab
	 * restarted at the top of the document (WCAG 2.4.3 Focus Order).
	 *
	 * The `hadFocus` guard keeps the restore honest: only pull focus back if it
	 * was actually inside THIS picker. (The outside-click path deliberately does
	 * not come through here at all — see `onWindowClick`.)
	 */
	function closeMenu(): void {
		const hadFocus = root?.contains(document.activeElement) ?? false;
		dismiss();
		if (hadFocus) triggerEl?.focus();
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
		// `dismiss`, NOT `closeMenu`: the click that dismissed this menu has already
		// put focus where the user pointed it (typically another member's trigger).
		// Yanking focus back to THIS trigger would fight the user's own click.
		dismiss();
	}

	function toggleTrigger(): void {
		if (open) closeMenu();
		else open = true;
	}

	/** The keyboard-navigable entries of the open list, in DOM order. */
	function menuItems(): HTMLElement[] {
		if (!menuEl) return [];
		return Array.from(
			menuEl.querySelectorAll<HTMLElement>(
				'[data-testid^="section-picker-option-"], [data-testid="section-picker-new"]'
			)
		);
	}

	// #99/TS.5 — the listbox pattern requires ArrowDown/ArrowUp navigation, not
	// just Tab: focus moves through the section options, the Unassigned option,
	// and the "+ New section…" entry, in DOM order. Clamped at both ends — an
	// ArrowDown on the last entry stays put rather than escaping the widget.
	//
	// #99 review F2 — this is bound to the TRIGGER as well as to every list entry.
	// The menu is a SIBLING of the trigger, not a descendant, and focus stays on
	// the trigger when the menu opens, so a menu-only handler never saw a single
	// keystroke: the whole arrow-key path was unreachable from the keyboard, and
	// bailed at `idx === -1` even if it had been reached. From the trigger,
	// ArrowDown enters the list at the first entry and ArrowUp at the last — and
	// on a CLOSED trigger both open the list first (canonical listbox).
	async function onMenuKeydown(event: KeyboardEvent): Promise<void> {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const down = event.key === 'ArrowDown';
		const active = document.activeElement;

		if (active === triggerEl) {
			// While the inline create form is showing there is no list to enter.
			if (open && creating) return;
			event.preventDefault();
			if (!open) {
				open = true;
				await tick(); // let the menu mount before reaching into it
			}
			const items = menuItems();
			(down ? items[0] : items[items.length - 1])?.focus();
			return;
		}

		// Inside the open list: walk it. Keystrokes from the create form's own
		// controls (input, select) land here too — they are not list entries, so
		// `idx === -1` leaves their native arrow behaviour alone.
		if (!open || creating) return;
		const items = menuItems();
		const idx = active instanceof HTMLElement ? items.indexOf(active) : -1;
		if (idx === -1) return;
		event.preventDefault();
		const nextIdx = down ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
		items[nextIdx]?.focus();
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
		bind:this={triggerEl}
		id={triggerId}
		data-testid="section-picker-trigger-{memberId}"
		aria-expanded={open}
		aria-haspopup={creating ? 'dialog' : 'listbox'}
		aria-controls={open ? (creating ? formId : listboxId) : undefined}
		class="text-xs text-ink-2 underline decoration-dotted hover:text-ink"
		onclick={toggleTrigger}
		onkeydown={onMenuKeydown}
	>
		{triggerLabel}
	</button>
	{#if open}
		<!-- The POPUP WRAPPER — deliberately roleless, and deliberately WITHOUT a
		     keydown handler of its own (a static <div> that listens for keys is
		     exactly what `a11y_no_static_element_interactions` flags). It is the
		     query root for arrow-key navigation (`menuEl`, which must reach BOTH the
		     options and the "+ New section…" entry beside them) and the
		     outside-click boundary; the ARIA listbox is the inner element below, and
		     `onMenuKeydown` rides on the focusable ENTRIES themselves. -->
		<div
			bind:this={menuEl}
			data-testid="section-picker-menu-{memberId}"
			class="absolute z-10 mt-1 flex min-w-40 flex-col border border-ink bg-paper py-1 shadow-sm"
		>
			{#if !creating}
				<!-- #99 review F1/F4 — the listbox is its OWN element, wrapping ONLY the
				     options. Two things fall out of that:
				       - it can carry the accessible name `role="listbox"` requires
				         (Name From: author, name REQUIRED) — a roster renders one picker
				         per row, so "which member?" has to be in the announcement;
				       - "+ New section…" is no longer inside it, so it no longer has to
				         masquerade as a permanently-unselected `role="option"` (announced
				         "not selected, 6 of 6" inside a multi-selectable list) to keep the
				         listbox's children valid. It is a button that opens a form, and it
				         now says so. -->
				<div
					id={listboxId}
					data-testid="section-picker-listbox-{memberId}"
					role="listbox"
					aria-multiselectable="true"
					aria-label={memberName ? m.roster_section_picker_label({ name: memberName }) : undefined}
					aria-labelledby={memberName ? undefined : triggerId}
					class="flex flex-col"
				>
					{#each flatSections as node (node.id)}
						<button
							type="button"
							data-testid="section-picker-option-{node.id}"
							data-depth={node.depth}
							role="option"
							aria-selected={selectedIds.includes(node.id)}
							class="px-2 py-1 text-left text-xs text-ink hover:bg-ink-5"
							style="padding-left: {0.5 + node.depth}rem"
							onclick={() => pick(node.id)}
							onkeydown={onMenuKeydown}
						>
							{node.name}
						</button>
					{/each}
					<button
						type="button"
						data-testid="section-picker-option-unassigned"
						role="option"
						aria-selected={selectedIds.length === 0}
						class="border-t border-dashed border-ink-5 px-2 py-1 text-left text-xs text-ink-2 hover:bg-ink-5"
						onclick={() => pick(null)}
						onkeydown={onMenuKeydown}
					>
						{m.roster_unassigned()}
					</button>
				</div>
				<button
					type="button"
					data-testid="section-picker-new"
					class="border-t border-dashed border-ink-5 px-2 py-1 text-left text-xs text-ink-2 hover:bg-ink-5"
					onclick={openCreateForm}
					onkeydown={onMenuKeydown}
				>
					{m.roster_new_section()}
				</button>
			{:else}
				<!-- #99 review F1 — role="dialog" (non-modal) so the trigger's
				     `aria-haspopup="dialog"` + `aria-controls={formId}` describe what is
				     actually on screen. While `creating` the listbox is GONE, so a
				     trigger still advertising a listbox popup named a widget that no
				     longer existed. -->
				<div
					id={formId}
					data-testid="section-create-form"
					role="dialog"
					aria-label={m.roster_new_section_form_label()}
					class="flex flex-col gap-1.5 px-2 py-1.5"
				>
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
<!-- (*MVOX:Palestrina* — GREEN a11y pass: listbox semantics, arrow-key nav, TS.5/#99) -->
<!-- (*MVOX:Palestrina* — #99 review fixes: focus restore on dismiss, arrow-nav from
     the trigger, valid listbox children) -->
<!-- (*MVOX:Palestrina* — #99 review fixes round 2: named listbox + aria-controls,
     honest aria-haspopup, "+ New section…" is a button again) -->
