<!-- One edition under an open work: its toggle, its copies (sorted by the page's one shared
	sort key) and its files. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Edition, Work } from '$lib/library/libraryData';
	import type { EditionFilesState, LibraryState, TreeActions } from '$lib/library/libraryState';
	import type { LendingView } from '$lib/library/lendingView';
	import { COPY_SORT_KEYS, sortCopies } from '$lib/library/copySort';
	import RadioChips from '$lib/components/RadioChips.svelte';
	import CopyRow from '$lib/library/CopyRow.svelte';
	import EditionFiles from '$lib/library/EditionFiles.svelte';

	interface Props {
		work: Work;
		edition: Edition;
		lib: LibraryState;
		files: EditionFilesState;
		view: LendingView;
		actions: TreeActions;
		isLibrarian: boolean;
		isOffline: boolean;
	}

	let { work, edition, lib, files, view, actions, isLibrarian, isOffline }: Props = $props();

	const COPY_SORT_LABEL = {
		nr: m.library_copy_sort_nr,
		member: m.library_copy_sort_member,
		since: m.library_copy_sort_since
	};

	const open = $derived(lib.expandedEditions.has(edition.id));
	const copies = $derived(lib.copiesByEdition.get(edition.id) ?? []);
</script>

<div data-testid="library-edition-{edition.id}" class="flex flex-col border-b border-dashed border-ink-5 py-1.5 last:border-b-0">
	<button
		type="button"
		data-testid="library-edition-toggle-{edition.id}"
		class="flex items-center justify-between text-left"
		aria-expanded={open}
		aria-controls={open ? `library-copies-${edition.id}` : undefined}
		onclick={() => actions.toggleEdition(edition.id)}
	>
		<span class="flex flex-col">
			<span class="text-sm text-ink">{edition.name}</span>
			<span class="text-xs text-ink-2">{edition.publisher || m.library_edition_publisher_unknown()}</span>
		</span>
		<span aria-hidden="true">{open ? '▾' : '▸'}</span>
	</button>

	{#if open}
		<div id="library-copies-{edition.id}" class="ml-4 mt-1.5 flex flex-col gap-1">
			{#if lib.copyNodeStatus.get(edition.id) === 'loading'}
				<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
			{:else if lib.copyNodeStatus.get(edition.id) === 'error'}
				<div class="flex items-center gap-2" role="alert">
					<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
					<button type="button" class="text-xs underline" onclick={() => actions.loadCopies(edition.id)}>
						{m.library_node_retry()}
					</button>
				</div>
			{:else if copies.length === 0}
				<p class="text-xs text-ink-2">{m.library_copies_empty()}</p>
			{:else}
				<RadioChips
					testid="copy-sort-{edition.id}"
					label={m.library_copy_sort_label()}
					class="mb-1 flex items-center gap-1"
					options={COPY_SORT_KEYS.map((key) => ({
						value: key,
						label: COPY_SORT_LABEL[key](),
						testid: `copy-sort-${key}-${edition.id}`
					}))}
					selected={lib.copySortKey}
					onselect={actions.setCopySortKey}
					chipClass="rounded border px-1.5 py-0.5 text-[10px]"
					onClass="border-ink bg-ink text-paper"
					offClass="border-ink-5 text-ink-2"
				/>
				{#each sortCopies(copies, lib.copySortKey, { activeLendingForCopy: view.activeLendingForCopy, borrowerNames: lib.borrowerNames }) as copy (copy.id)}
					<CopyRow
						{copy}
						editionId={edition.id}
						allMembers={lib.allMembers}
						memberNames={lib.memberNames}
						borrowerNames={lib.borrowerNames}
						membersPartial={lib.membersPartial}
						checkoutError={lib.inlineCheckoutErrors.get(copy.id)}
						{view}
						{actions}
						{isLibrarian}
						{isOffline}
					/>
				{/each}
				{#if !isLibrarian}
					{@const availableCount = copies.filter((c) => !view.activeLendingForCopy(c.id)).length}
					{#if availableCount > 0}
						<div
							data-testid="library-available-summary-{edition.id}"
							class="text-xs text-ink-2"
						>
							{m.library_available_summary({ count: availableCount })}
						</div>
					{/if}
				{/if}
			{/if}
		</div>

		<EditionFiles
			{work}
			{edition}
			{files}
			heldFileIds={lib.heldFileIds}
			{actions}
			{isLibrarian}
			{isOffline}
		/>
	{/if}
</div>
