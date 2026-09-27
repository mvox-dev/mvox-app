<script lang="ts">
	// #394 review F5 — the undo control's face. Inline SVG on `currentColor`,
	// same rule as TrashIcon (#238): an emoji glyph would ignore the ink
	// utilities and render off-palette.
	//
	// Decorative ALWAYS (aria-hidden): the accessible name belongs to the
	// wrapping control (the undo button's aria-label), never to the icon.
	let { class: className = undefined }: { class?: string | undefined } = $props();
</script>

<svg
	data-icon="undo"
	aria-hidden="true"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
>
	<path d="M9 14 4 9l5-5" />
	<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
</svg>
