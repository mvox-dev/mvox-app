<!-- /admin: the collective's admin section lives at the end of /profile now (#916). -->
<script lang="ts">
	import { goto } from '$app/navigation';

	$effect(() => {
		void goto('/profile#collective', { replaceState: true });
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink"></main>
