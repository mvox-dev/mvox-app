<!-- The app-wide "a newer version is available" notice and its Refresh (#1052). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import {
		newerVersion,
		startVersionWatch,
		type RefreshFailure,
		type VersionWatch,
		type VersionWatchDeps
	} from './newerVersion';

	let { deps = {} }: { deps?: Partial<VersionWatchDeps> } = $props();

	const FAILURE_TEXT: Record<RefreshFailure, () => string> = {
		offline: () => m.newer_version_failed_no_connection(),
		'install-failed': () => m.newer_version_failed_install(),
		'not-deployed': () => m.newer_version_failed_not_deployed()
	};

	let watch: VersionWatch | undefined;
	onMount(() => {
		watch = startVersionWatch(deps);
		return () => watch?.stop();
	});
</script>

{#if $newerVersion.state !== 'none'}
	<div
		data-testid="newer-version-notice"
		role="status"
		class="mx-auto flex w-full max-w-md flex-wrap items-center gap-x-3 px-6 pt-4 text-sm text-ink-2"
	>
		<p>{m.newer_version_available()}</p>
		<button
			type="button"
			class="min-h-11 min-w-11 rounded-md px-3 py-1.5 font-sans text-sm text-ink underline hover:bg-paper disabled:cursor-default disabled:opacity-60"
			disabled={$newerVersion.state === 'refreshing'}
			onclick={() => void watch?.refresh()}
		>
			{m.newer_version_refresh()}
		</button>
		{#if $newerVersion.state === 'failed'}
			<p class="w-full">{FAILURE_TEXT[$newerVersion.reason]()}</p>
		{/if}
	</div>
{/if}
