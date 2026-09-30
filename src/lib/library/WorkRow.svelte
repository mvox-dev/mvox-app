<!-- One work in the browse tree: toggle, repertoire badge, its editions and the
	librarian's create-edition form. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Work } from '$lib/library/libraryData';
	import {
		editionDraftView,
		type EditionDrafts,
		type EditionFilesState,
		type LibraryState,
		type TreeActions
	} from '$lib/library/libraryState';
	import type { LendingView } from '$lib/library/lendingView';
	import EditionRow from '$lib/library/EditionRow.svelte';
	import InlineCreateForm from '$lib/library/InlineCreateForm.svelte';

	interface Props {
		work: Work;
		lib: LibraryState;
		drafts: EditionDrafts;
		files: EditionFilesState;
		view: LendingView;
		actions: TreeActions;
		isLibrarian: boolean;
		isOffline: boolean;
	}

	let {
		work,
		lib,
		drafts = $bindable(),
		files,
		view,
		actions,
		isLibrarian,
		isOffline
	}: Props = $props();

	// #92 — only this season's active and learning items reach repertoireByWorkId.
	const REPERTOIRE_BADGE_DOT_CLASS: Record<string, string> = {
		active: 'bg-green',
		learning: 'bg-amber'
	};
	const REPERTOIRE_BADGE_LABEL: Record<string, () => string> = {
		active: m.repertoire_status_active,
		learning: m.repertoire_status_learning
	};

	const isOpen = $derived(lib.expandedWorks.has(work.id));
	const editions = $derived(lib.editionsByWork.get(work.id) ?? []);
</script>

<li data-testid="library-work-{work.id}" class="flex flex-col border-b border-dashed border-ink-5 py-2 last:border-b-0">
	<button
		type="button"
		data-testid="library-work-toggle-{work.id}"
		class="flex items-center justify-between text-left"
		aria-expanded={isOpen}
		aria-controls={isOpen ? `library-editions-${work.id}` : undefined}
		onclick={() => actions.toggleWork(work.id)}
	>
		<span class="flex flex-col">
			<span class="text-sm text-ink">{work.name}{#if isLibrarian}{@const avail = view.workAvailability(work.id)}{#if avail.total > 0} ({m.library_work_availability(avail)}){/if}{/if}</span>
			<span class="text-xs text-ink-2">{work.composer || m.library_work_composer_unknown()}</span>
		</span>
		<span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
	</button>

	{#if lib.repertoireByWorkId.has(work.id)}
		{@const repStatus = lib.repertoireByWorkId.get(work.id)!.status}
		<span
			data-testid="repertoire-badge-{work.id}"
			data-status={repStatus}
			role="img"
			aria-label={m.repertoire_badge_aria_label({
				status: REPERTOIRE_BADGE_LABEL[repStatus]?.() ?? repStatus
			})}
			class="mt-1 inline-flex w-fit items-center gap-1 font-mono text-[9px] tracking-wide text-ink-2"
		>
			<span
				class="h-1.5 w-1.5 rounded-full {REPERTOIRE_BADGE_DOT_CLASS[repStatus] ?? 'bg-ink-4'}"
				aria-hidden="true"
			></span>
			{REPERTOIRE_BADGE_LABEL[repStatus]?.() ?? repStatus}
		</span>
	{/if}

	{#if isOpen}
		<div id="library-editions-{work.id}" class="ml-4 mt-2 flex flex-col gap-1">
			{#if lib.editionNodeStatus.get(work.id) === 'loading'}
				<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
			{:else if lib.editionNodeStatus.get(work.id) === 'error'}
				<div class="flex items-center gap-2" role="alert">
					<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
					<button
						type="button"
						class="text-xs underline"
						onclick={() => actions.loadEditions(work.id)}
					>
						{m.library_node_retry()}
					</button>
				</div>
			{:else if editions.length === 0}
				<p class="text-xs text-ink-2">{m.library_editions_empty()}</p>
			{:else}
				{#each editions as edition (edition.id)}
					<EditionRow {work} {edition} {lib} {files} {view} {actions} {isLibrarian} {isOffline} />
				{/each}
			{/if}

			<!-- #271 — after the whole chain, not inside a branch: a work with no editions is
			     the one that needs this most. Only once 'idle': inserting into a list never
			     fetched would leave the work half-populated. -->
			{#if isLibrarian && lib.editionNodeStatus.get(work.id) === 'idle'}
				<InlineCreateForm
					kind="edition"
					suffix="-{work.id}"
					view={editionDraftView(drafts, work.id)}
					{isOffline}
					submit={() => actions.submitEdition(work.id)}
				/>
			{/if}
		</div>
	{/if}
</li>
