<script lang="ts">
	import {
		collectiveState,
		selectedCollectiveStore,
		selectCollective
	} from '$lib/collectives/store';

	// Minimal collective picker / empty-state surface for the 0/1/many cases.
	// Byrd owns the polished UI later; this proves selection works end-to-end.
	const state = $derived($collectiveState);
	const selected = $derived($selectedCollectiveStore);
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-6 text-ink">
	{#if state.status === 'loading'}
		<p class="text-sm text-ink">Loading collectives…</p>
	{:else if state.status === 'anonymous'}
		<p class="text-sm text-ink">Please <a class="underline" href="/auth/login">sign in</a>.</p>
	{:else if state.status === 'none'}
		<h1 class="font-display text-2xl">No collectives yet</h1>
		<p class="text-sm text-ink" data-testid="collectives-empty">
			Your account isn't a member of any mvox collective.
		</p>
	{:else if state.status === 'error'}
		<h1 class="font-display text-2xl">Couldn't load your collectives</h1>
		<p class="text-sm text-ink" data-testid="collectives-error">
			Some collectives could not be checked ({state.erroredDbs.join(', ')}). Please retry.
		</p>
	{:else}
		<h1 class="font-display text-2xl">Choose a collective</h1>
		<ul class="flex w-full max-w-xs flex-col gap-2" data-testid="collectives-list">
			{#each state.collectives as c (c.db)}
				<li>
					<button
						type="button"
						onclick={() => selectCollective(c.db)}
						data-testid={`collective-${c.db}`}
						aria-current={selected?.db === c.db}
						class="w-full rounded-md border border-ink px-4 py-2 text-left text-sm hover:bg-ink hover:text-paper aria-[current=true]:bg-ink aria-[current=true]:text-paper"
					>
						{c.name}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>
