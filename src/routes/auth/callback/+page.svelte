<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { exchangeSession } from '$lib/auth/exchange';
	import { setToken, setUser, setLastProvider } from '$lib/auth/storage';
	import { decodeState } from '$lib/auth/state';
	import { safeRedirectTarget } from '$lib/auth/redirect';
	import { OAUTH_STATE_KEY } from '../[provider]/build-oauth-init-url';
	import { hydrateAuth } from '$lib/auth/session';

	// Client-side token exchange. Entu redirects here as `/auth/callback?key=<JWT>`
	// (the JWT is appended directly after `key=`). We read the key from the URL,
	// validate the OAuth state stashed at initiation, exchange DB-LESS for a full
	// Entu JWT, persist it, and route on to the return target.
	type ExchangeUi = 'pending' | 'success' | 'failed';
	let ui = $state<ExchangeUi>('pending');

	onMount(() => {
		runExchange();
	});

	async function runExchange() {
		const key = new URL(window.location.href).searchParams.get('key') ?? '';

		const stateBlob = localStorage.getItem(OAUTH_STATE_KEY);
		if (!stateBlob) {
			ui = 'failed';
			goto('/auth/login?error=csrf_mismatch');
			return;
		}

		let decoded;
		try {
			decoded = decodeState(stateBlob);
		} catch {
			ui = 'failed';
			localStorage.removeItem(OAUTH_STATE_KEY);
			goto('/auth/login?error=csrf_mismatch');
			return;
		}

		const result = await exchangeSession({ sessionToken: key });
		if (!result.ok) {
			ui = 'failed';
			localStorage.removeItem(OAUTH_STATE_KEY);
			goto(`/auth/login?error=${result.error}`);
			return;
		}

		setToken(result.token);
		setUser(result.user);
		localStorage.removeItem(OAUTH_STATE_KEY);
		setLastProvider(decoded.provider);

		hydrateAuth();

		ui = 'success';
		goto(safeRedirectTarget(decoded.return_to));
	}
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
