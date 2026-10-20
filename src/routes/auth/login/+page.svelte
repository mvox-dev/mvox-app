<script lang="ts">
	import { page } from '$app/state';
	import { canPersistLocally, getLastProvider } from '$lib/auth/storage';
	import { safeRedirectTarget } from '$lib/auth/redirect';
	import { AUTH_PROVIDERS } from '$lib/auth/providers';
	// Every sign-in string resolves through Paraglide; `session_expired` rides
	// `m.session_expired_message`, the copy shared with the guard's own notice.
	import { m } from '$lib/paraglide/messages.js';

	const error = $derived(page.url.searchParams.get('error'));
	// The guard redirects here with `?redirect=<path>`; fall back to `return_to`.
	const returnTo = $derived(
		safeRedirectTarget(
			page.url.searchParams.get('redirect') ?? page.url.searchParams.get('return_to')
		)
	);
	const lastProvider = $state(typeof window !== 'undefined' ? getLastProvider() : null);
	// Storage self-test: true (no warning) without a window, checked on mount otherwise.
	const canPersist = $state(typeof window !== 'undefined' ? canPersistLocally() : true);

	function providerHref(id: string, intent: 'login' | 'reauth'): string {
		return `/auth/${id}?return_to=${encodeURIComponent(returnTo)}&intent=${intent}`;
	}
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-ink">
	<h1 class="font-display text-2xl">{m.login_heading()}</h1>

	{#if error}
		<p class="text-sm text-danger" role="alert">
			{#if error === 'csrf_mismatch'}{m.login_error_csrf_mismatch()}
			{:else if error === 'missing_session_token'}{m.login_error_missing_session_token()}
			{:else if error === 'session_expired'}{m.session_expired_message()}
			{:else}{m.login_error_generic()}{/if}
		</p>
	{/if}

	{#if !canPersist}
		<p class="text-sm text-danger" role="alert" data-testid="login-storage-warning">
			{m.login_storage_warning()}
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
