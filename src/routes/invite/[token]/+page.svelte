<script lang="ts">
	// Unauthed invite landing. The token is a bearer secret: never logged or stored by this page.
	// ?outcome= takes precedence over the fresh parse; a client-clock expiry keeps the CTAs.
	// Contract: src/routes/page.invite-landing.spec.ts.
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { AUTH_PROVIDERS } from '$lib/auth/providers';
	import { OAUTH_STATE_KEY } from '$lib/auth/state';
	import { buildInviteProviderHref } from '$lib/invite/invite-links';
	import { parseInviteToken } from '$lib/invite/parse-invite-token';
	import { isoDateFormatter } from '$lib/preferences/timeFormat';

	// An abandoned OAuth start leaves a state blob holding the bearer token; any blob here is stale,
	// so clear it to cap the token's storage lifetime.
	localStorage.removeItem(OAUTH_STATE_KEY);

	const token = $derived(page.params.token ?? '');
	const outcome = $derived(page.url.searchParams.get('outcome'));
	const parsed = $derived(parseInviteToken(token, Date.now()));
	// Numeric dates render as ISO `YYYY-MM-DD` (en-CA), never browser-locale (#207 rule 7).
	const expiryDateFmt = isoDateFormatter();
	const expiryDate = $derived(
		parsed.status === 'invalid' ? '' : expiryDateFmt.format(new Date(parsed.expMs))
	);
	/** Same landing without ?outcome: a new CTA click mints a fresh single-use session key. */
	const retryHref = $derived(`/invite/${encodeURIComponent(token)}`);
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-ink">
	{#if outcome === 'dead'}
		<section data-testid="invite-landing-dead" class="flex max-w-md flex-col gap-2 text-center">
			<h1 class="font-display text-2xl">{m.invite_landing_title()}</h1>
			<p class="text-sm" role="alert">{m.invite_error_dead()}</p>
		</section>
	{:else if outcome === 'conflict'}
		<section data-testid="invite-landing-conflict" class="flex max-w-md flex-col gap-2 text-center">
			<h1 class="font-display text-2xl">{m.invite_landing_title()}</h1>
			<p class="text-sm" role="alert">{m.invite_error_conflict()}</p>
			<a
				href="/"
				class="mx-auto rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
			>
				{m.invite_error_conflict_continue()}
			</a>
		</section>
	{:else if outcome === 'unexpected'}
		<section data-testid="invite-landing-unexpected" class="flex max-w-md flex-col gap-2 text-center">
			<h1 class="font-display text-2xl">{m.invite_landing_title()}</h1>
			<p class="text-sm" role="alert">{m.invite_error_unexpected()}</p>
		</section>
	{:else if outcome === 'error'}
		<section data-testid="invite-landing-error" class="flex max-w-md flex-col gap-2 text-center">
			<h1 class="font-display text-2xl">{m.invite_landing_title()}</h1>
			<p class="text-sm" role="alert">{m.invite_error_failed()}</p>
			<a
				href={retryHref}
				data-testid="invite-retry"
				class="mx-auto rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
			>
				{m.invite_retry()}
			</a>
		</section>
	{:else if parsed.status === 'invalid'}
		<section data-testid="invite-landing-invalid" class="flex max-w-md flex-col gap-2 text-center">
			<h1 class="font-display text-2xl">{m.invite_landing_title()}</h1>
			<p class="text-sm" role="alert">{m.invite_error_invalid()}</p>
		</section>
	{:else}
		<section
			data-testid={parsed.status === 'expired' ? 'invite-landing-expired' : 'invite-landing-valid'}
			class="flex max-w-md flex-col gap-2 text-center"
		>
			<h1 class="font-display text-2xl">{m.invite_landing_title()}</h1>
			<p class="text-sm">{m.invite_landing_intro({ db: parsed.db })}</p>
			<p class="text-sm">{m.invite_landing_expires({ date: expiryDate })}</p>
			{#if parsed.status === 'expired'}
				<p class="text-sm text-danger" role="alert">
					{m.invite_landing_expired_warning({ date: expiryDate })}
				</p>
			{/if}
			<p class="mt-2 text-sm">{m.invite_landing_choose_provider()}</p>
			<div class="mx-auto flex w-full max-w-xs flex-col gap-2">
				{#each AUTH_PROVIDERS as provider (provider.id)}
					<a
						href={buildInviteProviderHref(provider.id, token)}
						data-testid={`invite-cta-${provider.id}`}
						class="rounded-md border border-ink px-4 py-2 text-center text-sm hover:bg-ink hover:text-paper"
					>
						{provider.label()}
					</a>
				{/each}
			</div>
		</section>
	{/if}
</main>


