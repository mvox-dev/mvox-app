<!-- #73 — the signed-in member's active loans. Always mounted: the name and chain
	lookups run whether or not the section shows. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { firstById } from '$lib/collections/firstById';
	import { createLatest } from '$lib/async/latest';
	import { copyLabel, formatLoanChainLabel, isActiveLending } from '$lib/library/libraryData';
	import { loadMyLoanCopyNames, loadMyLoanCopyChains } from '$lib/library/libraryPageData';
	import type { Copy, Edition, Lending, LoanChain, Work } from '$lib/library/libraryData';
	import { formatLoanRange, isOverdue } from '$lib/library/lendingView';
	import { resolveLocalFirst } from '$lib/library/resolveLocalFirst';

	interface Props {
		selected: { db: string } | null;
		lendings: Lending[];
		myMemberId: string | null;
		works: Work[];
		allCopies: Copy[];
		allEditions: Edition[];
	}

	let {
		selected,
		lendings,
		myMemberId,
		works,
		allCopies,
		allEditions
	}: Props = $props();

	let expanded = $state(false);
	let copyNames = $state<Map<string, string>>(new Map());
	let copyChains = $state<Map<string, LoanChain>>(new Map());

	const myActiveLoans = $derived(
		myMemberId ? lendings.filter((l) => l.memberId === myMemberId && isActiveLending(l)) : []
	);
	const overdueCount = $derived(myActiveLoans.filter((l) => isOverdue(l.assignedUntil)).length);

	// Copy names, so a loan never renders a raw entity id. A librarian already holds every
	// copy, so those resolve locally; the rest take one read.
	const copyNameLoad = createLatest();
	$effect(() => {
		const loans = myActiveLoans;
		const isCurrent = copyNameLoad.next();
		void resolveLocalFirst({
			loans,
			selected: () => selected,
			allCopies: () => allCopies,
			local: copyLabel,
			fetch: (cfg, ids) => loadMyLoanCopyNames(cfg, ids),
			isCurrent,
			apply: (names) => (copyNames = names),
			what: 'name'
		});
	});

	const editionById = $derived(firstById(allEditions));
	const workById = $derived(firstById(works));

	// #129 — copy, edition and work for each loan's label; same local-first split.
	const chainLoad = createLatest();
	$effect(() => {
		const loans = myActiveLoans;
		const isCurrent = chainLoad.next();
		void resolveLocalFirst<LoanChain>({
			loans,
			selected: () => selected,
			allCopies: () => allCopies,
			local: (copy) => {
				const edition = editionById.get(copy.editionId);
				const work = edition ? workById.get(edition.workId ?? '') : undefined;
				return {
					copyNumber: copy.copyNumber,
					workName: work?.name ?? '',
					editionName: edition?.name ?? ''
				};
			},
			fetch: (cfg, ids) => loadMyLoanCopyChains(cfg, ids, works),
			isCurrent,
			apply: (chains) => (copyChains = chains),
			what: 'chain'
		});
	});

	function loanLabel(copyId: string): string {
		const chain = copyChains.get(copyId);
		if (chain) return formatLoanChainLabel(chain);
		return copyNames.get(copyId) || m.library_copy_name_unknown();
	}
</script>

{#if myActiveLoans.length > 0}
	<section data-testid="my-loans" aria-labelledby="my-loans-heading" class="rounded-md border border-ink-5 px-4 py-3">
		<button
			type="button"
			data-testid="my-loans-toggle"
			class="flex w-full items-center justify-between text-left text-sm font-medium"
			aria-expanded={expanded}
			aria-controls={expanded ? 'my-loans-list' : undefined}
			onclick={() => (expanded = !expanded)}
		>
			<span id="my-loans-heading">
				{m.library_my_loans_title({ count: myActiveLoans.length })}
				{#if overdueCount > 0}
					<span class="text-danger">· {m.library_my_loans_overdue_count({ count: overdueCount })}</span>
				{/if}
			</span>
			<span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
		</button>
		{#if expanded}
			<ul id="my-loans-list" class="mt-2 flex flex-col gap-1">
				{#each myActiveLoans as loan (loan.id)}
					<li data-testid="my-loans-item-{loan.id}" class="flex items-center justify-between text-xs">
						<span>{loanLabel(loan.copyId)}</span>
						<span class="text-ink-2">{formatLoanRange(loan.assignedAt, loan.assignedUntil)}</span>
						{#if isOverdue(loan.assignedUntil)}
							<span data-testid="my-loans-overdue-{loan.id}" class="text-danger">{m.library_my_loans_overdue()}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
