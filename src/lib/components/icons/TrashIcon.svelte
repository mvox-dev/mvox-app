<script lang="ts">
	// Inline SVG on currentColor so text-danger tints it; emoji glyphs ignore CSS color.
	// Decorative always: the accessible name belongs to the wrapping control.
	let { class: className = undefined }: { class?: string | undefined } = $props();
</script>

<svg
	data-icon="trash"
	aria-hidden="true"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
>
	<path d="M4 7h16" />
	<path d="M9 7V4h6v3" />
	<path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
	<path d="M10 11v6" />
	<path d="M14 11v6" />
</svg>
