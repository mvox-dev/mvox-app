<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import RedactedText from '$lib/components/RedactedText.svelte';
	import EntuRef from '$lib/components/EntuRef.svelte';
	import type { MemberOpsState, RosterState } from '$lib/roster/rosterPageState';
	import type { MemberOps } from '$lib/roster/rosterMemberOps';
	import { sectionNamesFor } from '$lib/sections/sectionTree';

	let {
		roster,
		memberOps,
		ops,
		isOffline,
		sectionNameById
	}: {
		roster: RosterState;
		memberOps: MemberOpsState;
		ops: MemberOps;
		isOffline: boolean;
		sectionNameById: Map<string, string>;
	} = $props();
</script>

<div class="flex flex-col gap-2 border-t border-dashed border-ink-5 pt-3">
	<button
		type="button"
		data-testid="roster-inactive-toggle"
		aria-expanded={roster.showInactive}
		class="self-start text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
		onclick={() => ops.toggleInactive()}
	>
		{roster.showInactive ? m.roster_inactive_hide() : m.roster_inactive_show()}
	</button>
	{#if roster.showInactive}
		{#if roster.inactiveLoadError}
			<p data-testid="roster-inactive-load-error" role="alert" class="text-sm text-red-700">
				{m.roster_inactive_load_error()}
			</p>
		{:else if roster.inactiveRows.length === 0}
			<p data-testid="roster-inactive-empty" class="text-xs text-ink-2">{m.roster_inactive_empty()}</p>
		{:else}
			<ul data-testid="roster-inactive-list" class="flex flex-col">
				{#each roster.inactiveRows as row (row.memberId)}
					{@const inactiveSectionNames = sectionNamesFor(row.sectionIds, sectionNameById)}
					<li
						data-testid="inactive-member-row-{row.memberId}"
						class="flex flex-col gap-0.5 border-b border-dashed border-ink-5 py-2 last:border-b-0"
					>
						<span class="text-sm text-ink"><RedactedText>{row.name}</RedactedText></span>
						{#if inactiveSectionNames.length > 0}
							<span data-testid="inactive-member-section-{row.memberId}" class="text-xs text-ink-2">
								{inactiveSectionNames.join(', ')}
							</span>
						{/if}
						<button
							type="button"
							data-testid="member-reinstate-{row.memberId}"
							class="self-start rounded-md border border-ink px-3 py-1 text-xs hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
							disabled={memberOps.reinstatePending !== null || isOffline}
							onclick={() => ops.handleReinstate(row.memberId)}
						>
							{m.roster_member_reinstate()}
						</button>
						{#if memberOps.deactivateActionError?.memberId === row.memberId && memberOps.deactivateActionError.kind === 'reinstate'}
							<FormError data-testid="member-reinstate-failed-{row.memberId}">
								{m.roster_member_reinstate_failed()}
								<EntuRef id={row.memberId} />
							</FormError>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
