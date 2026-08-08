<script lang="ts">
	// T6.3/#54 — the library browse page: works -> editions -> copies, availability
	// derived from lending. Read-only throughout. Same state-machine shape as
	// roster/+page.svelte (loading/no-collective/load-error/ready + generation guard).
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		listWorks,
		listEditions,
		listCopies,
		listLendings,
		resolveBorrowerNames,
		deriveCopyAvailability,
		type Work,
		type Edition,
		type Copy,
		type Lending
	} from '$lib/library/libraryData';

	const selected = $derived($selectedCollectiveStore);

	type Status = 'loading' | 'no-collective' | 'load-error' | 'ready';
	type NodeStatus = 'idle' | 'loading' | 'error';

	let generation = 0;
	let status = $state<Status>('loading');
	let works = $state<Work[]>([]);
	let lendings = $state<Lending[]>([]);
	let borrowerNames = $state<Map<string, string>>(new Map());

	let expandedWorks = $state<Set<string>>(new Set());
	let expandedEditions = $state<Set<string>>(new Set());
	let editionsByWork = $state<Map<string, Edition[]>>(new Map());
	let copiesByEdition = $state<Map<string, Copy[]>>(new Map());
	let editionNodeStatus = $state<Map<string, NodeStatus>>(new Map());
	let copyNodeStatus = $state<Map<string, NodeStatus>>(new Map());

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const g = ++generation;
		if (!current) {
			status = 'no-collective';
			works = [];
			return;
		}
		const token = getToken();
		if (!token) {
			console.error('library: no auth token in storage on a protected route');
			status = 'load-error';
			return;
		}
		status = 'loading';
		expandedWorks = new Set();
		expandedEditions = new Set();
		editionsByWork = new Map();
		copiesByEdition = new Map();
		try {
			const cfg = { db: current.db, token };
			const [workList, lendingList] = await Promise.all([listWorks(cfg), listLendings(cfg)]);
			if (g !== generation) return;
			const activeMemberIds = lendingList.filter((l) => l.returnedAt === '').map((l) => l.memberId);
			const names = await resolveBorrowerNames(cfg, activeMemberIds);
			if (g !== generation) return;
			works = workList;
			lendings = lendingList;
			borrowerNames = names;
			status = 'ready';
		} catch (e) {
			if (g !== generation) return;
			console.error('library: load failed', e);
			status = 'load-error';
		}
	}

	// Fetch-only (does not touch expandedWorks) — called both when a work is first
	// expanded (not yet cached) and from the error state's retry button (the node
	// stays expanded across a retry; only toggleWork collapses it).
	async function loadEditionsFor(workId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		editionNodeStatus = new Map(editionNodeStatus).set(workId, 'loading');
		try {
			const editions = await listEditions({ db: current.db, token }, workId);
			editionsByWork = new Map(editionsByWork).set(workId, editions);
			editionNodeStatus = new Map(editionNodeStatus).set(workId, 'idle');
		} catch (e) {
			console.error('library: editions load failed', workId, e);
			editionNodeStatus = new Map(editionNodeStatus).set(workId, 'error');
		}
	}

	function toggleWork(workId: string): void {
		const next = new Set(expandedWorks);
		if (next.has(workId)) {
			next.delete(workId);
			expandedWorks = next;
			return;
		}
		next.add(workId);
		expandedWorks = next;
		if (editionsByWork.has(workId)) return; // cached
		void loadEditionsFor(workId);
	}

	// Same fetch-only / toggle split as editions, one level down.
	async function loadCopiesFor(editionId: string): Promise<void> {
		const current = selected;
		if (!current) return;
		const token = getToken();
		if (!token) return;
		copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'loading');
		try {
			const copies = await listCopies({ db: current.db, token }, editionId);
			copiesByEdition = new Map(copiesByEdition).set(editionId, copies);
			copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'idle');
		} catch (e) {
			console.error('library: copies load failed', editionId, e);
			copyNodeStatus = new Map(copyNodeStatus).set(editionId, 'error');
		}
	}

	function toggleEdition(editionId: string): void {
		const next = new Set(expandedEditions);
		if (next.has(editionId)) {
			next.delete(editionId);
			expandedEditions = next;
			return;
		}
		next.add(editionId);
		expandedEditions = next;
		if (copiesByEdition.has(editionId)) return; // cached
		void loadCopiesFor(editionId);
	}

	$effect(() => {
		void selected;
		loadForSelected().catch((e) => {
			console.error('library: load failed', e);
			status = 'load-error';
		});
	});
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.library_title()}</h1>

		{#if status === 'no-collective'}
			<p data-testid="library-no-collective" class="text-sm">{m.library_no_collective()}</p>
		{:else if status === 'loading'}
			<div data-testid="library-skeleton" class="flex flex-col gap-3" aria-hidden="true" aria-busy="true">
				{#each [0, 1, 2] as row (row)}
					<div class="flex animate-pulse flex-col gap-1.5 py-2">
						<div class="h-3 w-1/2 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				{/each}
			</div>
		{:else if status === 'load-error'}
			<div data-testid="library-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.library_load_error()}</p>
				<button
					type="button"
					data-testid="library-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.library_retry()}
				</button>
			</div>
		{:else if works.length === 0}
			<div data-testid="library-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.library_empty()}</p>
			</div>
		{:else}
			<ul data-testid="library-work-list" class="flex flex-col gap-1">
				{#each works as work (work.id)}
					{@const isOpen = expandedWorks.has(work.id)}
					<li data-testid="library-work-{work.id}" class="flex flex-col border-b border-dashed border-ink-5 py-2 last:border-b-0">
						<button
							type="button"
							data-testid="library-work-toggle-{work.id}"
							class="flex items-center justify-between text-left"
							aria-expanded={isOpen}
							aria-controls="library-editions-{work.id}"
							onclick={() => toggleWork(work.id)}
						>
							<span class="flex flex-col">
								<span class="text-sm text-ink">{work.name}</span>
								<span class="text-xs text-ink-2">{work.composer || m.library_work_composer_unknown()}</span>
							</span>
							<span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
						</button>

						{#if isOpen}
							<div id="library-editions-{work.id}" class="ml-4 mt-2 flex flex-col gap-1">
								{#if editionNodeStatus.get(work.id) === 'loading'}
									<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
								{:else if editionNodeStatus.get(work.id) === 'error'}
									<div class="flex items-center gap-2">
										<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
										<button
											type="button"
											class="text-xs underline"
											onclick={() => loadEditionsFor(work.id)}
										>
											{m.library_node_retry()}
										</button>
									</div>
								{:else if (editionsByWork.get(work.id) ?? []).length === 0}
									<p class="text-xs text-ink-2">{m.library_editions_empty()}</p>
								{:else}
									{#each editionsByWork.get(work.id) ?? [] as edition (edition.id)}
										{@const editionOpen = expandedEditions.has(edition.id)}
										<div data-testid="library-edition-{edition.id}" class="flex flex-col border-b border-dashed border-ink-5 py-1.5 last:border-b-0">
											<button
												type="button"
												data-testid="library-edition-toggle-{edition.id}"
												class="flex items-center justify-between text-left"
												aria-expanded={editionOpen}
												aria-controls="library-copies-{edition.id}"
												onclick={() => toggleEdition(edition.id)}
											>
												<span class="flex flex-col">
													<span class="text-sm text-ink">{edition.name}</span>
													<span class="text-xs text-ink-2">{edition.publisher || m.library_edition_publisher_unknown()}</span>
												</span>
												<span aria-hidden="true">{editionOpen ? '▾' : '▸'}</span>
											</button>

											{#if editionOpen}
												<div id="library-copies-{edition.id}" class="ml-4 mt-1.5 flex flex-col gap-1">
													{#if copyNodeStatus.get(edition.id) === 'loading'}
														<div class="h-2.5 w-1/3 animate-pulse rounded bg-ink-5"></div>
													{:else if copyNodeStatus.get(edition.id) === 'error'}
														<div class="flex items-center gap-2">
															<p class="text-xs text-red-700">{m.library_node_load_error()}</p>
															<button type="button" class="text-xs underline" onclick={() => loadCopiesFor(edition.id)}>
																{m.library_node_retry()}
															</button>
														</div>
													{:else if (copiesByEdition.get(edition.id) ?? []).length === 0}
														<p class="text-xs text-ink-2">{m.library_copies_empty()}</p>
													{:else}
														{#each copiesByEdition.get(edition.id) ?? [] as copy (copy.id)}
															{@const availability = deriveCopyAvailability(copy.id, lendings)}
															<div data-testid="library-copy-{copy.id}" class="flex items-center justify-between text-xs">
																<span class="text-ink">{copy.name}</span>
																{#if availability.status === 'available'}
																	<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">{m.library_copy_available()}</span>
																{:else}
																	<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">
																		{m.library_copy_lent_to({
																			name: borrowerNames.get(availability.memberId) || m.library_borrower_unknown()
																		})}
																		{#if availability.assignedAt}
																			· {m.library_lent_since({ date: availability.assignedAt })}
																		{/if}
																	</span>
																{/if}
															</div>
														{/each}
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>
