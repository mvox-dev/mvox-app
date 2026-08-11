<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getLastProvider } from '$lib/auth/storage';
	import { safeRedirectTarget } from '$lib/auth/redirect';
	// Provider list shared with the invite landing (T4.5) — extracted verbatim to
	// $lib/auth/providers.
	import { AUTH_PROVIDERS } from '$lib/auth/providers';
	// #107 review F4 — the session-expired copy is the DURABLE surface (the
	// per-page notice only flashes past before the redirect completes), so it
	// must come from the four locale files, not a hardcoded English literal that
	// can drift from `session_expired_message`. The page's other error branches
	// stay un-i18n'd — pre-existing, out of #107's scope.
	import { m } from '$lib/paraglide/messages.js';

	const error = $derived(page.url.searchParams.get('error'));
	// The guard redirects here with `?redirect=<path>`; fall back to `return_to`.
	const returnTo = $derived(
		safeRedirectTarget(
			page.url.searchParams.get('redirect') ?? page.url.searchParams.get('return_to')
		)
	);
	const lastProvider = $state(typeof window !== 'undefined' ? getLastProvider() : null);

	function providerHref(id: string, intent: 'login' | 'reauth'): string {
		return `/auth/${id}?return_to=${encodeURIComponent(returnTo)}&intent=${intent}`;
	}

	// Remembered-provider fast path: silently re-auth unless we arrived with an error
	// or an explicit picker request (`?picker=1`).
	onMount(() => {
		if (error) return;
		if (page.url.searchParams.get('picker') === '1') return;
		const remembered = getLastProvider();
		if (remembered) goto(providerHref(remembered, 'reauth'));
	});
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-ink">
	<h1 class="font-display text-2xl">Sign in to mvox</h1>

	{#if error}
		<p class="text-sm text-red-700" role="alert">
			{#if error === 'csrf_mismatch'}Your sign-in link expired or was invalid. Please try again.
			{:else if error === 'missing_session_token'}Sign-in did not complete. Please try again.
			{:else if error === 'session_expired'}{m.session_expired_message()}
			{:else}Something went wrong. Please try again.{/if}
		</p>
	{/if}

	<div class="flex w-full max-w-xs flex-col gap-2">
		{#each AUTH_PROVIDERS as provider (provider.id)}
			<a
				href={providerHref(provider.id, provider.id === lastProvider ? 'reauth' : 'login')}
				data-testid={`provider-${provider.id}`}
				class="rounded-md border border-ink px-4 py-2 text-center text-sm hover:bg-ink hover:text-paper"
			>
				{provider.label}{#if provider.id === lastProvider}&nbsp;· last used{/if}
			</a>
		{/each}
	</div>
</main>
