<!-- src/lib/profile/ProfileField.svelte -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';
	import type { FieldKey } from '$lib/profile/fieldMove';
	import SegmentedPill from '$lib/components/SegmentedPill.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import RedactedText from '$lib/components/RedactedText.svelte';
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

	const activatorDisabled = $derived((saving && disabled) || offline);
	let focusPending = $state(false);

	/** Restore only on keyboard dismissals: after a blur the user already chose where
	 *  focus went. */
	function restoreActivatorFocus(): void {
		focusPending = true;
	}

	// #565: an Enter-save disables the activator until the write settles; focus it then,
	// unless the user has moved focus somewhere in the meantime.
	$effect(() => {
		if (!focusPending || !activatorRef || activatorDisabled) return;
		focusPending = false;
		const current = document.activeElement;
		if (current === null || current === document.body) activatorRef.focus();
	});

	function openEditor() {
		// Opening the editor exits a #131 preview, so the value the user clicked is the
		// value they edit, not the draft underneath it.
		previewLevel = null;
		focusPending = false;
		preEditValue = value;
		editing = true;
	}

	function confirmEdit(restoreFocus = false) {
		if (!editing) return;
		editing = false;
		if (restoreFocus) restoreActivatorFocus();
		onblur(field);
	}

	function cancelEdit(restoreFocus = false) {
		if (!editing) return;
		editing = false;
		value = preEditValue;
		if (restoreFocus) restoreActivatorFocus();
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

	type TierState = 'transport' | 'active' | 'leak' | 'conflict' | 'inactive';
	function stateOf(level: Level): TierState {
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

	let rovingLevel = $state<Level | null | undefined>(null);

	function tierAriaLabel(level: Level, s: TierState): string {
		const label = LEVEL_LABEL[level]();
		if (namePrivateDisabled && level === 'private') return m.profile_name_private_disabled();
		if (previewLevel === level) return m.profile_visibility_confirm_preview({ level: label });
		if (s === 'active') return m.profile_visibility_active({ level: label });
		if (s === 'leak' || s === 'conflict') return m.profile_visibility_leak({ level: label });
		return m.profile_visibility_move({ field: FIELD_LABEL[field](), level: label });
	}

	function tierClass(level: Level, s: TierState): string {
		if (namePrivateDisabled && level === 'private') return 'opacity-50';
		if (s === 'leak') return 'text-red-700';
		if (s === 'conflict') return 'text-amber-700';
		if (s !== 'inactive') return '';
		return movable && !disabled ? 'hover:bg-ink hover:text-paper' : 'opacity-50';
	}

	function handleGroupKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') previewLevel = null;
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
			<!-- #361, #618 — marked through a wrapping span: ::after cannot render on an <input>. -->
			<span {...{ [REDACT_ATTR]: '' }} class="relative flex flex-col">
				{@render fieldInput()}
			</span>
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
				disabled={activatorDisabled}
				class="group flex min-h-11 w-full appearance-none items-center gap-2 rounded-md border border-ink px-3 py-2 text-left disabled:opacity-50"
				onclick={openEditor}
			>
				<span class="sr-only">{EDIT_LABEL[field]()}</span>
				<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
				<span data-testid="profile-{field}-value" class="grow truncate">
					{#if field === 'name'}
						<PersonName name={displayValue} />
					{:else}
						<RedactedText>{displayValue}</RedactedText>
					{/if}
				</span>
			</button>
		</div>
	{/if}

	<!-- #156 — arrows never activate: a second activation on a conflict tier resolves it. -->
	<SegmentedPill
		testid="profile-tiers-{field}"
		label={FIELD_LABEL[field]()}
		options={LEVELS.map((level) => {
			const s = stateOf(level);
			return {
				value: level,
				label: LEVEL_LABEL[level](),
				testid: `profile-vis-${field}-${level}`,
				ariaLabel: tierAriaLabel(level, s),
				disabled: isButtonDisabled(level, s),
				busy: s === 'transport' || (s === 'active' && saving),
				class: tierClass(level, s)
			};
		})}
		selected={LEVELS.find((level) => stateOf(level) === 'active') ?? null}
		emptyAllowed={false}
		kind="data"
		buttonClass="flex items-center gap-1 px-2 py-1 text-xs"
		bind:roving={rovingLevel}
		onselect={(level) => level && clickLevel(level)}
		onkeydown={handleGroupKeydown}
	>
		{#snippet option(o)}
			{@const level = o.value}
			{@const s = stateOf(level)}
			{#if previewLevel === level}
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
				{o.label}
			{/if}
		{/snippet}
	</SegmentedPill>

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
