<!-- The profile page's app chrome: identity, sign-out, language, time format, install. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getUser, getLastProvider } from '$lib/auth/storage';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import LanguageSelector from '$lib/components/LanguageSelector.svelte';
	import { timeFormatStore, setTimeFormat, type TimeFormat } from '$lib/preferences/timeFormat';
	import { providerLabel } from '$lib/auth/providers';
	// #408 — a pure subscriber: the root layout starts the `beforeinstallprompt` adapter,
	// because Chromium fires that event once per page load, before this page mounts.
	import { installAffordance, promptInstall } from '$lib/install/installState';

	// #60 — which account and provider the user is signed in with; display only.
	const identityUser = getUser();
	const identityAccount = identityUser?.email || identityUser?.name || '';
	const identityProvider = providerLabel(getLastProvider());

	// #408 — the iOS Share-menu hint stays hidden until the button is pressed.
	let installIosHintShown = $state(false);

	function onInstallButtonClick(): void {
		if ($installAffordance === 'prompt') {
			// prompt() can reject once the banner was consumed; promptInstall has already
			// collapsed the affordance by then, so the button leaves rather than going inert.
			promptInstall().catch((err) => {
				console.error('profile: install prompt failed', err);
			});
		} else if ($installAffordance === 'ios-hint') {
			installIosHintShown = true;
		}
	}
</script>

<div class="flex flex-col items-start gap-1">
	{#if identityAccount}
		<!-- #361 — with no email the account is a real name, so the sentence is wrapped
		     whole in the marker. -->
		<p data-testid="profile-identity" class="text-sm text-ink-2">
			<RedactedText
				>{#if identityProvider}{m.profile_signed_in_as({
						account: identityAccount,
						provider: identityProvider
					})}{:else}{identityAccount}{/if}</RedactedText
			>
		</p>
	{/if}
	<a class="text-sm text-ink-2 underline" href="/auth/logout">{m.profile_sign_out()}</a>
</div>

<!-- #123, #207, #408 — app chrome, not gated on `status` or collective selection. -->
<div class="flex flex-col items-start gap-1">
	<span class="text-sm text-ink-2">{m.profile_language_label()}</span>
	<LanguageSelector />
</div>

<div class="flex flex-col items-start gap-1">
	<label for="profile-time-format" class="text-sm text-ink-2">
		{m.profile_time_format_label()}
	</label>
	<select
		id="profile-time-format"
		data-testid="profile-time-format"
		value={$timeFormatStore}
		onchange={(e) => setTimeFormat((e.currentTarget as HTMLSelectElement).value as TimeFormat)}
		class="border border-ink-5 bg-paper px-2 py-1 text-ink"
	>
		<option value="24h">{m.profile_time_format_24h()}</option>
		<option value="ampm">{m.profile_time_format_ampm()}</option>
	</select>
	<p data-testid="profile-time-format-hint" class="text-xs text-ink-3">
		{m.profile_time_format_hint()}
	</p>
</div>

{#if $installAffordance !== 'none'}
	<div class="flex flex-col items-start gap-1">
		<button
			type="button"
			data-testid="profile-install-button"
			class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
			onclick={onInstallButtonClick}
		>
			{m.profile_install_button()}
		</button>
		{#if $installAffordance === 'ios-hint' && installIosHintShown}
			<p data-testid="profile-install-ios-hint" class="text-xs text-ink-3">
				{m.profile_install_ios_hint()}
			</p>
		{/if}
	</div>
{/if}
