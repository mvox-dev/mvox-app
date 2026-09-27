<!-- src/lib/components/EntuRef.svelte -->
<!--
	#487 GREEN — the app's ONE shared clickable reference to an Entu entity.
	Renders ONLY the last 6 characters of the entity's `_id` (shortEntuId) —
	no name, no email, nothing else identifying — so a screen capture of the
	surrounding message leaks nothing. The FULL id lives in the link's `href`
	and `title` only.

	Dual mode, mirroring InviteSurface.svelte's controlled/standalone split:
	an explicit `db` prop wins; otherwise the component reads the signed-in
	db off `selectedDbStore` (src/lib/collectives/store.ts). When NEITHER
	yields a db, it renders a plain `<span>` (short id + full-id title, no
	href, no link role) rather than guess a database or link to the wrong
	one.

	Link shape (Mihkel, #487): https://entu.app/{db}/{_id} — matches Entu's
	own webapp entity-view route ([account]/[entityId]).

	No Entu API call, no rights read. No caller in this slice — wiring into
	roster_record_damaged / roster_member_deactivate_failed is #388.

	Contract: src/lib/components/EntuRef.spec.ts.
-->
<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { m } from '$lib/paraglide/messages.js';
	import { selectedDbStore } from '$lib/collectives/store';
	import { shortEntuId } from '$lib/entu/shortId';

	let {
		id,
		db,
		...rest
	}: {
		id: string;
		db?: string;
	} & HTMLAttributes<HTMLAnchorElement | HTMLSpanElement> = $props();

	const short = $derived(shortEntuId(id));
	const resolvedDb = $derived(db ?? $selectedDbStore ?? null);
	const href = $derived(resolvedDb ? `https://entu.app/${resolvedDb}/${id}` : null);
</script>

{#if href}
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		title={id}
		aria-label={m.entu_ref_aria_label({ short })}
		class="font-mono text-xs text-ink underline"
		{...rest}
	>
		{short}
	</a>
{:else}
	<span title={id} class="font-mono text-xs" {...rest}>
		{short}
	</span>
{/if}

<!-- (*MVOX:Josquin* — #487 GREEN) -->
