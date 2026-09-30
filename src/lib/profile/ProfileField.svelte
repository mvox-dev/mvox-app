<!-- src/lib/profile/ProfileField.svelte -->
<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';
	import type { FieldKey } from '$lib/profile/fieldMove';
	import { rovingKeydown } from '$lib/a11y/roving';
	import PersonName from '$lib/components/PersonName.svelte';
	import { REDACT_ATTR } from '$lib/redact/redact';
	import { focusOnMount } from '$lib/a11y/focusable';

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
		/** #434 — offline the editor cannot be opened; one already open keeps its text and
		 *  the parent refuses the autosave. */
		offline?: boolean;
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
		offline = false,
		moveFailed = false,
		saveFailed = false,
		onvisibilitychange,
		onvaluechange,
		onblur,
		onresolve,
		oncancel
	}: Props = $props();

	// #205 — display by default; the <input> mounts only once the whole-field activator
	// is used. Local to this field.
	let editing = $state(false);
	/** The draft value at the moment editing opened — Escape reverts to this. */
	let preEditValue = '';
	/** #205 — the activator the editor replaced, so closing can put focus back (WCAG 2.4.3). */
	let activatorRef = $state<HTMLButtonElement | undefined>(undefined);

	/** Restore only on keyboard dismissals: after a blur the user already chose where
	 *  focus went. */
	async function restoreActivatorFocus(): Promise<void> {
		await tick();
		activatorRef?.focus();
	}

	function openEditor() {
		// Opening the editor exits a #131 preview, so the value the user clicked is the
		// value they edit, not the draft underneath it.
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

	// #131 — first tap on a conflicting tier previews it, a second resolves. A preview
	// is not an edit, so it never goes through onvaluechange.
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
	// #205 — the activator's sr-only action label, apart from the visible FIELD_LABEL.
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
		// #131 — a conflict tier stays clickable despite `movable`, but not under the write lock.
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
			previewLevel = null;
			onresolve(field, level);
		} else {
			previewLevel = level;
		}
	}

	// #156 — roving tabindex falls back to the first enabled tier, so the only tab stop
	// never sits on a disabled button. Arrows only move focus: activation can resolve.
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
		rovingKeydown(e, { selector: 'button:not([disabled])' });
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		previewLevel = null;
		value = target.value;
		onvaluechange(field, target.value);
	}

	function handleBlur() {
		confirmEdit(false);
	}
</script>

<div class="flex flex-col gap-2" data-testid="profile-field-{field}">
	<!-- #205 — display is one button over the whole field; edit swaps in the <input>. The
	     tier toolbar below stays mounted in both states. -->
	{#if editing}
		{#snippet fieldInput()}
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
		{/snippet}
		<label class="flex flex-col gap-1 text-sm">
			{FIELD_LABEL[field]()}
			<!-- #361 — the name editor is marked through a wrapping span (::after cannot render
			     on an <input>); the email editor stays unmarked (see #361). -->
			{#if field === 'name'}
				<span {...{ [REDACT_ATTR]: '' }} class="relative flex flex-col">
					{@render fieldInput()}
				</span>
			{:else}
				{@render fieldInput()}
			{/if}
		</label>
	{:else}
		<div class="flex flex-col gap-1 text-sm">
			<span>{FIELD_LABEL[field]()}</span>
			<!-- #205 — no aria-labelledby: it would replace the content-derived name "<Edit name>
			     <value>" and drop the action verb. Pencil leads, as on admin and season. -->
			<button
				type="button"
				data-testid="profile-{field}-edit"
				bind:this={activatorRef}
				disabled={(saving && disabled) || offline}
				class="group flex min-h-11 w-full appearance-none items-center gap-2 rounded-md border border-ink px-3 py-2 text-left disabled:opacity-50"
				onclick={openEditor}
			>
				<span class="sr-only">{EDIT_LABEL[field]()}</span>
				<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
				<span data-testid="profile-{field}-value" class="grow truncate">
					{#if field === 'name'}
						<PersonName name={displayValue} />
					{:else}
						{displayValue}
					{/if}
				</span>
			</button>
		</div>
	{/if}

	<!-- #156 — an APG toolbar, not a radiogroup: arrows move focus and never activate,
	     since a second activation on a conflict tier resolves it. -->
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
