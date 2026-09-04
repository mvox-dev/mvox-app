<script lang="ts">
	// #238 — the app's FIRST reusable inline-SVG icon component, and the #237
	// trial instance (one definition here; the #237 sweep spends it).
	//
	// WHY: emoji glyphs (🗑, ⚙, …) resolve to the platform's colour-emoji font,
	// whose glyphs carry a baked-in palette and IGNORE the CSS `color`
	// property — so #236's "red trashcan" shipped grey on real screens. An
	// inline SVG drawn with `currentColor` inherits the parent's text colour,
	// so the existing text-red-700/hover:text-red-800 utilities finally tint
	// it — no new palette entry, no per-site colour authoring.
	//
	// Decorative ALWAYS (aria-hidden): the accessible name belongs to the
	// wrapping control (the trashcan button's aria-label), never to the icon.
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
