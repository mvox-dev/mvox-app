<!-- src/lib/components/profile/ProfileField.svelte -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';
	import type { FieldKey } from '$lib/profile/fieldMove';

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
		disabled: boolean;
		moveFailed: boolean;
		saveFailed: boolean;
		onvisibilitychange: (field: FieldKey, toLevel: Level) => void;
		onvaluechange: (field: FieldKey, value: string) => void;
		onblur: (field: FieldKey) => void;
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
		disabled = false,
		moveFailed = false,
		saveFailed = false,
		onvisibilitychange,
		onvaluechange,
		onblur
	}: Props = $props();

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
		if (state === 'active' && saving) return true;
		if (namePrivateDisabled && level === 'private') return true;
		if (disabled || !movable || state !== 'inactive') return true;
		return false;
	}

	function clickLevel(level: Level) {
		if (namePrivateDisabled && level === 'private') return;
		if (disabled || !movable) return;
		if (stateOf(level) !== 'inactive') return;
		onvisibilitychange(field, level);
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
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
			{value}
			oninput={handleInput}
			onblur={handleBlur}
			disabled={saving && disabled}
			class="rounded-md border border-ink px-3 py-2 text-sm disabled:opacity-50"
		/>
	</label>

	<div class="flex gap-2" role="group" aria-label={FIELD_LABEL[field]()}>
		{#each LEVELS as level (level)}
			{@const s = stateOf(level)}
			{@const btnDisabled = isButtonDisabled(level, s)}
			<button
				type="button"
				data-testid="profile-vis-{field}-{level}"
				disabled={btnDisabled}
				aria-busy={s === 'transport' ? 'true' : (s === 'active' && saving) ? 'true' : undefined}
				aria-pressed={s === 'active'}
				aria-label={namePrivateDisabled && level === 'private'
					? m.profile_name_private_disabled()
					: s === 'active'
						? m.profile_visibility_active({ level: LEVEL_LABEL[level]() })
						: s === 'leak' || s === 'conflict'
							? m.profile_visibility_leak({ level: LEVEL_LABEL[level]() })
							: m.profile_visibility_move({ field: FIELD_LABEL[field](), level: LEVEL_LABEL[level]() })}
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
				{#if s === 'transport'}
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
		{:else if conflict}
			<span data-testid="profile-vis-{field}-conflict-note" class="text-amber-700"
				>{m.profile_visibility_conflict({ field: FIELD_LABEL[field]() })}</span
			>
		{:else if transportLevel !== null}
			<span class="text-ink-2">{m.profile_visibility_moving()}</span>
		{/if}
	</p>
</div>
