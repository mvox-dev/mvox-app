<script lang="ts">
	interface Props {
		testid: string;
		text: string;
		class: string;
	}

	const { testid, text, class: className }: Props = $props();
</script>

<p
	data-testid={testid}
	role="status"
	class="rounded-md border border-dashed border-ink-4 p-2 text-ink-2 {className}"
>
	{text}
</p>
