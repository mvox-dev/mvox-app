<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/auth/session';

	// Minimal auth-state reflection for the T3 walking skeleton — Byrd owns the real
	// landing UI. Shows signed-in vs signed-out and a login/logout affordance so the
	// OAuth round-trip is observable end-to-end.
	const auth = $derived($authStore);
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
	<p class="font-display text-2xl">{m.placeholder_greeting({ name: m.app_name() })}</p>

	{#if auth.status === 'authenticated'}
		<p class="text-sm text-ink" data-testid="auth-status">Signed in</p>
		<a class="text-sm underline" href="/auth/logout">Sign out</a>
	{:else if auth.status === 'anonymous'}
		<p class="text-sm text-ink" data-testid="auth-status">Signed out</p>
		<a class="text-sm underline" href="/auth/login">Sign in</a>
	{/if}
</main>
