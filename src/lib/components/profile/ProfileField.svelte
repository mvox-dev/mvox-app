<!-- src/lib/components/profile/ProfileField.svelte -->
<script lang="ts">
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
		onresolve
	}: Props = $props();

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
		onblur(field);
	}
</script>

<div class="flex flex-col gap-2" data-testid="profile-field-{field}">
	<label class="flex flex-col gap-1 text-sm">
		{FIELD_LABEL[field]()}
		<input
			type={field === 'email' ? 'email' : 'text'}
			data-testid="profile-{field}"
			value={displayValue}
			oninput={handleInput}
			onblur={handleBlur}
			disabled={saving && disabled}
			class="rounded-md border border-ink px-3 py-2 disabled:opacity-50"
		/>
	</label>

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
