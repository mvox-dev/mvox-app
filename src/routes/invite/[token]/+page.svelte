<script lang="ts">
	// T4.5 (#31) — the unauthed invite landing (allowlisted at src/lib/auth/
	// guard.ts:43; the bare /invite without a token stays protected). The token is a
	// BEARER SECRET: never logged, never written to storage by this page — it only
	// moves into hrefs built by buildInviteProviderHref, riding the localStorage
	// OAuth-state blob (single-use-consumed at the callback), never oauth.ee.
	//
	// States: ?outcome= (post-exchange, takes precedence) → dead / conflict /
	// unexpected / error; otherwise fresh parse → valid / invalid / client-expired.
	// A client-clock "expired" KEEPS the CTAs — the server is the authority; truly
	// dead invites come back as outcome=dead.
	// Contract: src/routes/page.invite-landing.spec.ts.
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { AUTH_PROVIDERS } from '$lib/auth/providers';
	import { OAUTH_STATE_KEY } from '$lib/auth/state';
	import { buildInviteProviderHref } from '$lib/invite/invite-links';
	import { parseInviteToken } from '$lib/invite/parse-invite-token';

	// Stale-blob hygiene: an ABANDONED OAuth initiation (CTA clicked, provider
	// never completed) leaves the state blob — for invite intent including the
	// up-to-7-day bearer token — in localStorage, where the callback's single-use
	// consume never reaches it. Any blob present when this landing renders is by
	// definition stale: a completed flow was already consumed at the callback
	// before redirecting back here, and a fresh CTA click writes a fresh blob.
	// Clearing it caps the bearer token's storage lifetime on shared machines.
	localStorage.removeItem(OAUTH_STATE_KEY);

	const token = $derived(page.params.token ?? '');
	const outcome = $derived(page.url.searchParams.get('outcome'));
	const parsed = $derived(parseInviteToken(token, Date.now()));
	// #207 rule 7 (PO standing rule, Gama's 2026-09-02 rulings) — numeric date
	// text renders as the ISO calendar date, `YYYY-MM-DD` (en-CA gives ISO date
	// format), never a browser-locale rendering.
	const expiryDateFmt = new Intl.DateTimeFormat('en-CA', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const expiryDate = $derived(
		parsed.status === 'invalid' ? '' : expiryDateFmt.format(new Date(parsed.expMs))
	);
	/** Fresh-start href: the same landing without ?outcome — a new CTA click mints a fresh single-use session key. */
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
				<p class="text-sm text-red-700" role="alert">
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
						{provider.label}
					</a>
				{/each}
			</div>
		</section>
	{/if}
</main>


