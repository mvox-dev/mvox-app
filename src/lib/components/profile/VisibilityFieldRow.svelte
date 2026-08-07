<!--
	T4.7/#27 — one field's visibility control: three icons (private / collective / public),
	one per `profile` entity level. The field lives at exactly ONE level (its narrowest
	non-empty holder = `currentLevel`); clicking another level MOVES it there (create-in-
	new → delete-from-old, AC1). No icon settles on click — the parent flips `transportLevel`
	while a move is in flight and only lights the new level after the server confirms
	(honest round trip). A `leak` level is a wider entity that still holds the value from an
	interrupted move — flagged here, but the repair BANNER (not this icon) is the action.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';
	import type { FieldKey } from '$lib/profile/fieldMove';

	interface Props {
		field: FieldKey;
		value: string;
		/** The narrowest non-empty holder — the level the field currently renders from. */
		currentLevel: Level | null;
		/** The level whose icon is mid-move (spinner); null when idle. */
		transportLevel: Level | null;
		/** Wider entities still holding the value from an unfinished move (flagged, not primary). */
		leakLevels: Level[];
		/**
		 * A move needs EXACTLY ONE current holder. `movable` is false when the field is
		 * unset (0 holders — nothing to move; set it via the level card above) OR held at
		 * ≥2 levels (a duplicate/conflict — reconcile first). When false, no icon accepts a
		 * click: an enabled-but-inert control (a silent no-op) is forbidden by the standing
		 * fail-loud rule — the icons go visibly disabled instead.
		 */
		movable?: boolean;
		/**
		 * The field holds DIFFERENT values at ≥2 levels (a legitimate T4.6 state, NOT an
		 * unfinished move — so no repair banner). Surfaced HERE as a note + `conflictLevels`
		 * markers so the wider holder is not misrendered as an empty, clickable icon.
		 */
		conflict?: boolean;
		/** The wider holder levels (beyond the narrowest) in a distinct-value conflict. */
		conflictLevels?: Level[];
		/** Single-flight busy — some move/repair/save is in flight anywhere; block new moves. */
		disabled?: boolean;
		moveFailed?: boolean;
		onmove?: (field: FieldKey, toLevel: Level) => void;
	}
	let {
		field,
		value,
		currentLevel,
		transportLevel,
		leakLevels,
		movable = true,
		conflict = false,
		conflictLevels = [],
		disabled = false,
		moveFailed = false,
		onmove
	}: Props = $props();

	// Narrow→wide, matching the narrower-wins ordering.
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

	function stateOf(level: Level): 'transport' | 'active' | 'leak' | 'conflict' | 'inactive' {
		if (transportLevel === level) return 'transport';
		if (currentLevel === level) return 'active';
		if (leakLevels.includes(level)) return 'leak';
		if (conflictLevels.includes(level)) return 'conflict';
		return 'inactive';
	}

	function click(level: Level) {
		if (disabled || !movable) return; // nothing to move / must reconcile first
		if (stateOf(level) !== 'inactive') return; // active/leak/conflict/transport are non-moves
		onmove?.(field, level);
	}
</script>

<div class="flex flex-col gap-1" data-testid="profile-field-{field}">
	<div class="flex items-baseline justify-between gap-2">
		<span class="text-sm font-medium text-ink">{FIELD_LABEL[field]()}</span>
		<span class="truncate text-sm text-ink-2">{value || m.profile_visibility_unset()}</span>
	</div>

	<div class="flex gap-2" role="group" aria-label={FIELD_LABEL[field]()}>
		{#each LEVELS as level (level)}
			{@const s = stateOf(level)}
			<button
				type="button"
				data-testid="profile-vis-{field}-{level}"
				disabled={disabled || !movable || s !== 'inactive'}
				aria-busy={s === 'transport' ? 'true' : undefined}
				aria-pressed={s === 'active'}
				aria-label={s === 'active'
					? m.profile_visibility_active({ level: LEVEL_LABEL[level]() })
					: s === 'leak' || s === 'conflict'
						? m.profile_visibility_leak({ level: LEVEL_LABEL[level]() })
						: m.profile_visibility_move({ field: FIELD_LABEL[field](), level: LEVEL_LABEL[level]() })}
				onclick={() => click(level)}
				class="flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:cursor-default"
				class:border-ink={s === 'active'}
				class:bg-ink={s === 'active'}
				class:text-paper={s === 'active'}
				class:border-red-500={s === 'leak'}
				class:text-red-700={s === 'leak'}
				class:border-amber-500={s === 'conflict'}
				class:text-amber-700={s === 'conflict'}
				class:border-ink-4={s === 'inactive' || s === 'transport'}
				class:hover:bg-ink={s === 'inactive' && movable && !disabled}
				class:hover:text-paper={s === 'inactive' && movable && !disabled}
				class:opacity-50={(disabled || !movable) && s === 'inactive'}
			>
				{#if s === 'transport'}
					<span data-testid="profile-vis-{field}-{level}-transport" aria-hidden="true">…</span>
				{:else if s === 'active'}
					<span data-testid="profile-vis-{field}-{level}-active" aria-hidden="true">●</span>
				{:else if s === 'leak'}
					<span aria-hidden="true">!</span>
				{:else if s === 'conflict'}
					<span data-testid="profile-vis-{field}-{level}-conflict" aria-hidden="true">≠</span>
				{:else}
					<span aria-hidden="true">○</span>
				{/if}
				{LEVEL_LABEL[level]()}
			</button>
		{/each}
	</div>

	<p class="min-h-[16px] text-xs leading-4 text-red-700">
		{#if moveFailed}
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
