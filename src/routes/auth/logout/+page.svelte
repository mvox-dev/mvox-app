<script lang="ts">
	import { onMount } from 'svelte';
	import { performLogout } from './perform-logout';

	// Client-side logout: clear the localStorage token + reset auth state. No server
	// cookie to clear (there is no server).
	let done = $state(false);

	onMount(() => {
		performLogout();
		done = true;
	});
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-3 bg-paper px-6 text-ink">
	<h1 class="font-display text-2xl">Signed out</h1>
	{#if done}
		<p class="text-sm text-ink">You have been signed out.</p>
	{/if}
	<a class="text-sm underline" href="/auth/login">Sign back in</a>
	<a class="text-sm underline" href="/">Return home</a>
</main>
