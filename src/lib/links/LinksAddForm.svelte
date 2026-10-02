<!-- The links page's add form: name, url and description, submitted together. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		addName: string;
		addUrl: string;
		addDescription: string;
		isOffline: boolean;
		onsubmit: () => void;
	}

	let {
		addName = $bindable(),
		addUrl = $bindable(),
		addDescription = $bindable(),
		isOffline,
		onsubmit
	}: Props = $props();
</script>

<form
	data-testid="links-add-form"
	class="flex flex-col gap-2"
	onsubmit={(e) => {
		e.preventDefault();
		onsubmit();
	}}
>
	<label class="flex flex-col gap-1 text-sm">
		{m.links_add_name_label()}
		<input
			data-testid="links-add-name"
			type="text"
			bind:value={addName}
			class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
		/>
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.links_add_url_label()}
		<input
			data-testid="links-add-url"
			type="text"
			bind:value={addUrl}
			class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
		/>
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.links_add_description_label()}
		<input
			data-testid="links-add-description"
			type="text"
			bind:value={addDescription}
			class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
		/>
	</label>
	<button
		type="submit"
		data-testid="links-add-submit"
		disabled={isOffline}
		class="self-start rounded-md border border-ink px-2 py-1 text-xs disabled:opacity-50"
	>
		{m.links_add_submit()}
	</button>
</form>
