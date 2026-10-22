<!-- #73 — the signed-in member's active loans. Always mounted: the copy lookup runs
	whether or not the section shows. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { firstById } from '$lib/collections/firstById';
	import { createLatest } from '$lib/async/latest';
	import { heldLoanCopy, isActiveLending, loanCopyLabel } from '$lib/library/libraryData';
	import { loadMyLoanCopies } from '$lib/library/libraryPageData';
	import type { Copy, Edition, Lending, LoanCopy, Work } from '$lib/library/libraryData';
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
	let loanCopies = $state<Map<string, LoanCopy>>(new Map());

	const myActiveLoans = $derived(
		myMemberId ? lendings.filter((l) => l.memberId === myMemberId && isActiveLending(l)) : []
	);
	const overdueCount = $derived(myActiveLoans.filter((l) => isOverdue(l.assignedUntil)).length);

	const editionById = $derived(firstById(allEditions));
	const workById = $derived(firstById(works));

	// #129 — each loan's copy name and edition / work chain, so a loan never renders a raw
	// entity id. A librarian already holds every copy, so those resolve locally; the rest
	// take one read each.
	const copyLoad = createLatest();
	$effect(() => {
		const loans = myActiveLoans;
		const isCurrent = copyLoad.next();
		void resolveLocalFirst<LoanCopy>({
			loans,
			selected: () => selected,
			allCopies: () => allCopies,
			local: (copy) => heldLoanCopy(copy, editionById, workById),
			fetch: (cfg, ids) => loadMyLoanCopies(cfg, ids, works),
			isCurrent,
			apply: (copies) => (loanCopies = copies),
			what: 'label'
		});
	});

	function loanLabel(copyId: string): string {
		const copy = loanCopies.get(copyId);
		return copy ? loanCopyLabel(copy) : m.library_copy_name_unknown();
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
