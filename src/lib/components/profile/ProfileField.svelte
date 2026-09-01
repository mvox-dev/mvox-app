<!-- src/lib/components/profile/ProfileField.svelte -->
<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';
	import type { FieldKey } from '$lib/profile/fieldMove';
	import { rovingNextIndex } from '$lib/a11y/roving';

	interface Props {
		field: FieldKey;
		value: string;
		activeLevel: Level;
		transportLevel: Level | null;
		leakLevels: Level[];
		saving: boolean;
		movable: boolean;
		conflict: boolean;
		conflictLevels: Level[];
		/** #131 — each level's OWN value for this field, so a conflict-tier tap can preview it. */
		conflictValues: Record<Level, string>;
		disabled: boolean;
		moveFailed: boolean;
		saveFailed: boolean;
		onvisibilitychange: (field: FieldKey, toLevel: Level) => void;
		onvaluechange: (field: FieldKey, value: string) => void;
		onblur: (field: FieldKey) => void;
		/** #131 — second tap on the same previewed conflict tier: resolve in its favor. */
		onresolve: (field: FieldKey, level: Level) => void;
		/** #205 — Escape-cancels-edit: the pending idle-autosave timer for this
		 *  field must die with the cancelled keystrokes, not fire later. */
		oncancel: (field: FieldKey) => void;
	}
	let {
		field,
		value = $bindable(''),
		activeLevel,
		transportLevel = null,
		leakLevels = [],
		saving = false,
		movable = true,
		conflict = false,
		conflictLevels = [],
		conflictValues = { public: '', domain: '', private: '' },
		disabled = false,
		moveFailed = false,
		saveFailed = false,
		onvisibilitychange,
		onvaluechange,
		onblur,
		onresolve,
		oncancel
	}: Props = $props();

	// #205 — whole-field display-then-edit (standing UX rule 4 + the profile
	// addendum): DISPLAY is the default; the raw <input> only mounts after the
	// whole-field activator is clicked/tabbed-and-activated. Local to this
	// component instance (one per field) — no seam into the parent beyond the
	// existing onvaluechange/onblur/oncancel callbacks.
	let editing = $state(false);
	/** The draft value at the moment editing opened — Escape reverts to this. */
	let preEditValue = '';
	/** #205 review F3 — the activator the editor replaced, so closing can land
	 *  focus back on it (WCAG 2.4.3). Before this branch the <input> was
	 *  permanently mounted, so nothing could unmount the focused element; now
	 *  Enter/Escape do, and without this the tab position dropped to <body>. */
	let activatorRef = $state<HTMLButtonElement | undefined>(undefined);

	/** The house pattern (roster `cancelRename`/`submitRename`, admin's
	 *  `namePencilRef` behind its `restoreFocus` flag): restore only on the
	 *  KEYBOARD dismissals. A blur means the user already moved focus somewhere
	 *  deliberately — yanking it back to the pencil would fight them. */
	async function restoreActivatorFocus(): Promise<void> {
		await tick();
		activatorRef?.focus();
	}

	function openEditor() {
		// #205 review F4 — leaving a #131 conflict PREVIEW live across the
		// display→edit swap made the text visibly jump: display renders
		// `displayValue` (the previewed tier's value) while the editor binds the
		// underlying draft, so tapping a previewed field replaced "Ada Lovelace"
		// with "Ada" unexplained, and Escape then restored the preview rather than
		// what the editor had shown. Activating the field EXITS preview mode, so
		// the value the user clicked is the value they get to edit.
		previewLevel = null;
		preEditValue = value;
		editing = true;
	}

	function confirmEdit(restoreFocus = false) {
		if (!editing) return;
		editing = false;
		if (restoreFocus) void restoreActivatorFocus();
		onblur(field);
	}

	function cancelEdit(restoreFocus = false) {
		if (!editing) return;
		editing = false;
		value = preEditValue;
		if (restoreFocus) void restoreActivatorFocus();
		oncancel(field);
	}

	function handleFieldKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			confirmEdit(true);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit(true);
		}
	}

	/** Svelte action: focus the element the instant it mounts — same helper
	 *  admin/+page.svelte and event/[id]/+page.svelte use for their own
	 *  display-then-edit inputs. */
	function focusOnMount(node: HTMLElement): void {
		node.focus();
	}

	// #131 — browse-then-confirm: first tap on a conflicting tier previews its
	// value; a second tap on the SAME tier resolves. Purely local UI state —
	// never written back through onvaluechange (a preview is not an edit).
	let previewLevel = $state<Level | null>(null);
	const displayValue = $derived(previewLevel !== null ? conflictValues[previewLevel] : value);

	const LEVELS: readonly Level[] = ['private', 'domain', 'public'];
	const LEVEL_LABEL: Record<Level, () => string> = {
		public: m.profile_level_public_label,
		domain: m.profile_level_domain_label,
		private: m.profile_level_private_label
	};
	const FIELD_LABEL: Record<FieldKey, () => string> = {
		name: m.profile_field_name_label,
		email: m.profile_field_email_label
	};
	// #205 — whole-field display-then-edit: the sr-only ACTION label carried by
	// the activator button (the admin/season reference pattern), distinct from
	// FIELD_LABEL above (the visible field name shown in both states).
	const EDIT_LABEL: Record<FieldKey, () => string> = {
		name: m.profile_name_edit_label,
		email: m.profile_email_edit_label
	};

	const namePrivateDisabled = $derived(field === 'name');

	function stateOf(level: Level): 'transport' | 'active' | 'leak' | 'conflict' | 'inactive' {
		if (transportLevel === level) return 'transport';
		if (activeLevel === level) return 'active';
		if (leakLevels.includes(level)) return 'leak';
		if (conflictLevels.includes(level)) return 'conflict';
		return 'inactive';
	}

	function isButtonDisabled(level: Level, state: string): boolean {
		if (namePrivateDisabled && level === 'private') return true;
		if (state === 'active' && saving) return true;
		// #131 — a conflict-tier button stays clickable (browse-then-confirm)
		// regardless of `movable` (always false during a conflict); it still
		// respects the write-lock (`disabled`) to avoid overlapping writes.
		if (state === 'conflict') return disabled;
		if (disabled || !movable || state !== 'inactive') return true;
		return false;
	}

	function clickLevel(level: Level) {
		if (namePrivateDisabled && level === 'private') return;
		const state = stateOf(level);
		if (state === 'conflict') {
			handleConflictClick(level);
			return;
		}
		if (disabled || !movable) return;
		if (state !== 'inactive') return;
		onvisibilitychange(field, level);
	}

	function handleConflictClick(level: Level) {
		if (disabled) return;
		if (previewLevel === level) {
			// Second tap on the SAME tier — resolve in its favor.
			previewLevel = null;
			onresolve(field, level);
		} else {
			// First tap, or a tap on a DIFFERENT tier while previewing — (re)preview.
			previewLevel = level;
		}
	}

	// #156 — roving tabindex. The derived active key must fall back to the
	// first ENABLED tier, not simply `activeLevel` — a naive "active tier gets
	// tabindex 0" rule can park the sole tab stop on a disabled button (e.g.
	// the name field's private tier, or any tier during a write-lock) and
	// strand the group. Arrows must NEVER activate here: a second activation
	// on a conflict tier RESOLVES the conflict destructively (browse-then-
	// confirm), so keydown navigation only ever moves focus.
	let rovingLevel = $state<Level | null>(null);
	const firstEnabledLevel = $derived.by(() => {
		for (const level of LEVELS) {
			if (!isButtonDisabled(level, stateOf(level))) return level;
		}
		return LEVELS[0];
	});
	const activeTabLevel = $derived(
		rovingLevel !== null && !isButtonDisabled(rovingLevel, stateOf(rovingLevel))
			? rovingLevel
			: firstEnabledLevel
	);

	function handleGroupKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && previewLevel !== null) {
			previewLevel = null;
			return;
		}
		const group = e.currentTarget as HTMLElement;
		const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
		const idx = buttons.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, buttons.length);
		if (next < 0) return;
		e.preventDefault();
		buttons[next].focus();
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		previewLevel = null;
		value = target.value;
		onvaluechange(field, target.value);
	}

	function handleBlur() {
		// No focus restore — see `restoreActivatorFocus`: focus already left for
		// somewhere the user chose.
		confirmEdit(false);
	}
