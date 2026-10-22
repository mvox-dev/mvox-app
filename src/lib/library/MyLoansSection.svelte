<!-- #73 — the signed-in member's active loans. #982: the copy lookup runs before the list
	opens, so online it fills the offline cache and the labels show at once on open. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/auth/session';
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

	// #984 — a string, so a new lendings array with the same loans of mine re-runs nothing.
	// The held part re-runs it when librarian copies arrive and resolve some locally.
	const loanKey = $derived.by(() => {
		const ids = myActiveLoans.map((l) => l.copyId).sort();
		const held = new Set(allCopies.map((c) => c.id));
		return `${selected?.db ?? ''} ${ids.join(',')} ${ids.filter((id) => held.has(id)).join(',')}`;
	});
	// #978 — the token itself is not reactive; the session store is.
	const signedIn = $derived($authStore.status === 'authenticated');

	// #129 — each loan's copy name and edition / work chain, so a loan never renders a raw
	// entity id. A librarian already holds every copy, so those resolve locally; the rest
	// take one read each.
	const copyLoad = createLatest();
	const known = new Map<string, Map<string, LoanCopy>>();
	$effect(() => {
		void loanKey;
		void signedIn;
		const isCurrent = copyLoad.next();
		untrack(() => {
			void resolveLocalFirst<LoanCopy>({
				loans: myActiveLoans,
				selected: () => selected,
				allCopies: () => allCopies,
				local: (copy) => heldLoanCopy(copy, editionById, workById),
				fetch: (cfg, ids) => loadMyLoanCopies(cfg, ids, works),
				isCurrent,
				apply: (copies) => (loanCopies = copies),
				what: 'label',
				known
			});
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
