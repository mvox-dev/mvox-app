<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { runCallbackExchange } from './run-callback-exchange';
	import { m } from '$lib/paraglide/messages.js';

	// Entu redirects here as `/auth/callback?key=<JWT>`; run-callback-exchange.ts does the
	// exchange, this page only reads the key and shows the status.
	type ExchangeUi = 'pending' | 'success' | 'failed';
	let ui = $state<ExchangeUi>('pending');

	onMount(() => {
		const key = new URL(window.location.href).searchParams.get('key') ?? '';
		runCallbackExchange(key)
			.then((outcome) => {
				ui = outcome.ok ? 'success' : 'failed';
				goto(outcome.redirectTo);
			})
			.catch(() => {
				// Belt-and-braces: nothing above should reject, but never strand the spinner.
				ui = 'failed';
				goto('/auth/login?error=persist_failed');
			});
	});
</script>

<main class="flex min-h-screen items-center justify-center bg-paper text-ink">
	{#if ui === 'pending'}
		<p class="font-sans text-sm text-ink">{m.auth_callback_pending()}</p>
	{:else if ui === 'success'}
		<p class="font-sans text-sm text-ink">{m.auth_callback_success()}</p>
	{:else}
		<p class="font-sans text-sm text-ink">
			{m.auth_callback_failed()}
			<a class="underline" href="/auth/login">{m.auth_callback_retry()}</a>
		</p>
	{/if}
</main>
