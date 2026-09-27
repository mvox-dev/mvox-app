<script lang="ts">
	// #394 review F5 — the eraser toggle's face. Inline SVG drawn with
	// `currentColor` for the same reason TrashIcon (#238) is one: a colour-emoji
	// glyph carries its own baked palette and ignores the CSS `color` property,
	// so a control styled with the ink utilities would render off-palette.
	//
	// Decorative ALWAYS (aria-hidden): the accessible name belongs to the
	// wrapping control (the erase button's aria-label), never to the icon.
	let { class: className = undefined }: { class?: string | undefined } = $props();
</script>

<svg
	data-icon="eraser"
	aria-hidden="true"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
>
	<path d="M7 21 2.7 16.7a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21" />
	<path d="M22 21H7" />
	<path d="m5 11 9 9" />
</svg>
