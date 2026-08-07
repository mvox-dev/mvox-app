<script lang="ts">
	// T3.3/#19 — the collective roster: active members' shared name+email subset.
	// Protected automatically (not on guard.ts's allowlist, `isProtectedPath('/roster')`
	// is true by default). No `completionGate` import here — the CURRENT-user
	// application of #28 is the layout's redirect; the OTHER-members application (a
	// nameless member never appearing as a row) lives entirely in `rosterData.ts`'s
	// `toRosterRow` — this component only renders whatever `loadRoster` returns.
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';

	const selected = $derived($selectedCollectiveStore);

	type Status = 'loading' | 'no-collective' | 'load-error' | 'ready';

	// Non-reactive generation guard — mirrors profile/+page.svelte's `let generation`
	// exactly (never $state, so bumping it doesn't retrigger the load effect). Guards
	// against a stale (superseded) load resolving after a collective switch.
	let generation = 0;
	let status = $state<Status>('loading');
	let loadError = $state('');
	let rows = $state<RosterRow[]>([]);

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const g = ++generation;
		if (!current) {
			status = 'no-collective';
			rows = [];
			return;
		}
		const token = getToken();
		if (!token) {
			// Inconsistency on a protected route — fail loud as a load error, never a
			// silent empty list.
			loadError = 'no auth token in storage on a protected route';
			status = 'load-error';
			return;
		}
		status = 'loading';
		try {
			const result = await loadRoster({ db: current.db, token });
			if (g !== generation) return; // superseded by a newer collective selection
			rows = result;
			status = 'ready';
		} catch (e) {
			if (g !== generation) return;
			loadError = e instanceof Error ? e.message : String(e);
			status = 'load-error';
		}
	}

	$effect(() => {
		// Depend on `selected`; run the async load out-of-band so a rejection can never
		// escape as an unhandled rejection from the effect (loadForSelected already
		// fails loud into `status`, but its synchronous prologue must not throw here).
		void selected;
		loadForSelected().catch((e) => {
			loadError = e instanceof Error ? e.message : String(e);
			status = 'load-error';
		});
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.roster_title()}</h1>

		{#if status === 'no-collective'}
			<p data-testid="roster-no-collective" class="text-sm">{m.roster_no_collective()}</p>
		{:else if status === 'loading'}
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
		{:else if status === 'load-error'}
			<div data-testid="roster-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.roster_load_error({ message: loadError })}</p>
				<button
					type="button"
					data-testid="roster-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.roster_retry()}
				</button>
			</div>
		{:else if rows.length === 0}
			<div data-testid="roster-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.roster_empty()}</p>
			</div>
		{:else}
			<ul data-testid="roster-list" class="flex flex-col">
				{#each rows as row (row.memberId)}
					<li
						data-testid="roster-row-{row.memberId}"
						class="flex flex-col gap-0.5 border-b border-dashed border-ink-5 py-2 last:border-b-0"
					>
						<span data-testid="roster-row-name" class="text-sm text-ink">{row.name}</span>
						{#if row.email}
							<span data-testid="roster-row-email" class="text-xs text-ink-2">{row.email}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
