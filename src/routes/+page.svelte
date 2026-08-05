<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/auth/session';
	import { collectiveState, selectedCollectiveStore, pickerModeStore } from '$lib/collectives/store';

	// Minimal auth + collective reflection for the walking skeleton — Byrd owns the
	// real landing UI (and T5 makes the agenda the post-login home). This proves the
	// token → marker-filtered collective selection resolves end-to-end.
	const auth = $derived($authStore);
	const collectives = $derived($collectiveState);
	const selected = $derived($selectedCollectiveStore);
	const pickerMode = $derived($pickerModeStore);
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
	<p class="font-display text-2xl">{m.placeholder_greeting({ name: m.app_name() })}</p>

	{#if auth.status === 'authenticated'}
		<p class="text-sm text-ink" data-testid="auth-status">Signed in</p>

		{#if collectives.status === 'ready' && selected}
			<p class="text-sm text-ink" data-testid="selected-collective">
				Collective: {selected.name}
			</p>
			{#if pickerMode === 'picker'}
				<a class="text-sm underline" href="/collectives">Switch collective</a>
			{/if}
		{:else if collectives.status === 'none'}
			<a class="text-sm underline" href="/collectives">No collectives yet</a>
		{:else if collectives.status === 'error'}
			<a class="text-sm underline" href="/collectives">Couldn't load collectives — retry</a>
		{:else}
			<p class="text-sm text-ink">Loading collectives…</p>
		{/if}

		<a class="text-sm underline" href="/auth/logout">Sign out</a>
	{:else if auth.status === 'anonymous'}
		<p class="text-sm text-ink" data-testid="auth-status">Signed out</p>
		<a class="text-sm underline" href="/auth/login">Sign in</a>
	{/if}
</main>
