<!-- The librarian's inline create form for a work or an edition; the caller owns the state. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { focusOnMount } from '$lib/a11y/focusable';
	import { escapeKeydown, fieldKeydown } from '$lib/a11y/formKeys';
	import type { InlineCreateView } from '$lib/library/libraryState';

	interface Props {
		kind: 'work' | 'edition';
		suffix?: string;
		view: InlineCreateView;
		isOffline: boolean;
		submit: () => Promise<void>;
	}

	let { kind, suffix = '', view, isOffline, submit }: Props = $props();

	const KINDS = {
		work: {
			wrapper: 'mt-3 flex flex-col gap-1.5 border-t border-dashed border-ink-5 pt-3',
			second: 'composer',
			button: () => m.library_create_work_button(),
			nameLabel: () => m.library_create_work_name_label(),
			secondLabel: () => m.library_create_work_composer_label(),
			submitLabel: () => m.library_create_work_submit(),
			cancelLabel: () => m.library_create_work_cancel()
		},
		edition: {
			wrapper: 'mt-1.5 flex flex-col gap-1.5',
			second: 'publisher',
			button: () => m.library_create_edition_button(),
			nameLabel: () => m.library_create_edition_name_label(),
			secondLabel: () => m.library_create_edition_publisher_label(),
			submitLabel: () => m.library_create_edition_submit(),
			cancelLabel: () => m.library_create_edition_cancel()
		}
	};

	const k = $derived(KINDS[kind]);
	const id = (part: string) => `create-${kind}-${part}${suffix}`;
	const keys = { close: () => view.onclose(), submit: () => void submit() };
	const onEscape = (event: KeyboardEvent) => escapeKeydown(event, keys.close);
	const onField = (event: KeyboardEvent) => fieldKeydown(event, keys);
</script>

<div class={k.wrapper}>
	{#if !view.open}
		<button
			type="button"
			data-testid={id('button')}
			class="flex min-h-11 items-center self-start rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper"
			onclick={() => view.onopen()}
		>
			{k.button()}
		</button>
	{:else}
		<!-- role="group", not "dialog": a non-modal inline form with no focus trap. -->
		<div data-testid={id('form')} role="group" aria-label={k.button()} class="flex flex-col gap-1.5">
			<input
				type="text"
				data-testid={id('name')}
				use:focusOnMount
				aria-label={k.nameLabel()}
				placeholder={k.nameLabel()}
				aria-invalid={view.error ? true : undefined}
				aria-describedby={view.error ? id('error') : undefined}
				value={view.name}
				oninput={(e) => view.onname((e.currentTarget as HTMLInputElement).value)}
				onkeydown={onField}
				class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			<input
				type="text"
				data-testid={id(k.second)}
				aria-label={k.secondLabel()}
				placeholder={k.secondLabel()}
				value={view.second}
				oninput={(e) => view.onsecond((e.currentTarget as HTMLInputElement).value)}
				onkeydown={onField}
				class="min-h-11 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			{#if view.error}
				<p id={id('error')} role="alert" data-testid={id('error')} class="text-xs text-red-700">
					{view.error()}
				</p>
			{/if}
			<div class="flex gap-2">
				<button
					type="button"
					data-testid={id('submit')}
					class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
					disabled={view.pending || isOffline}
					onclick={() => void submit()}
					onkeydown={onEscape}
				>
					{k.submitLabel()}
				</button>
				<button
					type="button"
					data-testid={id('cancel')}
					class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink"
					onclick={() => view.onclose()}
					onkeydown={onEscape}
				>
					{k.cancelLabel()}
				</button>
			</div>
		</div>
	{/if}
	<div data-testid={id('status')} role="status" aria-live="polite" class="sr-only">
		{view.status}
	</div>
</div>
