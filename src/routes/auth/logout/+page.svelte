<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { performLogout } from './perform-logout';

	// Client-side logout: clear the localStorage token + reset auth state, then
	// hand off to /auth/login — the always-rendered picker there is the one true
	// signed-out surface (#206). No server cookie to clear (there is no server).
	//
	// `replaceState: true` (#206 review F1) — this route is a redirector, not a
	// destination. A pushed entry would leave /auth/logout on the history stack,
	// and pressing Back would remount this component, re-fire onMount and push
	// /auth/login again: the user could never step back past the sign-out to the
	// page they came from. Replacing our own entry lets Back unwind normally.
	onMount(() => {
		performLogout();
		goto('/auth/login', { replaceState: true });
	});
</script>
