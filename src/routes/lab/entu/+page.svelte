<!-- /lab/entu: experimental Entu sign-in and add-passkey links; the login screen is separate. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { authStore } from '$lib/auth/session';
	import { selectedDbStore } from '$lib/collectives/store';
	import { entuAddPasskeyHref, entuSignInHref, rememberSignInStarted } from './entu-sign-in';

	const signInHref = $derived(entuSignInHref(window.location.origin, getLocale()));
	const passkeyDb = $derived($authStore.status === 'authenticated' ? $selectedDbStore : null);
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<h1 class="font-display text-2xl">{m.lab_entu_heading()}</h1>
	<div class="mt-6 flex max-w-xs flex-col gap-2">
		<a
			href={signInHref}
			onclick={rememberSignInStarted}
			data-testid="lab-entu-sign-in"
			class="rounded-md border border-ink px-4 py-2 text-center text-sm hover:bg-ink hover:text-paper"
		>
			{m.lab_entu_sign_in()}
		</a>
		{#if passkeyDb}
			<a
				href={entuAddPasskeyHref(passkeyDb)}
				data-testid="lab-entu-add-passkey"
				class="rounded-md border border-ink px-4 py-2 text-center text-sm hover:bg-ink hover:text-paper"
			>
				{m.lab_entu_add_passkey()}
			</a>
		{/if}
	</div>
</main>
