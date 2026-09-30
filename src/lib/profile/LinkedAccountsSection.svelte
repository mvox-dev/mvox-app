<!-- #193 — linked auth providers + "Link another account". Always mounted, so the
	return-link verdict read once from the URL outlives reloads; the page calls load() and
	reset() through bind:this. -->
<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { isAuthExpiredError } from '$lib/entu/request';
	import { listLinkedIdentities, type LinkedIdentity } from '$lib/profile/linkedIdentities';
	import { AUTH_PROVIDERS, providerLabel } from '$lib/auth/providers';
	import { createNonce } from '$lib/auth/state';
	import { buildOAuthInitUrl } from '../../routes/auth/[provider]/build-oauth-init-url';
	import type * as InviteData from '$lib/invite/inviteData';

	type Cfg = { db: string; token: string };

	interface Props {
		ready: boolean;
		isOffline: boolean;
		scopeName: string;
		generation: () => number;
		activeContext: () => { cfg: Cfg; personId: string } | null;
		onSessionExpired: () => void;
		mintSelfLinkInvite: typeof InviteData.mintSelfLinkInvite;
		mintErrorMessage: (e: unknown) => string;
	}

	let {
		ready,
		isOffline,
		scopeName,
		generation,
		activeContext,
		onSessionExpired,
		mintSelfLinkInvite,
		mintErrorMessage
	}: Props = $props();

	const IDENTITY_READ_STEP = 'identity-read';

	let linkedIdentities = $state<LinkedIdentity[]>([]);
	let linkPickerOpen = $state(false);
	let linkBusy = $state(false);
	let linkError = $state<string | null>(null);
	// An unknown identity list is not a known-empty one: every user has at least one.
	let linkedLoadFailed = $state(false);

	// The picker replaces the CTA, so focus is handed over explicitly both ways.
	let linkAnotherEl = $state<HTMLButtonElement | null>(null);
	let linkPickerEl = $state<HTMLDivElement | null>(null);

	// run-link-callback.ts lands back here with ?link_error=<code>, ?linked=1 or
	// ?link_noop=<code>. The code is user-controlled input, so only a closed list is shown.
	function returnLinkErrorMessage(code: string): string {
		switch (code) {
			case 'conflict':
				return m.profile_link_error_conflict();
			case 'dead':
				return m.profile_link_error_dead();
			case 'failed':
				return m.profile_link_error_failed();
			case 'already_linked':
				return m.profile_link_error_already_linked();
			case 'unexpected':
			case 'invalid':
			case 'persist_failed':
				return m.profile_link_error_step({ step: code });
			default:
				return m.profile_link_error_failed();
		}
	}

	// Not an error: the user did nothing wrong, so it renders as a neutral status.
	function returnLinkNoopMessage(code: string): string | null {
		switch (code) {
			case 'same_identity':
				return m.profile_link_noop_same_identity();
			default:
				return null;
		}
	}

	// Read once at init: the verdict belongs to the navigation that mounted the page.
	const returnLinkErrorCode = page.url.searchParams.get('link_error');
	let returnLinkError = $state<string | null>(
		returnLinkErrorCode ? returnLinkErrorMessage(returnLinkErrorCode) : null
	);
	let linkSucceeded = $state(!returnLinkErrorCode && page.url.searchParams.get('linked') === '1');
	const returnLinkNoopCode = page.url.searchParams.get('link_noop');
	let linkNoop = $state<string | null>(
		!returnLinkErrorCode && returnLinkNoopCode ? returnLinkNoopMessage(returnLinkNoopCode) : null
	);

	const shownLinkError = $derived(linkError ?? returnLinkError);

	// One row per uid+provider: a same-identity re-link can leave two entries.
	const dedupedLinkedIdentities = $derived.by(() => {
		const seen = new Set<string>();
		const out: LinkedIdentity[] = [];
		for (const identity of linkedIdentities) {
			const key = `${identity.uid} ${identity.provider}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(identity);
		}
		return out;
	});

	export function reset(): void {
		linkedIdentities = [];
		linkedLoadFailed = false;
		linkPickerOpen = false;
		linkBusy = false;
		linkError = null;
	}

	// Never rejects: a failure is the rendered `linkedLoadFailed` state, except an
	// expired session, which is a different failure class (#107).
	export async function load(cfg: Cfg, personId: string, g: number): Promise<void> {
		try {
			const linked = await listLinkedIdentities(cfg, personId);
			if (g !== generation()) return;
			linkedIdentities = linked.identities;
			linkedLoadFailed = false;
		} catch (linkedErr) {
			if (g !== generation()) return;
			if (isAuthExpiredError(linkedErr)) {
				onSessionExpired();
				return;
			}
			console.error('profile: linked identities load failed', linkedErr);
			linkedIdentities = [];
			linkedLoadFailed = true;
		}
	}

	function retryLinkedIdentities(): void {
		const ctx = activeContext();
		if (!ctx) return;
		void load(ctx.cfg, ctx.personId, generation());
	}

	// No mint until a provider is picked: the token is a live 24h bearer credential.
	async function openLinkPicker(): Promise<void> {
		linkPickerOpen = true;
		linkError = null;
		returnLinkError = null;
		linkSucceeded = false;
		linkNoop = null;
		await tick();
		linkPickerEl
			?.querySelector<HTMLButtonElement>('[data-testid^="profile-link-provider-"]:not([disabled])')
			?.focus();
	}

	async function closeLinkPicker(): Promise<void> {
		linkPickerOpen = false;
		linkError = null;
		await tick();
		linkAnotherEl?.focus();
	}

	// Mint a self-invite at click time, then start the OAuth round trip with intent 'link'.
	// The token rides the localStorage OAuth-state blob only, never a URL.
	async function handleLinkProvider(providerId: string): Promise<void> {
		if (isOffline) return;
		// The callback's same-identity check needs a snapshot; an unknown set has none.
		if (linkedLoadFailed) {
			linkError = m.profile_link_error_step({ step: IDENTITY_READ_STEP });
			return;
		}
		const ctx = activeContext();
		if (!ctx) return;
		linkBusy = true;
		linkError = null;
		returnLinkError = null;
		linkSucceeded = false;
		linkNoop = null;
		try {
			const { inviteToken } = await mintSelfLinkInvite(ctx.cfg, ctx.personId);
			const url = buildOAuthInitUrl({
				provider: providerId,
				origin: page.url.origin,
				returnTo: '/profile?linked=1',
				intent: 'link',
				nonce: createNonce(),
				invite: { db: ctx.cfg.db, token: inviteToken },
				linkPersonId: ctx.personId,
				linkedSnapshot: linkedIdentities.map(({ _id, uid, provider }) => ({
					_id,
					uid,
					provider
				}))
			});
			window.location.href = url;
		} catch (e) {
			console.error('profile: self-link mint failed', e);
			linkBusy = false;
			linkError = mintErrorMessage(e);
		}
	}
</script>

<!-- Linking is per collective (the mint runs on the selected collective's person), so the
	heading and success line name it. -->
{#if ready}
	<section
		data-testid="profile-linked-accounts"
		class="flex flex-col gap-2 border-t border-ink/10 pt-4"
	>
		<h2 class="text-sm font-semibold">
			{m.profile_linked_accounts_title({ collective: scopeName })}
		</h2>
		{#if dedupedLinkedIdentities.length > 0}
			<ul class="flex flex-col gap-1">
				{#each dedupedLinkedIdentities as identity (identity._id)}
					<li data-testid={`profile-linked-identity-${identity._id}`} class="text-sm text-ink-2">
						{providerLabel(identity.provider)}{#if identity.email}
							&nbsp;— {identity.email}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if linkedLoadFailed}
			<div
				data-testid="profile-linked-load-error"
				role="alert"
				class="flex flex-col items-start gap-2"
			>
				<p class="text-sm text-red-700">
					{m.profile_link_error_step({ step: IDENTITY_READ_STEP })}
				</p>
				<button
					type="button"
					data-testid="profile-linked-retry"
					class="rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={retryLinkedIdentities}
				>
					{m.profile_load_retry()}
				</button>
			</div>
		{/if}

		{#if !linkPickerOpen}
			<button
				type="button"
				data-testid="profile-link-another"
				bind:this={linkAnotherEl}
				class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
				disabled={linkedLoadFailed || isOffline}
				onclick={openLinkPicker}
			>
				{m.profile_link_another()}
			</button>
		{:else}
			<p class="text-sm text-ink-2">{m.profile_link_choose_provider()}</p>
			<div class="flex flex-col gap-2" bind:this={linkPickerEl}>
				{#each AUTH_PROVIDERS as provider (provider.id)}
					<button
						type="button"
						data-testid={`profile-link-provider-${provider.id}`}
						class="rounded-md border border-ink px-4 py-2 text-left text-sm hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
						disabled={linkBusy || linkedLoadFailed || isOffline}
						aria-busy={linkBusy}
						onclick={() => handleLinkProvider(provider.id)}
					>
						{provider.label()}
					</button>
				{/each}
				<button
					type="button"
					data-testid="profile-link-cancel"
					class="self-start rounded-md border border-ink/40 px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={closeLinkPicker}
				>
					{m.profile_link_cancel()}
				</button>
			</div>
		{/if}

		{#if shownLinkError}
			<p data-testid="profile-link-error" role="alert" class="text-sm text-red-700">
				{shownLinkError}
			</p>
		{:else if linkSucceeded}
			<p data-testid="profile-link-success" role="status" class="text-sm text-ink-2">
				{m.profile_link_success({ collective: scopeName })}
			</p>
		{:else if linkNoop}
			<p data-testid="profile-link-noop" role="status" class="text-sm text-ink-2">
				{linkNoop}
			</p>
		{/if}
	</section>
{/if}
