<script lang="ts">
	import { page } from '$app/state';
	import { getLastProvider } from '$lib/auth/storage';
	import { safeRedirectTarget } from '$lib/auth/redirect';
	// Provider list shared with the invite landing (T4.5) — extracted verbatim to
	// $lib/auth/providers.
	import { AUTH_PROVIDERS } from '$lib/auth/providers';
	// #218 — the whole sign-in surface resolves through Paraglide: the heading,
	// EVERY error branch, the '· last used' marker and the provider labels all
	// come from the four locale files. `session_expired` is the one branch that
	// does not use a `login_error_*` key: it rides `m.session_expired_message`
	// (#107 review F4) because that copy is the DURABLE surface shared with the
	// guard's own notice, so a second key would only invite drift.
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
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-ink">
	<h1 class="font-display text-2xl">{m.login_heading()}</h1>

	{#if error}
		<p class="text-sm text-red-700" role="alert">
			{#if error === 'csrf_mismatch'}{m.login_error_csrf_mismatch()}
			{:else if error === 'missing_session_token'}{m.login_error_missing_session_token()}
			{:else if error === 'session_expired'}{m.session_expired_message()}
			{:else}{m.login_error_generic()}{/if}
		</p>
	{/if}

	<div class="flex w-full max-w-xs flex-col gap-2">
		{#each AUTH_PROVIDERS as provider (provider.id)}
			<a
				href={providerHref(provider.id, provider.id === lastProvider ? 'reauth' : 'login')}
				data-testid={`provider-${provider.id}`}
				class="rounded-md border border-ink px-4 py-2 text-center text-sm hover:bg-ink hover:text-paper"
			>
				{provider.label()}{#if provider.id === lastProvider}&nbsp;{m.login_last_used()}{/if}
			</a>
		{/each}
	</div>
</main>
