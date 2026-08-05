<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { hydrateAuth } from '$lib/auth/session';

	let { children } = $props();

	// Publish app-wide auth state from the localStorage JWT once the browser mounts.
	onMount(() => {
		hydrateAuth();
	});
</script>

{@render children?.()}
