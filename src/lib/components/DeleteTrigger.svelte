<script lang="ts">
	// #237 — the app's ONE shared delete-trigger unit: native <button> + the
	// aria-hidden TrashIcon (#238) + the destructive red pair, with the 44px
	// touch minimum BY CONSTRUCTION (PO ruling, relayed via Henry 2026-09-07:
	// a consumer cannot instantiate this below 44px — `class` APPENDS, it
	// cannot strip the base list below).
	//
	// The unit is the trigger's FACE only. Each call site keeps its own
	// arm-state (seasonManageDeleteArmed / deleteArmed / pendingRemoveId are
	// heterogeneous on purpose — no arm-state moves in here) and its own
	// rest props: data-testid, aria-label, title, disabled, aria-busy,
	// onclick, onkeydown all spread through verbatim.
	//
	// `hover:text-red-800` lives in EXACTLY this file (trashcan-sweep.spec.ts
	// pins it repo-wide) — one colour change is one edit here, nowhere else.
	//
	// #237 review F2 — the DISABLED face is part of the unit, not of the call
	// site. Before the sweep each site carried its own `disabled:` variants in
	// the class string the unit replaced (roster's section-remove had
	// `disabled:cursor-default disabled:opacity-30 disabled:hover:text-ink-2`),
	// so migrating dropped the affordance: an ineligible trigger rendered at
	// full-saturation red and still lit on hover (CSS :hover matches disabled
	// buttons). Owning it here closes the hole for EVERY future consumer that
	// passes `disabled`. opacity-60 (not the old 30) matches the #252-corrected
	// arrange siblings on the roster's own row — #252 found 30 too faint to
	// read as a control at all.
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import TrashIcon from './icons/TrashIcon.svelte';

	let {
		class: className = '',
		iconClass = 'h-5 w-5',
		children,
		...rest
	}: HTMLButtonAttributes & {
		class?: string;
		iconClass?: string;
		children?: Snippet;
	} = $props();
</script>

<button
	type="button"
	class="flex min-h-11 min-w-11 items-center justify-center text-red-700 hover:text-red-800 disabled:cursor-default disabled:opacity-60 disabled:hover:text-red-700 {className}"
	{...rest}
>
	<TrashIcon class={iconClass} />
	{#if children}
		{@render children()}
	{/if}
</button>
