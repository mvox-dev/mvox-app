<!-- #271 — the librarian's inline "create edition" form for one work. Drafts are keyed
	per work on the page (bound here), so a collapse keeps them; the page does the write. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		closeEditionDraft,
		openEditionDraft,
		type EditionDrafts
	} from '$lib/library/libraryState';
	import { focusOnMount } from '$lib/a11y/focusable';

	interface Props {
		workId: string;
		drafts: EditionDrafts;
		isOffline: boolean;
		submit: () => Promise<void>;
	}

	let { workId, drafts = $bindable(), isOffline, submit }: Props = $props();

	// On every control, not the wrapper div (a11y: no listeners on non-interactive elements).
	function onEscapeKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		closeEditionDraft(drafts, workId);
	}

	function onFieldKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			onEscapeKeydown(event);
			return;
		}
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void submit();
	}
</script>

<div class="mt-1.5 flex flex-col gap-1.5">
	{#if !drafts.open.has(workId)}
		<button
			type="button"
			data-testid="create-edition-button-{workId}"
			class="flex min-h-11 items-center self-start rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper"
			onclick={() => openEditionDraft(drafts, workId)}
		>
			{m.library_create_edition_button()}
		</button>
	{:else}
		<!-- role="group", not "dialog": the same non-modal inline form as create-work. -->
		<div
			data-testid="create-edition-form-{workId}"
			role="group"
			aria-label={m.library_create_edition_button()}
			class="flex flex-col gap-1.5"
		>
			<input
				type="text"
				data-testid="create-edition-name-{workId}"
				use:focusOnMount
				aria-label={m.library_create_edition_name_label()}
				placeholder={m.library_create_edition_name_label()}
				aria-invalid={drafts.errors.has(workId) ? true : undefined}
				aria-describedby={drafts.errors.has(workId) ? `create-edition-error-${workId}` : undefined}
				value={drafts.name.get(workId) ?? ''}
				oninput={(e) =>
					(drafts.name = new Map(drafts.name).set(
						workId,
						(e.currentTarget as HTMLInputElement).value
					))}
				onkeydown={onFieldKeydown}
				class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			<input
				type="text"
				data-testid="create-edition-publisher-{workId}"
				aria-label={m.library_create_edition_publisher_label()}
				placeholder={m.library_create_edition_publisher_label()}
				value={drafts.publisher.get(workId) ?? ''}
				oninput={(e) =>
					(drafts.publisher = new Map(drafts.publisher).set(
						workId,
						(e.currentTarget as HTMLInputElement).value
					))}
				onkeydown={onFieldKeydown}
				class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			{#if drafts.errors.get(workId)}
				<p
					id="create-edition-error-{workId}"
					role="alert"
					data-testid="create-edition-error-{workId}"
					class="text-xs text-red-700"
				>
					{drafts.errors.get(workId)!()}
				</p>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					data-testid="create-edition-submit-{workId}"
					class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
					disabled={drafts.pending.has(workId) || isOffline}
					onclick={() => void submit()}
					onkeydown={onEscapeKeydown}
				>
					{m.library_create_edition_submit()}
				</button>
				<button
					type="button"
					data-testid="create-edition-cancel-{workId}"
					class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink"
					onclick={() => closeEditionDraft(drafts, workId)}
					onkeydown={onEscapeKeydown}
				>
					{m.library_create_edition_cancel()}
				</button>
			</div>
		</div>
	{/if}
	<div
		data-testid="create-edition-status-{workId}"
		role="status"
		aria-live="polite"
		class="sr-only"
	>
		{drafts.statuses.get(workId) ?? ''}
	</div>
</div>
