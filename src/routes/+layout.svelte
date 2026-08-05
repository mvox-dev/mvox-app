<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { hydrateAuth } from '$lib/auth/session';
	import { hydrateCollectives, urlCollectiveDbStore, COLLECTIVE_URL_PARAM } from '$lib/collectives/store';

	let { children } = $props();

	// Keep the URL-derived collective selection in sync with the address bar so a
	// deep link like `?collective=<db>` wins in the selection precedence.
	$effect(() => {
		urlCollectiveDbStore.set(page.url.searchParams.get(COLLECTIVE_URL_PARAM));
	});

	// Publish auth from the localStorage JWT, then discover the user's mvox
	// collectives from the token (marker-filtered) once mounted in the browser.
	onMount(async () => {
		hydrateAuth();
		await hydrateCollectives();
	});
</script>

{@render children?.()}
