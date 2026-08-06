<!-- src/lib/components/profile/ProfileLevelCard.svelte -->
<!--
	T4.6/#26 — one visibility level's editable profile (name + email). One `profile`
	entity backs each level; its own `_sharing` is the sole visibility gate (T4.3 §1).

	Feedback is a REASON, not a collapsed boolean (the RsvpControl lesson):
	  • `pending`    — a save for this level is in flight → inputs+button disabled,
	                   aria-busy, button reads "Saving…".
	  • `saveFailed` — the last save for this level rejected → an inline error line.
	  • `saved`      — the last save was server-confirmed → a muted "Saved" stamp.
	The status line is ALWAYS rendered (min-height reserves the space) so an
	appearing/disappearing message never shifts the layout.

	AC2: this component never decides "saved" — the page flips `saved` only after the
	orchestrator reconciles a server-confirmed write. Here it is a pure prop.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';

	interface Props {
		level: Level;
		name?: string;
		email?: string;
		pending?: boolean;
		saveFailed?: boolean;
		saved?: boolean;
		canSave?: boolean;
		onsave?: () => void;
	}
	let {
		level,
		name = $bindable(''),
		email = $bindable(''),
		pending = false,
		saveFailed = false,
		saved = false,
		canSave = false,
		onsave
	}: Props = $props();

	const LABELS: Record<Level, () => string> = {
		public: m.profile_level_public_label,
		domain: m.profile_level_domain_label,
		private: m.profile_level_private_label
	};
	const HINTS: Record<Level, () => string> = {
		public: m.profile_level_public_hint,
		domain: m.profile_level_domain_hint,
		private: m.profile_level_private_hint
	};

	function handleSave() {
		if (!canSave || pending || !onsave) return;
		onsave();
	}
</script>

<section
	data-testid="profile-level-{level}"
	class="flex flex-col gap-3 rounded-lg border border-ink-4 p-4"
	aria-busy={pending ? 'true' : undefined}
>
	<div class="flex flex-col gap-1">
		<h2 class="font-display text-lg text-ink">{LABELS[level]()}</h2>
		<p class="text-xs text-ink-2">{HINTS[level]()}</p>
	</div>

	<label class="flex flex-col gap-1 text-sm">
		{m.profile_field_name_label()}
		<input
			data-testid="profile-{level}-name"
			bind:value={name}
			disabled={pending}
			class="rounded-md border border-ink px-3 py-2 text-sm disabled:opacity-50"
		/>
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.profile_field_email_label()}
		<input
			type="email"
			data-testid="profile-{level}-email"
			bind:value={email}
			disabled={pending}
			class="rounded-md border border-ink px-3 py-2 text-sm disabled:opacity-50"
		/>
	</label>

	<button
		type="button"
		data-testid="profile-{level}-save"
		disabled={!canSave || pending}
		aria-busy={pending ? 'true' : undefined}
		class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:opacity-50"
		onclick={handleSave}
	>
		{pending ? m.profile_saving() : m.profile_save()}
	</button>

	<!--
		Status line — ALWAYS rendered so an appearing/disappearing message never shifts
		layout. `saveFailed` (an error the user must see) wins over `saved` (a transient
		confirmation); a fresh save attempt clears both upstream.
	-->
	<p class="min-h-[18px] text-xs leading-[18px]" class:text-red-700={saveFailed}>
		{#if saveFailed}
			<span data-testid="profile-{level}-error" role="alert">{m.profile_save_error()}</span>
		{:else if saved}
			<span data-testid="profile-{level}-saved" class="text-ink-2">{m.profile_saved()}</span>
		{/if}
	</p>
</section>
