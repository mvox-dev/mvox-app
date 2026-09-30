<!-- #73 — the signed-in member's active loans. Always mounted: the name and chain
	lookups run whether or not the section shows. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import type { Copy, Edition, Lending, LoanChain, Work } from '$lib/library/libraryData';
	import { formatDate, isOverdue } from '$lib/library/lendingView';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	interface Props {
		selected: { db: string } | null;
		lendings: Lending[];
		myMemberId: string | null;
		works: Work[];
		allCopies: Copy[];
		allEditions: Edition[];
		loadCopyNames: (cfg: EntuCfg, copyIds: string[]) => Promise<Map<string, string>>;
		loadCopyChains: (
			cfg: EntuCfg,
			copyIds: string[],
			works: Work[]
		) => Promise<Map<string, LoanChain>>;
		chainLabel: (chain: LoanChain) => string;
	}

	let {
		selected,
		lendings,
		myMemberId,
		works,
		allCopies,
		allEditions,
		loadCopyNames,
		loadCopyChains,
		chainLabel
	}: Props = $props();

	let expanded = $state(false);
	let copyNames = $state<Map<string, string>>(new Map());
	let copyChains = $state<Map<string, LoanChain>>(new Map());

	const myActiveLoans = $derived(
		myMemberId ? lendings.filter((l) => l.memberId === myMemberId && l.returnedAt === '') : []
	);

	// Copy names, so a loan never renders a raw entity id. A librarian already holds every
	// copy, so those resolve locally; the rest take one read.
	let copyNameGen = 0;
	$effect(() => {
		const loans = myActiveLoans;
		const g = ++copyNameGen;
		if (loans.length === 0) {
			copyNames = new Map();
			return;
		}
		const current = selected;
		if (!current) {
			copyNames = new Map();
			return;
		}
		const token = getToken();
		if (!token) return;
		const localNames = new Map<string, string>();
		const unresolved: string[] = [];
		for (const id of loans.map((l) => l.copyId)) {
			const cached = allCopies.find((c) => c.id === id);
			if (cached) {
				localNames.set(id, cached.name || (cached.copyNumber ? `#${cached.copyNumber}` : ''));
			} else {
				unresolved.push(id);
			}
		}
		if (unresolved.length === 0) {
			if (g !== copyNameGen) return;
			copyNames = localNames;
			return;
		}
		loadCopyNames({ db: current.db, token }, unresolved)
			.then((names) => {
				if (g !== copyNameGen) return;
				for (const [id, name] of localNames) names.set(id, name);
				copyNames = names;
			})
			.catch((e) => {
				console.error('library: copy name resolution failed', e);
			});
	});

	// #129 — copy, edition and work for each loan's label; same local-first split.
	let chainGen = 0;
	$effect(() => {
		const loans = myActiveLoans;
		const g = ++chainGen;
		if (loans.length === 0) {
			copyChains = new Map();
			return;
		}
		const current = selected;
		if (!current) {
			copyChains = new Map();
			return;
		}
		const token = getToken();
		if (!token) return;
		const localChains = new Map<string, LoanChain>();
		const unresolved: string[] = [];
		for (const id of loans.map((l) => l.copyId)) {
			const cached = allCopies.find((c) => c.id === id);
			if (cached) {
				const edition = allEditions.find((e) => e.id === cached.editionId);
				const work = edition ? works.find((w) => w.id === edition.workId) : undefined;
				localChains.set(id, {
					copyNumber: cached.copyNumber,
					workName: work?.name ?? '',
					editionName: edition?.name ?? ''
				});
			} else {
				unresolved.push(id);
			}
		}
		if (unresolved.length === 0) {
			if (g !== chainGen) return;
			copyChains = localChains;
			return;
		}
		loadCopyChains({ db: current.db, token }, unresolved, works)
			.then((chains) => {
				if (g !== chainGen) return;
				for (const [id, chain] of localChains) chains.set(id, chain);
				copyChains = chains;
			})
			.catch((e) => {
				console.error('library: copy chain resolution failed', e);
			});
	});

	function loanLabel(copyId: string): string {
		const chain = copyChains.get(copyId);
		if (chain) return chainLabel(chain);
		return copyNames.get(copyId) || m.library_copy_name_unknown();
	}
</script>

{#if myActiveLoans.length > 0}
	<section data-testid="my-loans" class="rounded-md border border-ink-5 px-4 py-3">
		<button
			type="button"
			data-testid="my-loans-toggle"
			class="flex w-full items-center justify-between text-left text-sm font-medium"
			aria-expanded={expanded}
			aria-controls={expanded ? 'my-loans-list' : undefined}
			onclick={() => {
				expanded = !expanded;
			}}
		>
			<span>{m.library_my_loans_title({ count: myActiveLoans.length })}</span>
			<span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
		</button>
		{#if expanded}
			<ul id="my-loans-list" class="mt-2 flex flex-col gap-1">
				{#each myActiveLoans as loan (loan.id)}
					<li data-testid="my-loans-item-{loan.id}" class="flex items-center justify-between text-xs">
						<span>{m.library_my_loans_copy_label({ copyName: loanLabel(loan.copyId) })}</span>
						<span class="text-ink-2">
							{formatDate(loan.assignedAt)}{#if loan.assignedUntil} – {formatDate(loan.assignedUntil)}{/if}
						</span>
						{#if isOverdue(loan.assignedUntil)}
							<span data-testid="my-loans-overdue-{loan.id}" class="text-red-700">{m.library_my_loans_overdue()}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
