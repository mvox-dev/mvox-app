<script lang="ts">
	const { show }: { show: boolean } = $props();
</script>

{#if show}
	<span data-testid="agenda-row-created-mark" aria-hidden="true" class="sr-only"></span>
{/if}
