<!-- #73 — the signed-in member's active loans. Always mounted: the name and chain
	lookups run whether or not the section shows. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Copy, Edition, Lending, LoanChain, Work } from '$lib/library/libraryData';
	import { formatDate, isOverdue } from '$lib/library/lendingView';
	import { resolveLocalFirst } from '$lib/library/resolveLocalFirst';
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
		resolveLocalFirst({
			loans,
			selected: () => selected,
			allCopies: () => allCopies,
			local: (copy) => copy.name || (copy.copyNumber ? `#${copy.copyNumber}` : ''),
			fetch: (cfg, ids) => loadCopyNames(cfg, ids),
			isCurrent: () => g === copyNameGen,
			apply: (names) => (copyNames = names),
			what: 'name'
		});
	});

	// #129 — copy, edition and work for each loan's label; same local-first split.
	let chainGen = 0;
	$effect(() => {
		const loans = myActiveLoans;
		const g = ++chainGen;
		resolveLocalFirst<LoanChain>({
			loans,
			selected: () => selected,
			allCopies: () => allCopies,
			local: (copy) => {
				const edition = allEditions.find((e) => e.id === copy.editionId);
				const work = edition ? works.find((w) => w.id === edition.workId) : undefined;
				return {
					copyNumber: copy.copyNumber,
					workName: work?.name ?? '',
					editionName: edition?.name ?? ''
				};
			},
			fetch: (cfg, ids) => loadCopyChains(cfg, ids, works),
			isCurrent: () => g === chainGen,
			apply: (chains) => (copyChains = chains),
			what: 'chain'
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
