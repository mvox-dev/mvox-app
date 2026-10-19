<!-- The original PDF the viewer opened, saved as is: no ink, no re-fetch. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getAppLabelStore } from '$lib/files/appLabelStore';
	import { storedPartLabel, type PartLabel } from '$lib/files/labelStore';

	let {
		url,
		db,
		personId,
		fileId,
		label
	}: {
		url: string;
		db: string;
		personId: string;
		fileId: string;
		label: PartLabel | undefined;
	} = $props();

	// '' lets the browser name the file; a name is never invented.
	let storedName = $state('');
	const name = $derived(label?.filename ?? storedName);

	$effect(() => {
		if (label) return;
		let cancelled = false;
		void storedPartLabel(getAppLabelStore(), { db, personId, fileId }).then((stored) => {
			if (!cancelled) storedName = stored?.filename ?? '';
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<a
	href={url}
	download={name}
	class="font-sans text-sm text-paper underline"
	data-testid="part-download"
>
	{m.part_download()}
</a>
