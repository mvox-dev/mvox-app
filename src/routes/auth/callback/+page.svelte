<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { runCallbackExchange } from './run-callback-exchange';

	// Client-side token exchange. Entu redirects here as `/auth/callback?key=<JWT>`
	// (the JWT is appended directly after `key=`). The orchestration lives in
	// run-callback-exchange.ts (testable); this component only reads the key, drives
	// it, and reflects status.
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
		<p class="font-sans text-sm text-ink">Signing you in…</p>
	{:else if ui === 'success'}
		<p class="font-sans text-sm text-ink">Signed in. Redirecting…</p>
	{:else}
		<p class="font-sans text-sm text-ink">
			Sign-in failed. <a class="underline" href="/auth/login">Try again</a>
		</p>
	{/if}
</main>
