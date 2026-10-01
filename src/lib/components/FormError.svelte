<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		class: className = '',
		children,
		...rest
	}: HTMLAttributes<HTMLParagraphElement> & { class?: string; children: Snippet } = $props();
</script>

<p role="alert" class={[className, 'text-xs text-red-700']} {...rest}>{@render children()}</p>
