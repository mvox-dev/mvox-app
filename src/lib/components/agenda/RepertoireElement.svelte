<!-- src/lib/components/agenda/RepertoireElement.svelte -->
<!--
	#90 TR.2 — the collapsed/expanded "Works" element on an agenda event row.
	Prop-driven and fetch-free (same unit-level seam as AgendaList/RsvpControl:
	the page resolves data via loadWorksByEventId, this component only renders
	the already-resolved view model).

	Collapsed: a single tappable line — ♫ + work names joined by ' · '. Absent
	entirely when `rows` is empty (never an empty "Works" placeholder).

	Expanded: one row per work — name + composer, status badge (raw status
	string, no translation: 'active'/'learning' are the ONLY two values a
	repertoire fallback ever surfaces here, retired/dropped are filtered
	upstream — see repertoireData.ts's resolveEventWorks), pinned edition (or a
	work-no-edition placeholder), program notes when present, and the functional
	links: PDF, Borrow (static /library link, present only when copies exist),
	and one link per external_link value (text = the link's domain; the producer
	buildWorkRows has already dropped any non-http(s) value, so these hrefs are
	safe to bind).

	The PDF link is a BUTTON, not an anchor with an href. Entu's signed S3
	download url lives 60 seconds (entu-www src/api/files/index.md), so it
	cannot be resolved at agenda load and parked in an href — it would be long
	dead by the time a member expands a row and taps. The row carries the file
	PROPERTY id instead, and `onpdfclick(fileId)` lets the page sign it at click
	time (repertoire/fileUrls.ts). Entu's `?download=true` shortcut is not an
	option either: entuFetch is browser-direct with a Bearer header, and a plain
	<a> navigation carries no Authorization header.

	Concert ordering: when every row carries an ordinal (a programmed concert),
	renders numbered (ol/li) in ordinal order. When ordinals are absent (the
	season-repertoire fallback, which carries no concert position), renders
	unordered, in the given row order.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { WorkRow } from '$lib/repertoire/types';

	interface Props {
		rows: WorkRow[];
		/** Sign + open this edition file NOW (see the header note on the 60s url). */
		onpdfclick?: (fileId: string) => void;
	}
	const { rows, onpdfclick }: Props = $props();

	let expanded = $state(false);

	// SSR/client-stable per-instance id, same pattern as SeasonSummary — the
	// collapsed toggle points aria-controls at the expanded region.
	const componentId = $props.id();
	const expandedRegionId = `works-expanded-${componentId}`;

	const collapsedLine = $derived(rows.map((r) => r.workName).join(' · '));

	const hasOrdinals = $derived(rows.length > 0 && rows.every((r) => r.ordinal !== null));
	// Only meaningful (and only sorted) when hasOrdinals — the unordered branch
	// renders `rows` as given (season repertoire carries no concert position to
	// sort by). Ties keep source order (Array.prototype.sort is stable), so two
	// program_items that both defaulted to ordinal 0 still render in read order.
	const orderedRows = $derived(
		hasOrdinals ? [...rows].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)) : rows
	);

	function domainOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
</script>

{#snippet workRowContent(row: WorkRow)}
	<span data-testid="work-name" class="text-sm text-ink">{row.workName}</span>
	<span data-testid="work-composer" class="text-xs text-ink-2">{row.composer}</span>
	{#if row.status !== null}
		<span
			data-testid="work-status-badge"
			class="w-fit rounded-full border border-ink-4 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-2 uppercase"
		>
			{row.status}
		</span>
	{/if}
	{#if row.editionName !== ''}
		<span data-testid="work-edition" class="text-xs text-ink-2">{row.editionName}</span>
	{:else}
		<span data-testid="work-no-edition" class="text-xs text-ink-3 italic">{m.repertoire_no_edition()}</span>
	{/if}
	{#if row.notes !== ''}
		<span data-testid="work-notes" class="text-xs text-ink-2 italic">{row.notes}</span>
	{/if}
	<span class="flex flex-wrap gap-2">
		{#if row.fileId !== ''}
			<button
				type="button"
				data-testid="work-link-pdf"
				class="text-xs text-ink underline"
				onclick={() => onpdfclick?.(row.fileId)}
			>
				{m.repertoire_pdf_link()}
			</button>
		{/if}
		{#if row.canBorrow}
			<a data-testid="work-link-borrow" href="/library" class="text-xs text-ink underline">
				{m.repertoire_borrow_link()}
			</a>
		{/if}
		<!-- Deliberately UNKEYED: `external_link` is an implicitly multi-valued
		     Entu string prop (POST appends), so an edition can legitimately hold
		     the same url twice. Keying on the url would throw each_key_duplicate
		     and take down the page — same failure mode the ordinal note below
		     guards against. These anchors carry no per-item state, so a key buys
		     nothing here. Hrefs are pre-filtered to http(s) by buildWorkRows. -->
		{#each row.externalLinks as link}
			<a
				data-testid="work-link-external"
				href={link}
				target="_blank"
				rel="noopener noreferrer"
				class="text-xs text-ink underline"
			>
				{domainOf(link)}
			</a>
		{/each}
	</span>
{/snippet}

{#if rows.length > 0}
	<button
		type="button"
		data-testid="works-line"
		class="flex items-baseline gap-1.5 truncate text-left text-xs text-ink-2"
		aria-expanded={expanded}
		aria-controls={expandedRegionId}
		onclick={() => (expanded = !expanded)}
	>
		<span aria-hidden="true">♫</span>
		<span class="truncate">{collapsedLine}</span>
	</button>
	{#if expanded}
		<div id={expandedRegionId} data-testid="works-expanded" class="flex flex-col gap-2 pt-1 pl-4">
			{#if hasOrdinals}
				<ol class="flex list-decimal flex-col gap-2 pl-4">
					<!-- Keyed on the entity id, NEVER on ordinal: `mandatory: true` is a
					     soft UI hint in Entu, so two program_items can both carry the
					     default 0 — a duplicate key throws each_key_duplicate and takes
					     down the whole agenda page, not just this element. -->
					{#each orderedRows as row (row.id)}
						<li data-testid="work-row" class="flex flex-col gap-0.5">
							{@render workRowContent(row)}
						</li>
					{/each}
				</ol>
			{:else}
				<div class="flex flex-col gap-2">
					{#each orderedRows as row (row.id)}
						<div data-testid="work-row" class="flex flex-col gap-0.5">
							{@render workRowContent(row)}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/if}
