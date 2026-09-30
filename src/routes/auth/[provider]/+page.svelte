<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { createNonce } from '$lib/auth/state';
	import { safeRedirectTarget } from '$lib/auth/redirect';
	import { parseInviteToken } from '$lib/invite/parse-invite-token';
	import { buildOAuthInitUrl } from './build-oauth-init-url';
	import { m } from '$lib/paraglide/messages.js';

	// A localStorage write failure (private mode, quota) must not strand the redirecting
	// notice, so any throw falls back to the login screen with an error.
	onMount(() => {
		try {
			const provider = page.params.provider ?? '';
			const returnTo = safeRedirectTarget(page.url.searchParams.get('return_to'));
			const intentParam = page.url.searchParams.get('intent');
			const intent: 'login' | 'reauth' | 'invite' =
				intentParam === 'reauth' ? 'reauth' : intentParam === 'invite' ? 'invite' : 'login';

			// T4.5 (#31): invite intent carries the invite token via an explicit
			// `?invite=` param. Never launch OAuth with a garbage token — a client-
			// clock-expired one may proceed (the server is the authority on expiry).
			let invite: { db: string; token: string } | undefined;
			if (intent === 'invite') {
				const inviteToken = page.url.searchParams.get('invite');
				const parsed = parseInviteToken(inviteToken, Date.now());
				if (!inviteToken || parsed.status === 'invalid') {
					goto('/auth/login?error=oauth_init_failed');
					return;
				}
				invite = { db: parsed.db, token: inviteToken };
			}

			const url = buildOAuthInitUrl({
				provider,
				origin: window.location.origin,
				returnTo,
				intent,
				nonce: createNonce(),
				invite,
			});

			window.location.href = url;
		} catch {
			goto('/auth/login?error=oauth_init_failed');
		}
	});
</script>

<main class="flex min-h-screen items-center justify-center bg-paper text-ink">
	<p class="font-sans text-sm text-ink">{m.auth_redirecting()}</p>
</main>
