<!-- #267 — the admin-only roster-names toggle. The page calls load() and reset() through
	bind:this, so the generation-guarded read keeps the page's load order. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { adminStore } from '$lib/nav/adminStore';
	import { readRosterNamesSetting, updateRosterShowRealNames } from '$lib/collective/rosterNames';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	interface Props {
		isOffline: boolean;
		generation: () => number;
		activeContext: () => { cfg: EntuCfg; personId: string } | null;
	}

	let { isOffline, generation, activeContext }: Props = $props();

	// `rosterShowRealNames` is the server-confirmed value only, never set optimistically.
	let rosterDbEntityId = $state<string | null>(null);
	let rosterShowRealNames = $state(false);
	let rosterBusy = $state(false);
	let rosterStatus = $state('');
	let rosterError = $state<string | null>(null);
	const admin = $derived($adminStore);

	// Bound so reset() can force the DOM back even when the reset lands the same boolean:
	// Svelte's `value={…}` effect only re-runs on a signal change.
	let rosterSelectEl = $state<HTMLSelectElement | null>(null);

	export function reset(): void {
		rosterDbEntityId = null;
		rosterShowRealNames = false;
		if (rosterSelectEl) rosterSelectEl.value = 'profile';
		rosterBusy = false;
		rosterStatus = '';
		rosterError = null;
	}

	// Fired apart from the profile-fields read, so a fields load-error cannot take this
	// control down. console.warn, not .error: a failed read leaves the default standing.
	export async function load(cfg: EntuCfg, g: number): Promise<void> {
		try {
			const setting = await readRosterNamesSetting(cfg);
			if (g !== generation()) return;
			rosterDbEntityId = setting.dbEntityId;
			rosterShowRealNames = setting.showRealNames;
		} catch (err) {
			if (g !== generation()) return;
			console.warn('profile: roster-names setting read failed', err);
		}
	}

	// Server-confirmed, never optimistic. The browser has already moved `.value` to the
	// pick, so every exit puts the DOM back to the last confirmed value itself.
	async function onRosterNamesChange(e: Event): Promise<void> {
		const selectEl = e.currentTarget as HTMLSelectElement;
		const value = selectEl.value === 'real';
		if (isOffline) {
			selectEl.value = rosterShowRealNames ? 'real' : 'profile';
			return;
		}
		const ctx = activeContext();
		const dbEntityId = rosterDbEntityId;
		if (!ctx || !dbEntityId) {
			selectEl.value = rosterShowRealNames ? 'real' : 'profile';
			rosterStatus = '';
			rosterError = m.profile_roster_names_error();
			return;
		}
		const g = generation();
		const preWriteValue = rosterShowRealNames;
		rosterStatus = '';
		rosterError = null;
		rosterBusy = true;
		try {
			await updateRosterShowRealNames(ctx.cfg, dbEntityId, value);
			if (g !== generation()) return;
			rosterShowRealNames = value;
			selectEl.value = value ? 'real' : 'profile';
			rosterBusy = false;
			rosterStatus = m.profile_roster_names_saved();
		} catch (err) {
			if (g !== generation()) return;
			console.error('profile: roster-names write failed', err);
			rosterShowRealNames = preWriteValue;
			selectEl.value = preWriteValue ? 'real' : 'profile';
			rosterBusy = false;
			rosterError = m.profile_roster_names_error();
		}
	}
</script>

<!-- App chrome, not gated on route-load status. Non-admins get no DOM; an admin gets a
	disabled select until the setting's entity id is confirmed, since nothing can be saved. -->
{#if admin === 'admin'}
	<div class="flex flex-col items-start gap-1">
		<label for="profile-roster-names" class="text-sm text-ink-2">
			{m.profile_roster_names_label()}
		</label>
		<select
			id="profile-roster-names"
			data-testid="profile-roster-names"
			bind:this={rosterSelectEl}
			value={rosterShowRealNames ? 'real' : 'profile'}
			disabled={rosterBusy || rosterDbEntityId === null || isOffline}
			onchange={onRosterNamesChange}
			class="border border-ink-5 bg-paper px-2 py-1 text-ink"
		>
			<option value="profile">{m.profile_roster_names_profile()}</option>
			<option value="real">{m.profile_roster_names_real()}</option>
		</select>
		<p data-testid="profile-roster-names-hint" class="text-xs text-ink-3">
			{m.profile_roster_names_hint()}
		</p>
		{#if rosterError}
			<p data-testid="profile-roster-names-error" role="alert" class="text-xs text-red-700">
				{rosterError}
			</p>
		{/if}
		<!-- Persistent live region: mounted empty, cleared at the start of the next attempt. -->
		<div
			data-testid="profile-roster-names-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{rosterStatus}
		</div>
	</div>
{/if}
