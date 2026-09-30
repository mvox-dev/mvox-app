<!-- One copy in an open edition: availability, and for a librarian the inline checkout
	picker or the return button. A member sees only lent copies here. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import type { Copy } from '$lib/library/libraryData';
	import type { ActiveMember } from '$lib/roster/rosterData';
	import type { TreeActions } from '$lib/library/libraryState';
	import { formatDate, type LendingView } from '$lib/library/lendingView';

	interface Props {
		copy: Copy;
		editionId: string;
		allMembers: ActiveMember[];
		memberNames: Map<string, string>;
		borrowerNames: Map<string, string>;
		membersPartial: boolean;
		checkoutError: string | undefined;
		view: LendingView;
		actions: TreeActions;
		isLibrarian: boolean;
		isOffline: boolean;
	}

	let {
		copy,
		editionId,
		allMembers,
		memberNames,
		borrowerNames,
		membersPartial,
		checkoutError,
		view,
		actions,
		isLibrarian,
		isOffline
	}: Props = $props();

	const availability = $derived(view.copyAvailability(copy.id));
	const activeLending = $derived(view.activeLendingForCopy(copy.id));
</script>

{#if isLibrarian || activeLending}
	<div data-testid="library-copy-{copy.id}" class="flex items-center justify-between text-xs">
		<span class="text-ink">{copy.name || (copy.copyNumber ? `#${copy.copyNumber}` : m.library_copy_name_unknown())}</span>
		<span class="flex items-center gap-1">
			{#if availability.status === 'available'}
				{#if isLibrarian}
					{@const editionCopyIds = view.editionCopyIds(editionId)}
					<span class="flex flex-col items-end gap-0.5">
						<select
							data-testid="inline-checkout-{copy.id}"
							aria-label={m.library_inline_checkout_placeholder()}
							value=""
							disabled={isOffline}
							onchange={(e) => {
								const memberId = e.currentTarget.value;
								if (memberId) void actions.checkout(copy.id, memberId);
							}}
							class="rounded border border-ink-5 px-2 py-0.5"
						>
							<option value="" disabled>{m.library_inline_checkout_placeholder()}</option>
							{#each allMembers as member (member.memberId)}
								{@const existingLending = view.memberLending(member.memberId, editionCopyIds)}
								{#if existingLending}
									<option value={member.memberId} disabled>
										{memberNames.get(member.memberId) || m.library_borrower_unknown()} — {m.library_inline_checkout_already_lent({ date: formatDate(existingLending.assignedAt) })}
									</option>
								{:else}
									<option value={member.memberId}>{memberNames.get(member.memberId) || m.library_borrower_unknown()}</option>
								{/if}
							{/each}
							<!-- #321 — the same truncated borrower set, noted as a trailing disabled
							     option for the reason the edition select carries one. -->
							{#if membersPartial}
								<option data-testid="inline-checkout-partial-option-{copy.id}" value="" disabled>
									{m.picker_partial_members_notice()}
								</option>
							{/if}
						</select>
						{#if checkoutError}
							<span data-testid="inline-checkout-error-{copy.id}" class="text-xs text-red-700" role="alert">{checkoutError}</span>
						{/if}
					</span>
				{:else}
					<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">{m.library_copy_available()}</span>
				{/if}
			{:else}
				<span class="rounded-full bg-ink-5 px-2 py-0.5 text-ink-2">
					<RedactedText
						>{m.library_copy_lent_to({
							name: borrowerNames.get(availability.memberId) || m.library_borrower_unknown()
						})}
						{#if availability.assignedAt}
							· {m.library_lent_since({ date: formatDate(availability.assignedAt) })}
						{/if}</RedactedText
					>
				</span>
				{#if isLibrarian && activeLending}
					<button
						type="button"
						data-testid="library-return-{copy.id}"
						class="rounded-md border border-ink px-2 py-0.5 text-xs hover:bg-ink hover:text-paper"
						disabled={isOffline}
						onclick={() => actions.returnLending(activeLending.id)}
					>
						{m.library_return()}
					</button>
				{/if}
			{/if}
		</span>
	</div>
{/if}
