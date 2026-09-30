<!-- #74 — bulk checkout: pick a work, then an edition, then the borrowers. The selection
	lives on the page (bound here), so a same-collective refresh keeps it. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PersonName from '$lib/components/PersonName.svelte';
	import { workLabel } from '$lib/repertoire/workLabel';
	import type { Edition, Work } from '$lib/library/libraryData';
	import type { ActiveMember } from '$lib/roster/rosterData';
	import type { BulkCheckout } from '$lib/library/libraryState';
	import { formatDate, type LendingView } from '$lib/library/lendingView';

	interface Props {
		bulk: BulkCheckout;
		works: Work[];
		allEditions: Edition[];
		allMembers: ActiveMember[];
		memberNames: Map<string, string>;
		optionsPartial: boolean;
		membersPartial: boolean;
		view: LendingView;
		isOffline: boolean;
		submit: () => void;
	}

	let {
		bulk = $bindable(),
		works,
		allEditions,
		allMembers,
		memberNames,
		optionsPartial,
		membersPartial,
		view,
		isOffline,
		submit
	}: Props = $props();

	const editions = $derived(
		bulk.workId ? allEditions.filter((e) => e.workId === bulk.workId) : []
	);
	const editionCopyIds = $derived(
		bulk.editionId ? view.editionCopyIds(bulk.editionId) : new Set<string>()
	);
	const availability = $derived(
		bulk.editionId ? view.editionAvailability(bulk.editionId) : { available: 0, total: 0 }
	);

	function toggleMember(memberId: string): void {
		const next = new Set(bulk.members);
		if (next.has(memberId)) next.delete(memberId);
		else next.add(memberId);
		bulk.members = next;
	}
</script>

<div data-testid="bulk-checkout" class="mt-3">
	<!-- h2, not h3: the page's only other heading is the h1. -->
	<h2 class="font-display text-lg">{m.library_bulk_checkout_title()}</h2>
	<select data-testid="bulk-checkout-work-select" aria-label={m.library_bulk_checkout_work_placeholder()} value={bulk.workId} onchange={(e) => (bulk.workId = e.currentTarget.value)} class="mt-1 w-full rounded border border-ink-5 px-2 py-1">
		<option value="">{m.library_bulk_checkout_work_placeholder()}</option>
		{#each works as work (work.id)}
			<option value={work.id}>{workLabel(work)}</option>
		{/each}
	</select>
	{#if bulk.workId}
		<select data-testid="bulk-checkout-edition-select" aria-label={m.library_bulk_checkout_edition_placeholder()} value={bulk.editionId} onchange={(e) => (bulk.editionId = e.currentTarget.value)} class="mt-1 w-full rounded border border-ink-5 px-2 py-1">
			<option value="">{m.library_bulk_checkout_edition_placeholder()}</option>
			{#each editions as edition (edition.id)}
				<option value={edition.id}>{edition.name}</option>
			{/each}
			<!-- #321 — a native select cannot hold a paragraph, so the truncation notice is a
			     trailing disabled option, where the librarian looks for the missing edition. -->
			{#if optionsPartial}
				<option data-testid="bulk-checkout-edition-partial-option" value="" disabled>
					{m.picker_partial_options_notice()}
				</option>
			{/if}
		</select>
	{/if}
	{#if bulk.editionId}
		<p data-testid="bulk-checkout-availability" class="mt-1 text-xs" aria-live="polite">
			{m.library_bulk_checkout_availability({ available: availability.available, total: availability.total })}
		</p>
		<div data-testid="bulk-checkout-member-list" class="mt-2 flex flex-col gap-1">
			<!-- #321 — a truncated borrower set reads as "not a member", so the list says so. -->
			{#if membersPartial}
				<p
					data-testid="bulk-checkout-members-partial-notice"
					role="status"
					class="rounded-md border border-dashed border-ink-4 p-2 text-xs text-ink-2"
				>
					{m.picker_partial_members_notice()}
				</p>
			{/if}
			{#each allMembers as member (member.memberId)}
				{@const existingLending = view.memberLending(member.memberId, editionCopyIds)}
				{#if existingLending}
					<div class="flex items-center gap-1 text-xs">
						<span><PersonName name={memberNames.get(member.memberId) || m.library_borrower_unknown()} /></span>
						<span data-testid="bulk-checkout-already-lent-{member.memberId}">{m.library_bulk_checkout_already_lent({ date: formatDate(existingLending.assignedAt) })}</span>
					</div>
				{:else}
					<label class="flex items-center gap-1 text-xs">
						<input type="checkbox"
							checked={bulk.members.has(member.memberId)}
							onchange={() => toggleMember(member.memberId)}
						/>
						<span><PersonName name={memberNames.get(member.memberId) || m.library_borrower_unknown()} /></span>
					</label>
				{/if}
			{/each}
		</div>
		<input data-testid="bulk-checkout-due-date" type="date" bind:value={bulk.dueDate} class="mt-1 w-full rounded border border-ink-5 px-2 py-1" />
		{#if bulk.members.size > availability.available}
			<p data-testid="bulk-checkout-too-many" class="mt-1 text-xs text-red-700" role="alert">{m.library_bulk_checkout_too_many()}</p>
		{/if}
		<button type="button" data-testid="bulk-checkout-submit" class="mt-1 self-start rounded-md border border-ink px-3 py-1 text-xs hover:bg-ink hover:text-paper" disabled={bulk.members.size === 0 || bulk.members.size > availability.available || isOffline} onclick={submit}>
			{m.library_checkout_submit()}
		</button>
		{#if bulk.error}
			<p data-testid="bulk-checkout-error" class="text-xs text-red-700" role="alert">{bulk.error}</p>
		{/if}
	{/if}
</div>
