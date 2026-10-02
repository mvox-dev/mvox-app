<div
	data-testid="roster-skeleton"
	class="flex flex-col gap-3"
	aria-hidden="true"
	aria-busy="true"
>
	{#each [0, 1, 2] as row (row)}
		<div data-testid="roster-skeleton-row" class="flex animate-pulse flex-col gap-1.5 py-2">
			<div class="h-3 w-1/2 rounded bg-ink-5"></div>
			<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
		</div>
	{/each}
</div>
