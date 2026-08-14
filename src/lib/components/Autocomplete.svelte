<script module>
	// One counter per loaded module -- every mounted instance gets its own
	// listbox id, so a page holding more than one Autocomplete (T4/T3 reuse)
	// never collides on `aria-controls`/`aria-activedescendant` targets.
	let instanceCounter = 0;
</script>

<script lang="ts">
	// #132/T2 GREEN — the reusable Autocomplete (combobox). See
	// Autocomplete.spec.ts for the full pinned contract; summary:
	//
	//   - closed until the user types OR presses an arrow key; typing opens +
	//     filters `items` (case-insensitive substring on `label`), client-side only
	//   - focus STAYS in the input the whole time — the highlight moves via
	//     `aria-activedescendant`, never by moving DOM focus onto an option
	//   - ArrowDown/ArrowUp walk the FILTERED list, clamped at both ends;
	//     Home/End jump to the first/last option
	//   - Enter on a highlighted option commits it; Enter with no highlight
	//     commits typed free text only when `allowFreeText` and non-blank;
	//     otherwise Enter is a no-op
	//   - Escape / outside click dismiss without committing
	//
	// Adapted from SectionPicker.svelte's a11y patterns (outside-click's
	// `!target.isConnected` guard, `<svelte:window>` handlers that bail while
	// closed), but INPUT-anchored rather than button-anchored.

	interface Item {
		id: string;
		label: string;
	}

	interface Props {
		/** The searchable list — `id` must be unique across `items`. */
		items: Item[];
		/**
		 * Fired once per commit: a LIST PICK carries the item's `id` + `label`; a
		 * FREE-TEXT commit (allowFreeText only) carries `id: null` + the typed text.
		 */
		onSelect: (selection: { id: string | null; label: string }) => void;
		/** Input placeholder (visible hint). */
		placeholder: string;
		/** Accessible name for the input AND the listbox (i18n string, caller's). */
		label: string;
		/** Enter on non-matching text commits it as `{ id: null, label: text }`. Default false. */
		allowFreeText?: boolean;
		/**
		 * #132/T4 review F1 — the LIVE typed text, reported on every keystroke and
		 * reset to '' on a commit. Without it the query is private to this
		 * component, so an `allowFreeText` caller cannot tell "nothing typed" from
		 * "typed but never confirmed with Enter": a form holding a visibly filled
		 * type box submitted as if the field were empty. Optional — callers that
		 * only care about commits omit it.
		 */
		onQueryChange?: (query: string) => void;
		/**
		 * #132/T2 review F5 — announced inside the OPEN listbox when the filter
		 * matches nothing. Without it an open combobox with zero options is
		 * silence: `aria-expanded="true"` over an empty listbox announces nothing
		 * at all. Caller-supplied so the component stays copy-free (i18n is the
		 * caller's); omitted → no status line (the pre-review behaviour).
		 */
		emptyLabel?: string;
		/**
		 * #132/T4 review F1 — the id of the message element currently REFUSING
		 * this field. Present → the input is `aria-invalid` AND points at it; the
		 * two always travel together (T2 review F2's pairing), so the combobox is
		 * never flagged invalid with nothing to read.
		 */
		errorId?: string;
	}

	const {
		items,
		onSelect,
		placeholder,
		label,
		allowFreeText = false,
		emptyLabel,
		onQueryChange,
		errorId
	}: Props = $props();

	instanceCounter += 1;
	const listboxId = `autocomplete-listbox-${instanceCounter}`;

	let query = $state('');
	let open = $state(false);
	/** -1 = no option highlighted (the pre-ArrowDown state). */
	let activeIndex = $state(-1);
	let root: HTMLDivElement | null = null;
	let inputEl: HTMLInputElement | null = null;

	const filtered = $derived.by(() => {
		const needle = query.toLowerCase();
		return items.filter((item) => item.label.toLowerCase().includes(needle));
	});

	function optionId(item: Item | undefined): string | undefined {
		return item ? `${listboxId}-option-${item.id}` : undefined;
	}

	function closeDropdown(): void {
		open = false;
		activeIndex = -1;
	}

	/** Fires the caller's callback, then resets to the "ready for the next entry" state. */
	function commit(selection: { id: string | null; label: string }): void {
		onSelect(selection);
		closeDropdown();
		query = '';
		// Reported AFTER onSelect, so a caller tracking both never sees a stale
		// pending query alongside the value it just committed.
		onQueryChange?.('');
	}

	function pick(item: Item): void {
		commit({ id: item.id, label: item.label });
	}

	function onInput(event: Event): void {
		query = (event.currentTarget as HTMLInputElement).value;
		open = true;
		// Typing never auto-highlights (contract) — a fresh filter starts blank.
		activeIndex = -1;
		onQueryChange?.(query);
	}

	function moveHighlight(delta: number): void {
		if (!open || filtered.length === 0) return;
		activeIndex = Math.min(Math.max(activeIndex + delta, 0), filtered.length - 1);
	}

	/** Home/End: jump to the first/last option of the FILTERED list. */
	function jumpHighlight(to: 'first' | 'last'): void {
		if (!open || filtered.length === 0) return;
		activeIndex = to === 'first' ? 0 : filtered.length - 1;
	}

	function commitEnter(): void {
		const highlighted = activeIndex >= 0 ? filtered[activeIndex] : undefined;
		if (highlighted) {
			pick(highlighted);
			return;
		}
		const trimmed = query.trim();
		if (allowFreeText && trimmed) {
			commit({ id: null, label: trimmed });
		}
		// No highlight + (free text disallowed, or blank text): no-op.
	}

	function onKeydown(event: KeyboardEvent): void {
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				event.preventDefault();
				// #132/T2 review F5 — an arrow key on a CLOSED combobox opens it, so
				// the roster is browsable without first guessing a name. It opens
				// with NO highlight (the no-auto-highlight contract that keeps the
				// Enter rules unambiguous); the next arrow starts walking.
				if (!open) {
					open = true;
					activeIndex = -1;
					break;
				}
				moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
				break;
			case 'Home':
			case 'End':
				// Only claim the key while the popup is open — otherwise Home/End
				// must keep their ordinary caret-move meaning inside the input.
				if (!open) break;
				event.preventDefault();
				jumpHighlight(event.key === 'Home' ? 'first' : 'last');
				break;
			case 'Enter':
				event.preventDefault();
				commitEnter();
				break;
			case 'Escape':
				// #132/T2 review F2 — LAYERED dismissal (WAI-APG combobox): the first
				// Escape belongs to the POPUP and must not reach an enclosing form/
				// dialog, or one keystroke both closes the dropdown and discards the
				// half-filled form around it. With the popup already closed, Escape
				// is not ours — it bubbles, and the enclosing surface dismisses.
				if (!open) break;
				event.preventDefault();
				event.stopPropagation();
				// Keeps the typed text AND focus (contract) — only the dropdown goes.
				closeDropdown();
				break;
		}
	}

	// Same outside-click discipline as SectionPicker.onWindowClick: a trusted
	// click's window leg can arrive after the tapped element has already been
	// unmounted by the SAME click's own handler (e.g. an option's onclick
	// already closed the dropdown) — a detached target is not evidence of an
	// OUTSIDE click, so it is treated as inside rather than misread as a
	// dismissal.
	function onWindowClick(event: MouseEvent): void {
		if (!open) return;
		const target = event.target;
		if (root && target instanceof Node) {
			if (!target.isConnected) return;
			if (root.contains(target)) return;
		}
		closeDropdown();
	}

	// #132/T2 review F3 — focus leaving the combobox dismisses the popup. Without
	// this, Tab out of the input (options are tabindex="-1", so Tab skips them and
	// lands on the chips / Create season / Cancel) left an `aria-expanded="true"`
	// combobox whose popup nobody was in — and the popup is `absolute` over the
	// controls BELOW it, so the next click hit an option and added a conductor
	// instead of submitting the form.
	//
	// Same containment test as onWindowClick; a null relatedTarget (focus left the
	// document, or moved to something unfocusable) counts as leaving. Clicking an
	// option can never trip this: the options preventDefault their mousedown, so
	// focus never leaves the input in the first place.
	function onFocusOut(event: FocusEvent): void {
		if (!open) return;
		const next = event.relatedTarget;
		if (next instanceof Node && root && root.contains(next)) return;
		closeDropdown();
	}

	/**
	 * #132/T2 review F4 — the empty-state line, rendered as a SIBLING of the
	 * listbox (a `role="listbox"` may own only `option`/`group` children, so a
	 * `role="status"` inside it made the listbox's accessibility tree malformed
	 * and AT enumerating children by role skipped it) and mounted from first
	 * render whenever `emptyLabel` is supplied — a live region inserted
	 * already-populated is generally NOT announced; only later mutations to an
	 * already-present region are. Same discipline as the page's
	 * `season-create-status` region.
	 */
	const showEmpty = $derived(open && filtered.length === 0);
