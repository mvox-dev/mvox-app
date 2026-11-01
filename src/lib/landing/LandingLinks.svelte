<!-- The collective's links, as chips. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { LinkRow } from '$lib/links/linkData';

	let { links }: { links: LinkRow[] } = $props();
</script>

<section data-testid="landing-links" class="flex flex-col gap-2" aria-labelledby="landing-links-heading">
	<h2 id="landing-links-heading" class="font-display text-lg text-ink-2">{m.landing_links_heading()}</h2>
	<ul class="flex flex-wrap gap-2">
		{#each links as link (link.id)}
			<li>
				<a
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					class="block rounded-full border border-ink-4 px-3 py-1 text-sm text-ink hover:bg-ink hover:text-paper"
					>{link.name}</a
				>
			</li>
		{/each}
	</ul>
</section>
