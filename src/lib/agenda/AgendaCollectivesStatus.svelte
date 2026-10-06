<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import { collectiveState, hydrateCollectives } from '$lib/collectives/store';
	import type { CollectiveState } from '$lib/collectives/types';
	import { m } from '$lib/paraglide/messages.js';

	let { collectives }: { collectives: CollectiveState } = $props();

	// hydrateCollectives publishes no loading state of its own on retry (only
	// the terminal state), so this flag is the only place an in-flight retry
	// shows — without it a slow retry reads as a dead control.
	let collectivesRetrying = $state(false);

	async function retryCollectives(): Promise<void> {
		if (collectivesRetrying) return;
		const knownErroredDbs = $collectiveState.status === 'error' ? $collectiveState.erroredDbs : [];
		collectivesRetrying = true;
		try {
			await hydrateCollectives();
		} catch (err) {
			reportProblem({ area: 'collectives', action: 'retrying the collective discovery', error: err });
			collectiveState.set({ status: 'error', erroredDbs: knownErroredDbs });
		} finally {
			collectivesRetrying = false;
		}
	}
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
	<p class="text-sm text-ink" data-testid="auth-status">{m.agenda_signed_in()}</p>
	{#if collectives.status === 'none'}
		<p class="text-sm text-ink">{m.agenda_collectives_none()}</p>
	{:else if collectives.status === 'error'}
		<p class="text-sm text-ink">
			{m.agenda_collectives_error_dbs({ dbs: collectives.erroredDbs.join(', ') })}
		</p>
		<button
			type="button"
			class="rounded-md border border-ink px-4 py-2 text-sm text-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
			data-testid="collectives-retry"
			disabled={collectivesRetrying}
			aria-busy={collectivesRetrying}
			onclick={() => {
				void retryCollectives();
			}}
		>
			{m.agenda_collectives_error_retry()}
		</button>
		<a href="/downloads" class="text-sm text-ink underline" data-testid="agenda-downloads-link">
			{m.agenda_downloads_link()}
		</a>
	{:else}
		<p class="text-sm text-ink">{m.agenda_collectives_loading()}</p>
	{/if}
</main>