</script>

<div class="flex flex-col gap-2" data-testid="profile-field-{field}">
	<!-- #205 whole-field display-then-edit (admin/+page.svelte:513-540 reference
	     pattern) — DISPLAY is a native <button> wrapping the pencil AND the
	     value, `min-h-11 w-full` so the whole field area (not just the ✎) is
	     the click/tab activator; EDIT swaps in the real <input>, focused via
	     the same `focusOnMount` action the admin/season editors use. The
	     visibility tier toolbar below is a SEPARATE concept and stays mounted
	     across both states (untouched by this retrofit). -->
	{#if editing}
		<label class="flex flex-col gap-1 text-sm">
			{FIELD_LABEL[field]()}
			<input
				type={field === 'email' ? 'email' : 'text'}
				data-testid="profile-{field}"
				value={value}
				use:focusOnMount
				oninput={handleInput}
				onkeydown={handleFieldKeydown}
				onblur={handleBlur}
				disabled={saving && disabled}
				class="rounded-md border border-ink px-3 py-2 disabled:opacity-50"
			/>
		</label>
	{:else}
		<div class="flex flex-col gap-1 text-sm">
			<span>{FIELD_LABEL[field]()}</span>
			<!-- #205 review F1 — NO `aria-labelledby` on the activator. It SUPERSEDES
			     the element's own contents in the accname algorithm, so pointing it at
			     the field-name + value spans dropped the sr-only action verb from the
			     computed name: AT heard "Name Ada" with nothing saying the control
			     opens an editor, and the two new Paraglide keys rendered but were
			     never surfaced. Content-derived naming gives "<Edit name> <value>",
			     which is the contract this shape exists for. The visible field name
			     stays OUTSIDE the button (it names the field, not the action).
			     F5 — child order is sr-only, ✎, value: pencil LEADING, matching the
			     admin/season reference so the glyph sits on the same side everywhere. -->
			<button
				type="button"
				data-testid="profile-{field}-edit"
				bind:this={activatorRef}
				disabled={saving && disabled}
				class="group flex min-h-11 w-full appearance-none items-center gap-2 rounded-md border border-ink px-3 py-2 text-left disabled:opacity-50"
				onclick={openEditor}
			>
				<span class="sr-only">{EDIT_LABEL[field]()}</span>
				<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
				<span data-testid="profile-{field}-value" class="grow truncate">
					{displayValue}
				</span>
			</button>
		</div>
	{/if}

	<!-- #156 — WAI-APG TOOLBAR, not a radiogroup: arrows MOVE focus only,
	     they never activate (a second activation on a conflict tier resolves
	     the conflict destructively, so browse-then-confirm is the only safe
	     shape here). `role="toolbar"` states that in the markup — under the
	     old bare `role="group"` nothing distinguished these buttons from the
	     app's arrow-SELECTS radiogroups, and svelte-check flagged the keydown
	     handler on a non-interactive role. `aria-pressed` toggle buttons
	     inside a toolbar are the APG pattern, so the state pin is unchanged. -->
	<div
		class="flex gap-2"
		role="toolbar"
		tabindex="-1"
		aria-label={FIELD_LABEL[field]()}
		onkeydown={handleGroupKeydown}
	>
		{#each LEVELS as level (level)}
			{@const s = stateOf(level)}
			{@const btnDisabled = isButtonDisabled(level, s)}
			{@const previewing = previewLevel === level}
			<button
				type="button"
				data-testid="profile-vis-{field}-{level}"
				disabled={btnDisabled}
				aria-busy={s === 'transport' ? 'true' : (s === 'active' && saving) ? 'true' : undefined}
				aria-pressed={s === 'active'}
				aria-label={namePrivateDisabled && level === 'private'
					? m.profile_name_private_disabled()
					: previewing
						? m.profile_visibility_confirm_preview({ level: LEVEL_LABEL[level]() })
						: s === 'active'
							? m.profile_visibility_active({ level: LEVEL_LABEL[level]() })
							: s === 'leak' || s === 'conflict'
								? m.profile_visibility_leak({ level: LEVEL_LABEL[level]() })
								: m.profile_visibility_move({ field: FIELD_LABEL[field](), level: LEVEL_LABEL[level]() })}
				tabindex={activeTabLevel === level ? 0 : -1}
				onfocus={() => (rovingLevel = level)}
				onclick={() => clickLevel(level)}
				class="flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-default"
				class:border-ink={s === 'active'}
				class:bg-ink={s === 'active' && !saving}
				class:text-paper={s === 'active' && !saving}
				class:border-red-500={s === 'leak'}
				class:text-red-700={s === 'leak'}
				class:border-amber-500={s === 'conflict'}
				class:text-amber-700={s === 'conflict'}
				class:border-ink-4={s === 'inactive' || s === 'transport'}
				class:hover:bg-ink={s === 'inactive' && movable && !disabled && !(namePrivateDisabled && level === 'private')}
				class:hover:text-paper={s === 'inactive' && movable && !disabled && !(namePrivateDisabled && level === 'private')}
				class:opacity-50={(btnDisabled && s === 'inactive') || (namePrivateDisabled && level === 'private')}
			>
				{#if previewing}
					<span data-testid="profile-vis-{field}-{level}-preview" aria-hidden="true">◐</span>
				{:else if s === 'transport'}
					<span data-testid="profile-vis-{field}-{level}-transport" aria-hidden="true">…</span>
				{:else if s === 'active' && saving}
					<span data-testid="profile-vis-{field}-{level}-saving" aria-hidden="true">●</span>
					{m.profile_saving()}
				{:else if s === 'active'}
					<span data-testid="profile-vis-{field}-{level}-active" aria-hidden="true">●</span>
				{:else if s === 'leak'}
					<span aria-hidden="true">!</span>
				{:else if s === 'conflict'}
					<span data-testid="profile-vis-{field}-{level}-conflict" aria-hidden="true">≠</span>
				{:else}
					<span aria-hidden="true">○</span>
				{/if}
				{#if !(s === 'active' && saving)}
					{LEVEL_LABEL[level]()}
				{/if}
			</button>
		{/each}
	</div>

	<p class="min-h-[16px] text-xs leading-4 text-red-700">
		{#if saveFailed}
			<span data-testid="profile-{field}-error" role="alert">{m.profile_save_error()}</span>
		{:else if moveFailed}
			<span data-testid="profile-vis-{field}-error" role="alert">{m.profile_move_error()}</span>
		{:else if conflict && previewLevel !== null}
			<span data-testid="profile-vis-{field}-preview-note" class="text-amber-700"
				>{m.profile_visibility_preview_note()}</span
			>
		{:else if conflict}
			<span data-testid="profile-vis-{field}-conflict-note" class="text-amber-700"
				>{m.profile_visibility_conflict({ field: FIELD_LABEL[field]() })}</span
			>
		{:else if transportLevel !== null}
			<span class="text-ink-2">{m.profile_visibility_moving()}</span>
		{/if}
	</p>
</div>
