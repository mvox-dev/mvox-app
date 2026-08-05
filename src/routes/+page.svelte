<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<main class="flex min-h-screen items-center justify-center bg-paper text-ink">
	<p class="font-display text-2xl">{m.placeholder_greeting({ name: m.app_name() })}</p>
</main>