</script>

<svelte:window onclick={onWindowClick} />

<div bind:this={root} class="relative" onfocusout={onFocusOut}>
	<input
		type="text"
		data-testid="autocomplete-input"
		bind:this={inputEl}
		role="combobox"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={open ? listboxId : undefined}
		aria-activedescendant={open ? optionId(filtered[activeIndex]) : undefined}
		aria-invalid={errorId ? true : undefined}
		aria-describedby={errorId}
		aria-label={label}
		{placeholder}
		value={query}
		oninput={onInput}
		onkeydown={onKeydown}
		class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
	/>
	{#if open}
		<div
			id={listboxId}
			data-testid="autocomplete-listbox"
			role="listbox"
			aria-label={label}
			class={showEmpty
				? 'sr-only'
				: 'absolute z-10 mt-1 flex w-full flex-col border border-ink bg-paper py-1 shadow-sm'}
		>
			<!-- #136 — an option row is tap-to-act: a tap COMMITS the pick (adds a
			     conductor chip / sets the event type), so it carries the same 44px
			     touch-target floor as every other admin button. The component's only
			     consumer is the agenda's admin surface, so the taller rows are entirely
			     an admin-side cost. `flex items-center` keeps the label vertically
			     centred in the taller row; `text-left` still governs the left edge. -->
			{#each filtered as item (item.id)}
				<button
					type="button"
					id={optionId(item)}
					data-testid="autocomplete-option-{item.id}"
					role="option"
					aria-selected={filtered[activeIndex]?.id === item.id}
					tabindex="-1"
					class="flex min-h-11 items-center px-2 py-1 text-left text-xs text-ink hover:bg-ink-5"
					onclick={() => pick(item)}
					onmousedown={(event) => event.preventDefault()}
				>
					{item.label}
				</button>
			{/each}
		</div>
	{/if}
	<!-- F4: outside the listbox, and mounted (empty) from first render so the
	     live region is present BEFORE its text arrives. Takes the popup's slot
	     visually while it has something to say; the option-less listbox above
	     collapses to sr-only in exactly that case, so the two never overlap. -->
	{#if emptyLabel}
		<p
			data-testid="autocomplete-empty"
			role="status"
			class={showEmpty
				? 'absolute z-10 mt-1 w-full border border-ink bg-paper px-2 py-1 text-xs text-ink-2 shadow-sm'
				: 'sr-only'}
		>
			{showEmpty ? emptyLabel : ''}
		</p>
	{/if}
</div>

<!-- (*MVOX:Tallis* — #132/T2 RED stub + props contract) -->
<!-- (*MVOX:Palestrina* — #132/T2 GREEN implementation) -->
<!-- (*MVOX:Palestrina* — #132/T4 review F1: onQueryChange seam) -->
