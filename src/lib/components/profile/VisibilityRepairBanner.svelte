<!--
	T4.7/#27 AC3 — the ACTIVE interrupted-move surface. A value living in two entities is
	an inconsistency (an unfinished move), NOT a legitimate state. Narrower-wins hides it on
	OUR render, but for a tightening the wider copy is genuinely readable off the Entu API
	(Flag 3) — so this is a PRIVACY repair, and "Finish now" COMPLETES THE DELETE on the
	wider entity. It is dismissible only by acting (never a toast, never auto-cleared); a
	failed repair KEEPS the banner (preserve-on-error).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Level } from '$lib/profile/profileData';
	import type { FieldKey } from '$lib/profile/fieldMove';

	interface Props {
		field: FieldKey;
		/** The wider holders still exposing the value (the delete target). */
		widerLevels: Level[];
		/** Which copy drives severity/wording. `loaded` = direction lost at load (privacy-safe). */
		severity: 'tightening' | 'widening' | 'loaded';
		working?: boolean;
		failed?: boolean;
		onrepair?: (field: FieldKey) => void;
	}
	let { field, widerLevels, severity, working = false, failed = false, onrepair }: Props = $props();

	const LEVEL_LABEL: Record<Level, () => string> = {
		public: m.profile_level_public_label,
		domain: m.profile_level_domain_label,
		private: m.profile_level_private_label
	};
	const FIELD_LABEL: Record<FieldKey, () => string> = {
		name: m.profile_field_name_label,
		email: m.profile_field_email_label
	};

	// Name the WIDEST still-exposed level (the strongest exposure the member should see).
	const widestLabel = $derived(
		LEVEL_LABEL[widerLevels[widerLevels.length - 1] ?? widerLevels[0]]()
	);
	const fieldLabel = $derived(FIELD_LABEL[field]());

	const body = $derived(
		severity === 'tightening'
			? m.profile_repair_body_tightening({ field: fieldLabel, level: widestLabel })
			: severity === 'widening'
				? m.profile_repair_body_widening({ field: fieldLabel, level: widestLabel })
				: m.profile_repair_body_loaded({ field: fieldLabel, level: widestLabel })
	);
</script>

<div
	data-testid="profile-visibility-repair-{field}"
	role="alert"
	class="flex flex-col gap-2 rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-900"
>
	<strong class="font-medium">{m.profile_repair_title()}</strong>
	<p>{body}</p>
	<button
		type="button"
		data-testid="profile-visibility-repair-{field}-fix"
		disabled={working}
		aria-busy={working ? 'true' : undefined}
		class="self-start rounded-md border border-red-600 px-3 py-1 text-xs text-red-800 hover:bg-red-600 hover:text-paper disabled:opacity-50"
		onclick={() => onrepair?.(field)}
	>
		{working ? m.profile_repair_working() : m.profile_repair_action()}
	</button>
	<p class="min-h-[16px] text-xs leading-4">
		{#if failed}
			<span data-testid="profile-visibility-repair-{field}-error"
				>{m.profile_repair_error({ field: fieldLabel, level: widestLabel })}</span
			>
		{/if}
	</p>
</div>
