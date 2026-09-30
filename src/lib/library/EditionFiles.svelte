<!-- #275 — an edition's files and, for a librarian, the attach input. A sibling of the
	copies block on the edition's own indent: a third indent level leaves a phone-width
	filename too little room. Filenames wrap, never truncate. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Edition, Work } from '$lib/library/libraryData';
	import type { EditionFilesState, TreeActions } from '$lib/library/libraryState';

	interface Props {
		work: Work;
		edition: Edition;
		files: EditionFilesState;
		heldFileIds: Set<string> | null;
		actions: TreeActions;
		isLibrarian: boolean;
		isOffline: boolean;
	}

	let { work, edition, files, heldFileIds, actions, isLibrarian, isOffline }: Props = $props();
</script>

{#if (edition.files ?? []).length > 0 || (files.broken.get(edition.id)?.length ?? 0) > 0}
	<div
		data-testid="library-edition-files-{edition.id}"
		class="mt-1.5 flex flex-col gap-1"
	>
		{#each edition.files ?? [] as file (file.id)}
			<div class="flex flex-col gap-0.5">
				<div
					data-testid="library-edition-file-{file.id}"
					class="flex items-center justify-between gap-2 text-xs"
				>
					<span class="break-words text-ink">
						{file.filename} · {actions.fileSize(file.filesize)}
					</span>
					<span class="flex shrink-0 items-center gap-2">
						<!-- #351 — presence indicator, not a control; absent until the store answers. -->
						{#if heldFileIds !== null}
							<span
								data-testid="file-presence-{file.id}"
								class="text-ink-2"
							>
								{heldFileIds.has(file.id)
									? m.file_presence_on_device()
									: m.file_presence_needs_network()}
							</span>
						{/if}
						<button
							type="button"
							data-testid="library-edition-file-open-{file.id}"
							class="shrink-0 text-xs underline"
							onclick={() => actions.openFile(file.id, work, edition, file.filename)}
						>
							{m.library_edition_file_open()}
						</button>
					</span>
				</div>
			</div>
		{/each}
		{#each files.broken.get(edition.id) ?? [] as broken (broken.propertyId)}
			<div
				data-testid="library-edition-file-broken-{broken.propertyId}"
				class="break-words text-xs text-red-700"
			>
				{m.library_edition_file_broken({ filename: broken.filename })}
			</div>
		{/each}
	</div>
{/if}

<!-- Librarian only, absent rather than disabled; a native multi-file input. -->
{#if isLibrarian}
	<div class="mt-1.5 flex flex-col gap-1">
		<label class="flex flex-col gap-0.5 text-xs text-ink-2">
			{m.library_edition_file_attach()}
			<input
				type="file"
				multiple
				data-testid="library-attach-file-{edition.id}"
				aria-label={m.library_edition_file_attach()}
				disabled={files.pending.has(edition.id) || isOffline}
				onchange={(e) => {
					const input = e.currentTarget as HTMLInputElement;
					void actions.attachFiles(edition.id, input.files);
					input.value = '';
				}}
			/>
		</label>
		{#if files.pending.has(edition.id)}
			<span
				data-testid="library-edition-files-uploading-{edition.id}"
				class="text-xs text-ink-2"
			>
				{m.library_edition_file_uploading()}
			</span>
		{/if}
		{#if files.batchError.has(edition.id) || (files.errors.get(edition.id)?.length ?? 0) > 0 || (files.notCreated.get(edition.id)?.length ?? 0) > 0}
			<div
				data-testid="library-edition-files-error-{edition.id}"
				role="alert"
				class="flex flex-col gap-0.5 break-words text-xs text-red-700"
			>
				{#if files.batchError.has(edition.id)}
					<span>{m.library_edition_file_error()}</span>
				{:else}
					{#each files.errors.get(edition.id) ?? [] as filename}
						<span>{m.library_edition_file_failed({ filename })}</span>
					{/each}
					{#each files.notCreated.get(edition.id) ?? [] as filename}
						<span>{m.library_edition_file_not_created({ filename })}</span>
					{/each}
				{/if}
			</div>
		{/if}
		<div
			data-testid="library-edition-files-status-{edition.id}"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{files.statuses.get(edition.id) ?? ''}
		</div>
	</div>
{/if}
