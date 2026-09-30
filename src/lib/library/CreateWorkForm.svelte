<!-- #198 — the librarian's inline "create work" form. Its state is on the page (bound
	here); the page does the write. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { closeWorkForm, openWorkForm, type WorkForm } from '$lib/library/libraryState';

	interface Props {
		form: WorkForm;
		isOffline: boolean;
		submit: () => Promise<void>;
	}

	let { form = $bindable(), isOffline, submit }: Props = $props();

	let nameInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (form.open && nameInput) nameInput.focus();
	});

	// Wired on every control, not the wrapper: a keydown listener on a non-interactive
	// div is an a11y violation.
	function onEscapeKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		closeWorkForm(form);
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

<div class="mt-3 flex flex-col gap-1.5 border-t border-dashed border-ink-5 pt-3">
	{#if !form.open}
		<button
			type="button"
			data-testid="create-work-button"
			class="flex min-h-11 items-center self-start rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper"
			onclick={() => openWorkForm(form)}
		>
			{m.library_create_work_button()}
		</button>
	{:else}
		<!-- role="group", not "dialog": a non-modal inline form with no focus trap. -->
		<div
			data-testid="create-work-form"
			role="group"
			aria-label={m.library_create_work_button()}
			class="flex flex-col gap-1.5"
		>
			<input
				type="text"
				data-testid="create-work-name"
				bind:this={nameInput}
				aria-label={m.library_create_work_name_label()}
				placeholder={m.library_create_work_name_label()}
				aria-invalid={form.error ? true : undefined}
				aria-describedby={form.error ? 'create-work-error' : undefined}
				value={form.name}
				oninput={(e) => (form.name = (e.currentTarget as HTMLInputElement).value)}
				onkeydown={onFieldKeydown}
				class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			<input
				type="text"
				data-testid="create-work-composer"
				aria-label={m.library_create_work_composer_label()}
				placeholder={m.library_create_work_composer_label()}
				value={form.composer}
				oninput={(e) => (form.composer = (e.currentTarget as HTMLInputElement).value)}
				onkeydown={onFieldKeydown}
				class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			{#if form.error}
				<p
					id="create-work-error"
					role="alert"
					data-testid="create-work-error"
					class="text-xs text-red-700"
				>
					{form.error()}
				</p>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					data-testid="create-work-submit"
					class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
					disabled={form.pending || isOffline}
					onclick={() => void submit()}
					onkeydown={onEscapeKeydown}
				>
					{m.library_create_work_submit()}
				</button>
				<button
					type="button"
					data-testid="create-work-cancel"
					class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink"
					onclick={() => closeWorkForm(form)}
					onkeydown={onEscapeKeydown}
				>
					{m.library_create_work_cancel()}
				</button>
			</div>
		</div>
	{/if}
	<div
		data-testid="create-work-status"
		role="status"
		aria-live="polite"
		class="sr-only"
	>
		{form.status}
	</div>
</div>
